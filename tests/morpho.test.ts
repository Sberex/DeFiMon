import { describe, expect, it } from 'vitest';
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, keccak256, parseAbiParameters, type Address, type Hex } from 'viem';
import { morphoHealth, morphoSharesToAssets, readMorpho } from '../server/adapters/morpho';
import { MORPHO_BLUE, type MorphoDiscovery, type MorphoMarketRef, type MorphoToken, type MorphoVaultRef } from '../server/morpho-discovery';
import { morphoCoreAbi as coreAbi, morphoMulticallAbi as multiAbi, morphoVaultAbi as vaultAbi } from '../server/abis/morpho';
import type { ChainClient } from '../server/rpc';
const wallet = '0x1111111111111111111111111111111111111111';
const USDC = '0x2222222222222222222222222222222222222222';
const ETH = '0x3333333333333333333333333333333333333333';
const ORACLE = '0x4444444444444444444444444444444444444444';
const IRM = '0x5555555555555555555555555555555555555555';
const V1 = '0x6666666666666666666666666666666666666666';
const V2 = '0x7777777777777777777777777777777777777777';
const FACTORY = '0x8888888888888888888888888888888888888888';
const E18 = 10n ** 18n; const E6 = 10n ** 6n;
const loan: MorphoToken = { address: USDC, symbol: 'USDC', decimals: 6, priceUsd: 1 };
const collateral: MorphoToken = { address: ETH, symbol: 'WETH', decimals: 18, priceUsd: 3000 };
function fixture(options: { vaults?: boolean; market?: boolean; noDebt?: boolean; closed?: boolean; oracleFail?: boolean; oracleZero?: boolean; loanSupply?: bigint; missingLoanPrice?: boolean; missingCollateralPrice?: boolean; sameAsset?: boolean; unregistered?: boolean; invalidId?: boolean; metadataMismatch?: boolean; failSimulation?: boolean; loanPrice?: number } = {}) {
  const params = { loanToken: USDC, collateralToken: options.sameAsset ? USDC : ETH, oracle: ORACLE, irm: IRM, lltv: 860000000000000000n } as const;
  const id = keccak256(encodeAbiParameters(parseAbiParameters('address,address,address,address,uint256'), [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv]));
  const marketRef: MorphoMarketRef = { id: options.invalidId ? `0x${'a'.repeat(64)}` : id, loan: { ...loan, priceUsd: options.missingLoanPrice ? null : options.loanPrice ?? 1 }, collateral: options.sameAsset ? { ...loan } : { ...collateral, priceUsd: options.missingCollateralPrice ? null : 3000 } };
  const v1: MorphoVaultRef = { address: V1, name: 'Vault one', factory: FACTORY, version: 1, asset: loan };
  const v2: MorphoVaultRef = { address: V2, name: 'Vault two', factory: FACTORY, version: 2, asset: loan };
  const discovery: MorphoDiscovery = { markets: options.market === false ? [] : [marketRef], vaults: options.vaults ? [v1, v2] : [], successfulFamilies: 3, warnings: [] };
  const blocks: bigint[] = []; const simulated: string[][] = []; const calls: string[] = [];
  const client = {
    readContract: async ({ address, functionName, blockNumber }: { address: Address; functionName: string; blockNumber: bigint }) => {
      blocks.push(blockNumber); calls.push(`${address}:${functionName}`);
      switch (functionName) {
        case 'idToMarketParams': return params;
        case 'symbol': return address === ETH ? 'WETH' : 'USDC';
        case 'decimals': return options.metadataMismatch ? 8 : address === ETH ? 18 : 6;
        case 'price': if (options.oracleFail) throw new Error('secret provider details'); return options.oracleZero ? 0n : options.sameAsset ? 10n ** 36n : 3000n * 10n ** 24n;
        case 'isMetaMorpho': case 'isVaultV2': return !options.unregistered;
        case 'MORPHO': return MORPHO_BLUE;
        case 'asset': return USDC;
        case 'balanceOf': return options.closed ? 0n : 2n * E18;
        case 'convertToAssets': return 120n * E6;
        default: throw new Error(functionName);
      }
    },
    call: async ({ data, blockNumber }: { data: Hex; blockNumber: bigint }) => {
      blocks.push(blockNumber);
      if (options.failSimulation) throw new Error('secret provider details');
      const decoded = decodeFunctionData({ abi: multiAbi, data });
      expect(decoded.functionName).toBe('aggregate3');
      const batch = decoded.args[0]; expect(batch.every(c => c.allowFailure === false)).toBe(true);
      let output: Hex[];
      if (batch[0].target.toLowerCase() === MORPHO_BLUE.toLowerCase()) {
        const names = batch.map(c => decodeFunctionData({ abi: coreAbi, data: c.callData }).functionName);
        simulated.push(names); expect(names).toEqual(['accrueInterest', 'market', 'position']);
        const market = { totalSupplyAssets: 1_000_000n * E6, totalSupplyShares: 1_000_000n * E6 * 1_000_000n, totalBorrowAssets: 500_000n * E6, totalBorrowShares: 500_000n * E6 * 1_000_000n, lastUpdate: 123n, fee: 0n };
        const position = { supplyShares: options.closed ? 0n : (options.loanSupply ?? 500n) * E6 * 1_000_000n, borrowShares: options.noDebt || options.closed ? 0n : 2000n * E6 * 1_000_000n, collateral: options.closed ? 0n : options.sameAsset ? 10000n * E6 : 2n * E18 };
        output = ['0x', encodeFunctionResult({ abi: coreAbi, functionName: 'market', result: market }), encodeFunctionResult({ abi: coreAbi, functionName: 'position', result: position })];
      } else {
        const names = batch.map(c => decodeFunctionData({ abi: vaultAbi, data: c.callData }).functionName);
        simulated.push(names); expect(names).toEqual(['accrueInterest', 'balanceOf', 'totalSupply', '_totalAssets', 'virtualShares']);
        output = ['0x', encodeFunctionResult({ abi: vaultAbi, functionName: 'balanceOf', result: options.closed ? 0n : 100n * E18 }), encodeFunctionResult({ abi: vaultAbi, functionName: 'totalSupply', result: 1000n * E18 }), encodeFunctionResult({ abi: vaultAbi, functionName: '_totalAssets', result: 1000n * E6 }), encodeFunctionResult({ abi: vaultAbi, functionName: 'virtualShares', result: 10n ** 12n })];
      }
      return { data: encodeFunctionResult({ abi: multiAbi, functionName: 'aggregate3', result: output.map(returnData => ({ success: true, returnData })) }) };
    },
  } as unknown as ChainClient;
  return { client, discovery, blocks, simulated, calls, read: () => readMorpho(client, wallet, 123n, async () => discovery) };
}
describe('Morpho Blue markets', () => {
  it('simulates interest before reading shares and uses raw oracle scaling for risk and liquidation boundaries', async () => {
    const m = fixture(); const r = await m.read(); const p = r.positions[0];
    expect(r.status).toBe('ok'); expect(p.suppliedUsd).toBe(6500); expect(p.debtUsd).toBe(2000);
    expect(p.healthFactor).toBe(2.58); expect(p.risk).toBe('lower');
    expect(p.assets.find(a => a.symbol === 'WETH')?.liquidationPriceUsd).toBeCloseTo(1162.79069767);
    expect(p.liquidationQuote?.current).toBeCloseTo(3000); expect(p.liquidationQuote?.unit).toBe('USDC per WETH');
    expect(m.simulated).toEqual([['accrueInterest', 'market', 'position']]);
    expect(m.blocks.every(b => b === 123n)).toBe(true);
  });
  it('counts loan supply in net value but never uses it as borrowing protection', async () => {
    const result = await fixture({ loanSupply: 100000n }).read(); const p = result.positions[0];
    expect(p.suppliedUsd).toBe(106000); expect(p.healthFactor).toBe(2.58);
    expect(p.assets.find(a => a.symbol === 'USDC')).toMatchObject({ supplied: 100000, borrowed: 2000, collateral: false });
  });
  it('separates debt-free collateral deposits from liquidation-risk positions', async () => {
    const p = (await fixture({ noDebt: true }).read()).positions[0];
    expect(p.risk).toBe('no-debt'); expect(p.healthFactor).toBeNull(); expect(p.debtUsd).toBe(0);
    expect(p.assets.every(a => a.liquidationPriceUsd === null)).toBe(true);
  });
  it('retains quantities and oracle risk when either indicative USD price is missing', async () => {
    for (const opts of [{ missingLoanPrice: true }, { missingCollateralPrice: true }]) {
      const r = await fixture(opts).read(); const p = r.positions[0];
      expect(r.status).toBe('partial'); expect(p.suppliedUsd).toBeNull(); expect(p.healthFactor).toBe(2.58);
      expect(p.liquidationQuote?.threshold).toBeCloseTo(1162.79069767);
      if ('missingLoanPrice' in opts) { expect(p.debtUsd).toBeNull(); expect(p.assets.find(a => a.collateral)?.liquidationPriceUsd).toBeNull(); }
    }
  });
  it('does not assume the debt token trades at a dollar peg or use spot prices to determine health', async () => {
    const p = (await fixture({ loanPrice: .92 }).read()).positions[0];
    expect(p.debtUsd).toBe(1840); expect(p.healthFactor).toBe(2.58);
    expect(p.assets.find(a => a.collateral)?.liquidationPriceUsd).toBeCloseTo(1162.79069767 * .92);
  });
  it('withholds risk when the oracle reverts but respects an actual zero oracle value in protocol health', async () => {
    const failed = await fixture({ oracleFail: true }).read();
    expect(failed.status).toBe('partial'); expect(failed.positions[0].risk).toBe('unknown');
    expect(failed.positions[0].debtUsd).toBe(2000); expect(failed.positions[0].liquidationQuote).toBeUndefined();
    expect(JSON.stringify(failed)).not.toContain('secret provider details');
    const zero = await fixture({ oracleZero: true }).read();
    expect(zero.positions[0].healthFactor).toBe(0); expect(zero.positions[0].risk).toBe('liquidatable');
    expect(zero.positions[0].assets.every(a => a.liquidationPriceUsd === null)).toBe(true);
  });
  it('rejects market identity and token precision mismatches rather than showing incorrect balances', async () => {
    for (const options of [{ invalidId: true }, { metadataMismatch: true }]) {
      const r = await fixture(options).read(); expect(r.status).toBe('partial'); expect(r.positions[0].suppliedUsd).toBeNull(); expect(r.positions[0].risk).toBe('unknown');
    }
  });
  it('merges identical collateral/loan tokens without counting the loan deposit as extra collateral', async () => {
    const p = (await fixture({ sameAsset: true }).read()).positions[0];
    expect(p.assets).toHaveLength(1); expect(p.suppliedUsd).toBe(10500); expect(p.debtUsd).toBe(2000); expect(p.healthFactor).toBe(4.3);
    expect(p.assets[0].liquidationThreshold).toBeCloseTo(8600 / 10500);
    expect(p.assets[0].liquidationPriceUsd).toBeNull();
  });
});
describe('Morpho vault deposits', () => {
  it('converts vault V1 shares once and includes simulated V2 accrual/fee minting before valuing shares', async () => {
    const m = fixture({ market: false, vaults: true }); const r = await m.read();
    expect(r.status).toBe('ok'); expect(r.positions).toHaveLength(2);
    expect(r.positions.map(p => p.suppliedUsd)).toEqual([120, 100]);
    expect(r.positions.every(p => p.debtUsd === 0 && p.risk === 'no-debt' && p.healthFactor === null)).toBe(true);
    expect(m.calls).not.toContain(`${V2}:balanceOf`); // V2 balance is read after accrual inside the same simulation.
    expect(m.blocks.every(b => b === 123n)).toBe(true);
  });
  it('does not count a vault’s underlying loans a second time', async () => {
    const r = await fixture({ vaults: true }).read();
    expect(r.positions).toHaveLength(3);
    expect(r.positions.reduce((sum, p) => sum + p.suppliedUsd!, 0)).toBe(6720);
    expect(r.positions.reduce((sum, p) => sum + p.debtUsd!, 0)).toBe(2000);
  });
  it('rejects unregistered vaults and preserves unknown balances instead of a fake empty deposit', async () => {
    const r = await fixture({ market: false, vaults: true, unregistered: true }).read();
    expect(r.status).toBe('partial'); expect(r.positions).toHaveLength(2);
    expect(r.positions.every(p => p.suppliedUsd === null && p.risk === 'unknown')).toBe(true);
  });
});
it('distinguishes unavailable discovery, verified empty references, and closed on-chain positions', async () => {
  const m = fixture();
  await expect(readMorpho(m.client, wallet, 123n, async () => ({ markets: [], vaults: [], warnings: ['unavailable'], successfulFamilies: 0 }))).rejects.toThrow('discovery unavailable');
  expect((await fixture({ closed: true, vaults: true }).read()).positions).toEqual([]);
  expect((await readMorpho(m.client, wallet, 123n, async () => ({ markets: [], vaults: [], warnings: [], successfulFamilies: 3 }))).status).toBe('ok');
});
it('keeps successful discovery families while clearly marking incomplete coverage', async () => {
  const m = fixture(); m.discovery.successfulFamilies = 1; m.discovery.warnings.push('Vault lookup unavailable');
  const r = await m.read(); expect(r.status).toBe('partial'); expect(r.positions[0].suppliedUsd).toBe(6500);
});
it('prevents duplicate entries from inflating balances', async () => {
  const m = fixture({ vaults: true }); m.discovery.markets.push(m.discovery.markets[0]); m.discovery.vaults.push(m.discovery.vaults[0]);
  const r = await m.read(); expect(r.positions).toHaveLength(3); expect(r.status).toBe('partial');
});
it('rounds supply down and debt up with virtual assets/shares, including small positions', () => {
  expect(morphoSharesToAssets(1n, 0n, 0n)).toBe(0n);
  expect(morphoSharesToAssets(1n, 0n, 0n, true)).toBe(1n);
  expect(morphoSharesToAssets(1_000_000n, 10n, 1_000_000n)).toBe(5n);
  expect(morphoSharesToAssets(1_000_000n, 10n, 1_000_000n, true)).toBe(6n);
});
it('matches both protocol floor operations rather than overstating dust collateral capacity', () => {
  expect(morphoHealth(3n, 1n, 5n * 10n ** 35n, 800000000000000000n)).toBe(0);
  expect(morphoHealth(2n * E18, 2000n * E6, 3000n * 10n ** 24n, 860000000000000000n)).toBe(2.58);
  expect(morphoHealth(E18, 0n, null, E18)).toBeNull();
});
