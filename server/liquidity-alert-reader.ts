import { createCurveReader } from './curve-llamalend.js';
import { decodeFunctionResult, encodeFunctionData, encodeFunctionResult, parseAbi, type Address, type Hex } from 'viem';
import type { Position, NetworkId } from '../src/types.js';
import type { MarketLiquidity } from '../src/market-comparison.js';
import type { ChainClient } from './rpc.js';
import { makeClient } from './rpc.js';
import { networks } from './networks.js';
import { accruedMorphoMarket } from './morpho-rates.js';
import { morphoCoreAbi } from './abis/morpho.js';
import { aaveLiquidity, compoundLiquidity, liquidityQuote, liquidityTokenAbi, tokenMetadata, v4Liquidity } from './market-liquidity.js';
import { fluidMarketLiquidity } from './fluid-market-liquidity.js';
import { vaultResolverAbi } from './abis/fluid.js';
import { fluidLegacyLendingRatesAbi } from './abis/fluid-rates.js';
import { createEulerReader } from './euler.js';
import { readEuler } from './adapters/euler.js';
import { readAave } from './adapters/aave.js';
import { readCompound } from './adapters/compound.js';
import { readAaveV4 } from './adapters/aave-v4.js';
import { AAVE_V4_SPOKES, AAVE_V4_TOKENIZATION_SPOKES } from './deployments/aave-v4.js';
import { AAVE_HORIZON } from './deployments/aave-horizon.js';
import { SPARK_LEND } from './deployments/spark.js';
import { listaDeployments } from './deployments/lista.js';
export interface LiquidityWatch { address: string; network: NetworkId; protocol: string; positionId: string; ruleUpdatedAt: string }
export interface LiquidityReading { market: string; marketAddress: string; label: string; token: string; symbol: string; decimals: number; rawAmount: string; note: string }
export interface LiquidityObservation { watch: LiquidityWatch; checkedAt: string; blockNumber: string; status: 'ok' | 'error' | 'inactive' | 'unsupported'; readings: LiquidityReading[]; message?: string }
const abi = parseAbi([
 'function getPool() view returns(address)', 'function getPoolDataProvider() view returns(address)',
 'function getConfiguration(address) view returns((uint256 data))',
 'function getReserveData(address) view returns(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40)',
 'function asset() view returns(address)', 'function balanceOf(address) view returns(uint256)',
 'function withdrawQueueLength() view returns(uint256)', 'function withdrawQueue(uint256) view returns(bytes32)',
 'function adaptersLength() view returns(uint256)', 'function adapters(uint256) view returns(address)',
 'function parentVault() view returns(address)', 'function realAssets() view returns(uint256)', 'function morphoVaultV1() view returns(address)',
 'function morpho() view returns(address)', 'function marketIdsLength() view returns(uint256)', 'function marketIds(uint256) view returns(bytes32)', 'function expectedSupplyAssets(bytes32) view returns(uint256)',
 'function MORPHO() view returns(address)', 'function MOOLAH() view returns(address)',
 'function getUserReserveData(address,address) view returns(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40,bool)',
]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const address = (value: string): Address => { if (!/^0x[\da-f]{40}$/i.test(value)) throw Error('Invalid market address'); return value as Address; };
const activeAssets = (p: Position) => p.assets.filter(a => p.assets.some(a => a.borrowed > 0) ? a.borrowed > 0 : a.supplied > 0);
function quote(market: string, marketAddress: string, label: string, q: MarketLiquidity | null): LiquidityReading {
  if (!q || q.rawAmount === undefined || q.decimals === undefined) throw Error('Unavailable exact liquidity');
  return { market: market.toLowerCase(), marketAddress: marketAddress.toLowerCase(), label, token: q.token.toLowerCase(), symbol: q.symbol, decimals: q.decimals, rawAmount: q.rawAmount, note: q.note };
}
export function createLiquidityAlertReader(clientFor: (n: NetworkId) => ChainClient = n => makeClient(n, process.env[`${n.toUpperCase()}_RPC_URL`] || (n === 'ethereum' ? 'https://eth.drpc.org' : undefined)), now = Date.now) {
  const snapshots = new Map<NetworkId, Promise<{ client: ChainClient; block: bigint }>>();
  const marketReads = new Map<string, Promise<LiquidityReading>>();
  function snapshot(network: NetworkId) {
    if (!snapshots.has(network)) snapshots.set(network, (async () => { const client = clientFor(network); if (await client.getChainId() !== networks[network].id) throw Error('Wrong network'); return { client, block: await client.getBlockNumber() }; })());
    return snapshots.get(network)!;
  }
  async function morpho(client: ChainClient, network: NetworkId, block: bigint, core: Address, id: Hex) {
    const key = `${network}:${core}:${id}`;
    if (!marketReads.has(key)) marketReads.set(key, (async () => {
      const { params, state } = await accruedMorphoMarket(client, core, id, block), info = await tokenMetadata(client, params.loanToken, block);
      if (state.totalSupplyAssets < state.totalBorrowAssets) throw Error('Negative market liquidity');
      let collateral = 'No collateral';
      if (!/^0x0{40}$/i.test(params.collateralToken)) {
        try {
          const symbol = await client.readContract({ address: params.collateralToken, abi: liquidityTokenAbi, functionName: 'symbol', blockNumber: block });
          collateral = typeof symbol === 'string' && symbol.trim() && symbol.length <= 128 ? symbol.replace(/\s+/g, ' ').trim() : 'Unknown collateral';
        } catch { collateral = 'Unknown collateral'; }
      }
      return quote(id, core, `${collateral} / ${info.symbol}`, liquidityQuote(state.totalSupplyAssets - state.totalBorrowAssets, info.decimals, info.symbol, params.loanToken, 'Accrued market loan assets supplied minus borrowed; excludes collateral TVL.'));
    })());
    return marketReads.get(key)!;
  }
  async function vaultMarkets(client: ChainClient, network: NetworkId, block: bigint, core: Address, vault: Address, depth = 0): Promise<LiquidityReading[]> {
    if (depth > 3) throw Error('Nested vault limit');
    const token = await client.readContract({ address: vault, abi, functionName: 'asset', blockNumber: block });
    const metadata = await tokenMetadata(client, token, block);
    const idle = await client.readContract({ address: token, abi, functionName: 'balanceOf', args: [vault], blockNumber: block });
    const out = [quote(`${vault}:idle`, vault, 'Vault idle liquidity', liquidityQuote(idle, metadata.decimals, metadata.symbol, token, 'Idle underlying cash in this vault, tracked separately from its allocated markets.'))];
    let length: bigint | undefined;
    try { length = await client.readContract({ address: vault, abi, functionName: 'withdrawQueueLength', blockNumber: block }); } catch { /* Try V2 adapter allocations. */ }
    if (length !== undefined) {
      const actual = await client.readContract({ address: vault, abi, functionName: core === listaDeployments[network]?.core ? 'MOOLAH' : 'MORPHO', blockNumber: block });
      if (!same(actual, core) || length > 64n) throw Error('Vault identity unavailable');
      for (let i = 0n; i < length; i++) {
        const id = await client.readContract({ address: vault, abi, functionName: 'withdrawQueue', args: [i], blockNumber: block });
        const allocation = await client.readContract({ address: core, abi: morphoCoreAbi, functionName: 'position', args: [id, vault], blockNumber: block });
        if (allocation.supplyShares > 0n) { const q = await morpho(client, network, block, core, id); if (!same(q.token, token)) throw Error('Wrong vault asset'); out.push(q); }
      }
    } else {
      const count = await client.readContract({ address: vault, abi, functionName: 'adaptersLength', blockNumber: block });
      if (count > 64n) throw Error('Adapter limit');
      for (let i = 0n; i < count; i++) {
        const adapter = await client.readContract({ address: vault, abi, functionName: 'adapters', args: [i], blockNumber: block });
        const [parent, assets] = await Promise.all([client.readContract({ address: adapter, abi, functionName: 'parentVault', blockNumber: block }), client.readContract({ address: adapter, abi, functionName: 'realAssets', blockNumber: block })]);
        if (!same(parent, vault)) throw Error('Wrong adapter'); if (BigInt(assets) === 0n) continue;
        let nested: Address | undefined;
        try { nested = await client.readContract({ address: adapter, abi, functionName: 'morphoVaultV1', blockNumber: block }); } catch { /* Direct-market adapter. */ }
        if (nested) { const nestedQuotes = await vaultMarkets(client, network, block, core, nested, depth + 1); if (nestedQuotes.some(q => !same(q.token, token))) throw Error('Wrong nested asset'); out.push(...nestedQuotes); }
        else {
          const [actual, asset, n] = await Promise.all([
            client.readContract({ address: adapter, abi, functionName: 'morpho', blockNumber: block }), client.readContract({ address: adapter, abi, functionName: 'asset', blockNumber: block }), client.readContract({ address: adapter, abi, functionName: 'marketIdsLength', blockNumber: block }),
          ]);
          if (!same(actual, core) || !same(asset, token) || n > 64n) throw Error('Unsupported adapter');
          for (let j = 0n; j < n; j++) { const id = await client.readContract({ address: adapter, abi, functionName: 'marketIds', args: [j], blockNumber: block }); const allocated = await client.readContract({ address: adapter, abi, functionName: 'expectedSupplyAssets', args: [id], blockNumber: block }); if (allocated === 0n) continue; const q = await morpho(client, network, block, core, id); if (!same(q.token, token)) throw Error('Wrong market asset'); out.push(q); }
        }
      }
    }
    return out;
  }
  return async function read(watch: LiquidityWatch): Promise<LiquidityObservation> {
    const checkedAt = new Date(now()).toISOString(); let block = 0n;
    const result = (status: LiquidityObservation['status'], readings: LiquidityReading[] = [], message?: string): LiquidityObservation => { if (status === 'ok' && !readings.length) { status = 'error'; message = 'No verified liquidity readings; the last successful reading is retained.'; } return { watch, checkedAt, blockNumber: String(block), status, readings: [...new Map(readings.map(q => [`${q.market}:${q.token}`, q])).values()], ...(message ? { message } : {}) }; };
    try {
      const s = await snapshot(watch.network), client = s.client; block = s.block;
      const wallet = address(watch.address), network = watch.network, id = watch.positionId;
      const direct = id.match(/^(?:morpho|lista)-market-(0x[\da-f]{64})$/i);
      if (direct && ['morpho', 'spark', 'lista'].includes(watch.protocol)) {
        const core = watch.protocol === 'lista' ? listaDeployments[network]?.core : networks[network].morphoBlue;
        if (!core) throw Error('Unsupported core');
        const p = await client.readContract({ address: core, abi: morphoCoreAbi, functionName: 'position', args: [direct[1] as Hex, wallet], blockNumber: block });
        if (p.supplyShares === 0n && p.borrowShares === 0n && p.collateral === 0n) return result('inactive');
        return result('ok', [await morpho(client, network, block, core, direct[1] as Hex)]);
      }
      const vault = id.match(/^(?:morpho|lista)-vault-(0x[\da-f]{40})$/i) ?? (watch.protocol === 'spark' ? id.match(/^spark-vault-(0x[\da-f]{40})$/i) : null);
      if (vault) {
        const v = address(vault[1]); if (await client.readContract({ address: v, abi, functionName: 'balanceOf', args: [wallet], blockNumber: block }) === 0n) return result('inactive');
        const core = watch.protocol === 'lista' ? listaDeployments[network]?.core : networks[network].morphoBlue;
        if (!core) throw Error('Unsupported core');
        if (watch.protocol === 'spark' && id.startsWith('spark-vault-')) return result('unsupported', [], 'This savings vault has no supported borrowing-liquidity metric.');
        return result('ok', await vaultMarkets(client, network, block, core, v));
      }
      if (watch.protocol === 'aave-v3' || watch.protocol === 'spark' && id === 'spark-main') {
        const horizon = id === 'aave-horizon-main';
        if (horizon && network !== 'ethereum' || watch.protocol === 'spark' && network !== 'ethereum') throw Error('Wrong deployment');
        if (!['aave-main', 'aave-horizon-main', 'spark-main'].includes(id)) throw Error('Unknown pool');
        const deployment = horizon ? AAVE_HORIZON : watch.protocol === 'spark' ? { ...SPARK_LEND, id: 'spark', name: 'SparkLend', legacyEMode: true } : undefined;
        const p = (await readAave(client, wallet, block, network, deployment)).positions[0]; if (!p) return result('inactive');
        const provider = deployment?.provider ?? networks[network].aaveProvider;
        const [data, pool] = await Promise.all(['getPoolDataProvider', 'getPool'].map(functionName => client.readContract({ address: provider, abi, functionName: functionName as 'getPool', blockNumber: block })));
        const readings = await Promise.all(activeAssets(p).map(async a => {
          const token = address(a.address), metadata = await tokenMetadata(client, token, block);
          const [config, state] = await Promise.all([client.readContract({ address: pool, abi, functionName: 'getConfiguration', args: [token], blockNumber: block }), client.readContract({ address: data, abi, functionName: 'getReserveData', args: [token], blockNumber: block })]);
          const enabled = (config.data & (1n << 56n)) !== 0n && (config.data & (1n << 58n)) !== 0n && (config.data & ((1n << 57n) | (1n << 60n))) === 0n;
          return quote(pool, pool, p.label, enabled ? await aaveLiquidity(client, data, pool, token, config.data, metadata.decimals, state[3] + state[4], block, watch.protocol !== 'spark') : liquidityQuote(0n, metadata.decimals, metadata.symbol, token, 'Borrowing is disabled, paused or frozen for this reserve.'));
        }));
        return result('ok', readings);
      }
      if (watch.protocol === 'curve-llamalend') {
        const match = id.match(/^curve-(loan|vault)-(0x[\da-f]{40})$/i);
        if (!match) throw Error('Unknown Curve position');
        const reader = createCurveReader(client, network, block), catalog = await reader.catalog();
        const market = catalog.markets.find(m => same(m.controller, match[2]));
        if (!market) { if (!catalog.complete) throw Error('Incomplete Curve catalog'); return result('inactive'); }
        const owned = await reader.ownership(market, wallet);
        if (match[1] === 'loan' ? !owned.loan : owned.shares + owned.staked === 0n) return result('inactive');
        const q = await reader.quote(market);
        return result('ok', [quote(market.controller, market.controller, q.label, q.liquidity)]);
      }
      if (watch.protocol === 'compound') {
        const portfolio = await readCompound(client, wallet, block, network), p = portfolio.positions.find(p => same(p.id, id)); if (!p) { if (portfolio.status !== 'ok') throw Error('Incomplete positions'); return result('inactive'); }
        const market = address(p.marketAddress ?? p.id); const base = await client.readContract({ address: market, abi: parseAbi(['function baseToken() view returns(address)']), functionName: 'baseToken', blockNumber: block });
        return result('ok', [quote(market, market, p.label, await compoundLiquidity(client, market, base, block))]);
      }
      if (watch.protocol === 'euler') {
        const portfolio = await readEuler(client, wallet, block, network), p = portfolio.positions.find(p => same(p.id, id)); if (!p) { if (portfolio.status !== 'ok') throw Error('Incomplete positions'); return result('inactive'); }
        const reader = createEulerReader(client, network, block), vaults = p.assets.some(a => a.borrowed > 0) ? [p.marketAddress!] : p.receiptTokens ?? [p.marketAddress!];
        return result('ok', await Promise.all(vaults.map(async v => quote(v, v, p.label, await reader.liquidity(address(v))))));
      }
      if (watch.protocol === 'aave-v4' && network === 'ethereum') {
        const market = address(id.replace(/^aave-v4-/, ''));
        const p = (await readAaveV4(client, wallet, block, { spokes: AAVE_V4_SPOKES.filter(s => same(s.address, market)), tokenizations: AAVE_V4_TOKENIZATION_SPOKES.filter(s => same(s.address, market)) })).positions.find(p => same(p.id, id)); if (!p) return result('inactive');
        const readings: LiquidityReading[] = [];
        for (const a of activeAssets(p)) for (const r of a.v4Reserves ?? []) {
          if (a.borrowed > 0 ? r.borrowed <= 0 : r.supplied <= 0) continue;
          if (AAVE_V4_TOKENIZATION_SPOKES.some(s => same(s.address, market))) {
            const raw = await client.readContract({ address: address(r.hub), abi: parseAbi(['function getAssetLiquidity(uint256) view returns(uint256)']), functionName: 'getAssetLiquidity', args: [BigInt(r.assetId)], blockNumber: block });
            const m = await tokenMetadata(client, address(a.address), block);
            readings.push(quote(`${r.hub}:${r.assetId}`, r.hub, p.label, liquidityQuote(raw, m.decimals, m.symbol, a.address, 'Hub liquidity backing the tokenized deposit; personal withdrawal and access limits can apply.')));
          } else readings.push(quote(`${market}:${r.hub}:${r.assetId}`, market, p.label, await v4Liquidity(client, address(r.hub), BigInt(r.assetId), market, address(a.address), block)));
        }
        return result('ok', readings);
      }
      if (watch.protocol === 'fluid') {
        const nft = id.match(/^fluid-nft-(\d+)$/);
        if (nft) {
          const [p, v] = await client.readContract({ address: networks[network].fluid.vault, abi: vaultResolverAbi, functionName: 'positionByNftId', args: [BigInt(nft[1])], blockNumber: block });
          if (!same(p.owner, wallet) || p.supply === 0n && p.borrow === 0n) return result('inactive');
          const readings = await fluidMarketLiquidity(client, network, block, v); if (readings.size !== (v.isSmartDebt ? 2 : 1)) throw Error('Incomplete Fluid liquidity');
          return result('ok', [...readings.values()].map(q => quote(v.vault, v.vault, `Fluid Vault ${v.constantVariables.vaultId}`, q)));
        }
        const lending = id.match(/^fluid-lending-(0x[\da-f]{40})$/i);
        if (lending) {
          const v = address(lending[1]); if (await client.readContract({ address: v, abi, functionName: 'balanceOf', args: [wallet], blockNumber: block }) === 0n) return result('inactive');
          const response = await client.call({ to: networks[network].fluid.lending, data: encodeFunctionData({ abi: fluidLegacyLendingRatesAbi, functionName: 'getFTokenDetails', args: [v] }), blockNumber: block });
          if (!response.data) throw Error('Missing fToken state');
          const d = decodeFunctionResult({ abi: fluidLegacyLendingRatesAbi, functionName: 'getFTokenDetails', data: response.data });
          if (encodeFunctionResult({ abi: fluidLegacyLendingRatesAbi, functionName: 'getFTokenDetails', result: d }).toLowerCase() !== response.data.toLowerCase()) throw Error('Unverified fToken layout');
          const metadata = await tokenMetadata(client, d.asset, block);
          return result('ok', [quote(v, v, 'Fluid lending market', liquidityQuote(d.liquidityUserSupplyData.withdrawable, metadata.decimals, metadata.symbol, d.asset, 'Liquidity withdrawable by this fToken market under Fluid limits.'))]);
        }
      }
      return result('unsupported', [], 'No verified liquidity reader exists for this position type.');
    } catch { return result('error', [], 'Market liquidity could not be verified. The last successful reading is retained.'); }
  };
}
