import { decodeFunctionResult, encodeFunctionData, getAddress, keccak256, encodeAbiParameters, parseAbi, parseAbiParameters, type Address, type Hex, type ContractFunctionReturnType } from 'viem';
import type { InterestRate } from '../src/types.js';
import type { ChainClient } from './rpc.js';
import { morphoCoreAbi as core, morphoIrmAbi as irmAbi, morphoMulticallAbi as multi } from './abis/morpho.js';
import { MORPHO_BLUE } from './morpho-discovery.js';
import { perSecondApr, rate, unavailableRate } from './rates.js';
type Params = ContractFunctionReturnType<typeof core, 'view', 'idToMarketParams'>;
type Market = ContractFunctionReturnType<typeof core, 'view', 'market'>;
const ZERO = '0x0000000000000000000000000000000000000000';
const MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11';
const vaultAbi = parseAbi([
  'function asset() view returns (address)', 'function MORPHO() view returns (address)',
  'function totalAssets() view returns (uint256)', 'function fee() view returns (uint96)',
  'function withdrawQueueLength() view returns (uint256)', 'function withdrawQueue(uint256) view returns (bytes32)',
  'function adaptersLength() view returns (uint256)', 'function adapters(uint256) view returns (address)',
  'function performanceFee() view returns (uint96)', 'function managementFee() view returns (uint96)',
  'function performanceFeeRecipient() view returns (address)', 'function managementFeeRecipient() view returns (address)',
  'function canReceiveShares(address) view returns (bool)', 'function maxRate() view returns (uint64)',
]);
const adapterAbi = parseAbi([
  'function parentVault() view returns (address)', 'function asset() view returns (address)',
  'function realAssets() view returns (uint256)', 'function morphoVaultV1() view returns (address)',
  'function morpho() view returns (address)', 'function marketIdsLength() view returns (uint256)',
  'function marketIds(uint256) view returns (bytes32)', 'function expectedSupplyAssets(bytes32) view returns (uint256)',
]);
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function morphoSupplyApr(borrowApr: number, supply: bigint, borrow: bigint, fee: bigint) {
  if (fee > 10n ** 18n) throw new Error('Invalid market fee');
  return supply === 0n ? 0 : borrowApr * Number(borrow) / Number(supply) * (1 - Number(fee) / 1e18);
}
export function createMorphoRates(client: ChainClient, blockNumber: bigint) {
  async function market(params: Params, state: Market) {
    try {
      let borrowApr = 0;
      if (!same(params.irm, ZERO)) {
        // Accrual updates adaptive IRM state too. Query the zero-elapsed ending
        // rate in that same simulation, rather than mixing an accrued market
        // with the IRM's old rate-at-target or showing the past interval's average.
        const calls = [
          { target: MORPHO_BLUE as Address, allowFailure: false, callData: encodeFunctionData({ abi: core, functionName: 'accrueInterest', args: [params] }) },
          { target: params.irm, allowFailure: false, callData: encodeFunctionData({ abi: irmAbi, functionName: 'borrowRateView', args: [params, state] }) },
        ];
        const response = await client.call({ to: MULTICALL, data: encodeFunctionData({ abi: multi, functionName: 'aggregate3', args: [calls] }), blockNumber });
        if (!response.data) throw new Error('Missing instant rate');
        const results = decodeFunctionResult({ abi: multi, functionName: 'aggregate3', data: response.data });
        if (results.length !== 2 || results.some(r => !r.success)) throw new Error('Instant rate simulation failed');
        borrowApr = perSecondApr(decodeFunctionResult({ abi: irmAbi, functionName: 'borrowRateView', data: results[1].returnData }));
      }
      return { supplyRate: rate(morphoSupplyApr(borrowApr, state.totalSupplyAssets, state.totalBorrowAssets, state.fee), 'Current Morpho market APR after its fee; excludes reward incentives and the underlying token’s intrinsic yield.'), borrowRate: rate(borrowApr, 'Current Morpho IRM borrowing APR at the accrued market state; excludes reward incentives.') };
    } catch { return { supplyRate: unavailableRate(), borrowRate: unavailableRate() }; }
  }
  const markets = new Map<string, Promise<{ params: Params; state: Market; apr: number }>>();
  function marketData(id: Hex) {
    if (!markets.has(id)) markets.set(id, (async () => {
      const params = await client.readContract({ address: MORPHO_BLUE, abi: core, functionName: 'idToMarketParams', args: [id], blockNumber });
      if (!same(keccak256(encodeAbiParameters(parseAbiParameters('address,address,address,address,uint256'), [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv])), id)) throw new Error('Market identity mismatch');
      const calls = [encodeFunctionData({ abi: core, functionName: 'accrueInterest', args: [params] }), encodeFunctionData({ abi: core, functionName: 'market', args: [id] })];
      const response = await client.call({ to: MULTICALL, data: encodeFunctionData({ abi: multi, functionName: 'aggregate3', args: [calls.map(callData => ({ target: MORPHO_BLUE as Address, allowFailure: false, callData }))] }), blockNumber });
      if (!response.data) throw new Error('Missing accrued market');
      const results = decodeFunctionResult({ abi: multi, functionName: 'aggregate3', data: response.data });
      if (results.length !== 2 || results.some(r => !r.success)) throw new Error('Market simulation failed');
      const state = decodeFunctionResult({ abi: core, functionName: 'market', data: results[1].returnData });
      const interest = await market(params, state);
      if (interest.supplyRate.apr === null) throw new Error('Market rate unavailable');
      return { params, state, apr: interest.supplyRate.apr };
    })());
    return markets.get(id)!;
  }
  const vaults = new Map<string, Promise<InterestRate>>();
  function vault(address: Address, version: 1 | 2, expectedAsset: Address): Promise<InterestRate> {
    const key = `${address.toLowerCase()}:${version}:${expectedAsset.toLowerCase()}`;
    if (!vaults.has(key)) vaults.set(key, readVault(address, version, expectedAsset).catch(() => unavailableRate('Current net vault APR could not be verified for every allocation and fee. No historical average is substituted.')));
    return vaults.get(key)!;
  }
  async function readVault(address: Address, version: 1 | 2, expectedAsset: Address): Promise<InterestRate> {
    const asset = await client.readContract({ address, abi: vaultAbi, functionName: 'asset', blockNumber });
    if (!same(asset, expectedAsset)) throw new Error('Wrong underlying');
    const totalAssets = await client.readContract({ address, abi: vaultAbi, functionName: 'totalAssets', blockNumber });
    if (totalAssets === 0n) throw new Error('No funded vault');
    let interestPerYear = 0;
    if (version === 1) {
      const [morpho, length, fee] = await Promise.all([
        client.readContract({ address, abi: vaultAbi, functionName: 'MORPHO', blockNumber }),
        client.readContract({ address, abi: vaultAbi, functionName: 'withdrawQueueLength', blockNumber }),
        client.readContract({ address, abi: vaultAbi, functionName: 'fee', blockNumber }),
      ]);
      if (!same(morpho, MORPHO_BLUE) || length > 64n || fee > 10n ** 18n) throw new Error('Unsupported vault');
      const seen = new Set<string>();
      for (let i = 0n; i < length; i++) {
        const id = await client.readContract({ address, abi: vaultAbi, functionName: 'withdrawQueue', args: [i], blockNumber });
        if (seen.has(id)) throw new Error('Duplicate market'); seen.add(id);
        const position = await client.readContract({ address: MORPHO_BLUE, abi: core, functionName: 'position', args: [id, address], blockNumber });
        if (!position.supplyShares) continue;
        const entry = await marketData(id);
        if (!same(entry.params.loanToken, asset)) throw new Error('Wrong market asset');
        const allocated = position.supplyShares * (entry.state.totalSupplyAssets + 1n) / (entry.state.totalSupplyShares + 1_000_000n);
        interestPerYear += Number(allocated) * entry.apr;
      }
      return rate(interestPerYear / Number(totalAssets) * (1 - Number(fee) / 1e18), 'Current allocation-weighted Morpho V1 lending APR after performance fees, including idle cash at zero interest. Excludes incentives and intrinsic token yield.', true);
    }
    const length = await client.readContract({ address, abi: vaultAbi, functionName: 'adaptersLength', blockNumber });
    if (length > 64n) throw new Error('Too many adapters');
    let realAssets = await client.readContract({ address: asset, abi: erc20, functionName: 'balanceOf', args: [address], blockNumber });
    const seenAdapters = new Set<string>();
    for (let i = 0n; i < length; i++) {
      const adapter = await client.readContract({ address, abi: vaultAbi, functionName: 'adapters', args: [i], blockNumber });
      if (seenAdapters.has(adapter.toLowerCase())) throw new Error('Duplicate adapter'); seenAdapters.add(adapter.toLowerCase());
      const [parent, allocation] = await Promise.all([
        client.readContract({ address: adapter, abi: adapterAbi, functionName: 'parentVault', blockNumber }),
        client.readContract({ address: adapter, abi: adapterAbi, functionName: 'realAssets', blockNumber }),
      ]);
      if (!same(parent, address)) throw new Error('Adapter identity mismatch');
      realAssets += allocation;
      if (!allocation) continue;
      let nested: Address | null = null;
      try { nested = await client.readContract({ address: adapter, abi: adapterAbi, functionName: 'morphoVaultV1', blockNumber }); } catch { /* Try the direct-market adapter interface. */ }
      if (nested) {
        const interest = await vault(getAddress(nested), 1, asset);
        if (interest.apr === null) throw new Error('Nested vault rate missing');
        interestPerYear += Number(allocation) * interest.apr;
      } else {
        const [morpho, count, adapterAsset] = await Promise.all([
          client.readContract({ address: adapter, abi: adapterAbi, functionName: 'morpho', blockNumber }),
          client.readContract({ address: adapter, abi: adapterAbi, functionName: 'marketIdsLength', blockNumber }),
          client.readContract({ address: adapter, abi: adapterAbi, functionName: 'asset', blockNumber }),
        ]);
        if (!same(morpho, MORPHO_BLUE) || !same(adapterAsset, asset) || count > 64n) throw new Error('Unsupported active adapter');
        let verifiedAllocation = 0n;
        const seen = new Set<string>();
        for (let j = 0n; j < count; j++) {
          const id = await client.readContract({ address: adapter, abi: adapterAbi, functionName: 'marketIds', args: [j], blockNumber });
          if (seen.has(id)) throw new Error('Duplicate market'); seen.add(id);
          const allocated = await client.readContract({ address: adapter, abi: adapterAbi, functionName: 'expectedSupplyAssets', args: [id], blockNumber });
          if (!allocated) continue;
          const entry = await marketData(id);
          if (!same(entry.params.loanToken, asset)) throw new Error('Wrong market asset');
          verifiedAllocation += allocated;
          interestPerYear += Number(allocated) * entry.apr;
        }
        if (verifiedAllocation !== allocation) throw new Error('Incomplete adapter allocation');
      }
    }
    const [performance, management, maxRate, performanceRecipient, managementRecipient] = await Promise.all([
      client.readContract({ address, abi: vaultAbi, functionName: 'performanceFee', blockNumber }),
      client.readContract({ address, abi: vaultAbi, functionName: 'managementFee', blockNumber }),
      client.readContract({ address, abi: vaultAbi, functionName: 'maxRate', blockNumber }),
      client.readContract({ address, abi: vaultAbi, functionName: 'performanceFeeRecipient', blockNumber }),
      client.readContract({ address, abi: vaultAbi, functionName: 'managementFeeRecipient', blockNumber }),
    ]);
    if (performance > 10n ** 18n) throw new Error('Invalid performance fee');
    const feeEnabled = async (fee: bigint, recipient: Address) => fee > 0n && await client.readContract({ address, abi: vaultAbi, functionName: 'canReceiveShares', args: [recipient], blockNumber });
    const [pFee, mFee] = await Promise.all([feeEnabled(performance, performanceRecipient), feeEnabled(management, managementRecipient)]);
    const cap = perSecondApr(maxRate);
    const gross = realAssets > totalAssets ? cap : Math.min(interestPerYear / Number(totalAssets), cap);
    return rate(gross * (1 - (pFee ? Number(performance) / 1e18 : 0)) - (mFee ? perSecondApr(management) : 0), 'Current Morpho V2 allocation-based APR estimate after enabled performance/management fees and the distribution-rate cap. Unknown adapter types produce an unavailable rate; no historical average is used.', true);
  }
  return { market, vault };
}
