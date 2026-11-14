import { describe, expect, it } from 'vitest';
import { parseUnits } from 'viem';
import { mergeV4Assets, readAaveV4 } from '../server/adapters/aave-v4';
import { AAVE_V4_SPOKES, AAVE_V4_TOKENIZATION_SPOKES } from '../server/deployments/aave-v4';
import type { Asset } from '../src/types';
import type { ChainClient } from '../server/rpc';
const wallet = '0x1111111111111111111111111111111111111111';
const M1 = { address: '0x2222222222222222222222222222222222222222', label: 'MAIN' } as const;
const M2 = { address: '0x3333333333333333333333333333333333333333', label: 'BLUECHIP' } as const;
const T1 = { address: '0x4444444444444444444444444444444444444444', label: 'CORE USDC' } as const;
const ETH = '0x5555555555555555555555555555555555555555';
const USDC = '0x6666666666666666666666666666666666666666';
const HUB = '0x7777777777777777777777777777777777777777';
const ORACLE = '0x8888888888888888888888888888888888888888';
const E18 = 10n ** 18n;
const emptyUser = { drawnShares: 0n, premiumShares: 0n, premiumOffsetRay: 0n, suppliedShares: 0n, dynamicConfigKey: 0 };
const onlyMarket = { spokes: [M1], tokenizations: [] };
function fixture(options: { empty?: boolean; noDebt?: boolean; failAccount?: boolean; failSecondMarket?: boolean; failCount?: boolean; missingEthPrice?: boolean; zeroPrice?: boolean; badDecimals?: boolean; tokenized?: boolean; badTokenizedFeed?: boolean; failTokenized?: boolean; disabledDeposit?: boolean; failReserve?: boolean } = {}) {
  const blocks: bigint[] = [];
  const calls: { name: string; address: string; args: readonly unknown[] }[] = [];
  const client = { readContract: async ({ functionName, address, args = [], blockNumber }: { functionName: string; address: string; args?: unknown[]; blockNumber: bigint }) => {
    blocks.push(blockNumber); calls.push({ name: functionName, address, args });
    if (options.failSecondMarket && address === M2.address) throw new Error('secret-rpc-key');
    switch (functionName) {
      case 'getReserveCount': if (options.failCount) throw new Error('secret-rpc-key'); return 2n;
      case 'ORACLE': return ORACLE;
      case 'getUserPosition':
        if (options.empty) return { ...emptyUser };
        return args[0] === 0n ? { ...emptyUser, suppliedShares: 9n * E18, dynamicConfigKey: 7 } : { ...emptyUser, drawnShares: options.noDebt ? 0n : 1n, premiumShares: options.noDebt ? 0n : 1n, suppliedShares: options.disabledDeposit ? 1n : 0n, dynamicConfigKey: 7 };
      case 'getReserve':
        if (options.failReserve) throw new Error('unreadable reserve');
        return { underlying: args[0] === 0n ? ETH : USDC, hub: HUB, assetId: Number(args[0]), decimals: args[0] === 0n ? 18 : 6, collateralRisk: 500, flags: 0, dynamicConfigKey: 99 };
      case 'getUserSuppliedAssets': return args[0] === 0n ? 10n * E18 : options.disabledDeposit ? 1000_000000n : 0n;
      case 'getUserTotalDebt': return args[0] === 1n && !options.noDebt ? 15000_500000n : 0n; // Includes .5 USDC premium debt.
      case 'getUserReserveStatus': return [args[0] === 0n, args[0] === 1n && !options.noDebt];
      case 'getDynamicReserveConfig':
        expect(args[1]).toBe(7); // Never the reserve's current key 99.
        return { collateralFactor: 8000, maxLiquidationBonus: 10500, liquidationFee: 1000 };
      case 'getUserAccountData':
        if (options.failAccount) throw new Error('oracle failed');
        return { riskPremium: 500n, avgCollateralFactor: parseUnits('.8', 18), healthFactor: options.noDebt ? 2n ** 256n - 1n : parseUnits('1.6', 18), totalCollateralValue: parseUnits('30000', 26), totalDebtValueRay: options.noDebt ? 0n : parseUnits('15000.5', 53), activeCollateralCount: 1n, borrowCount: options.noDebt ? 0n : 1n };
      case 'getReservePrice':
        if (options.missingEthPrice && args[0] === 0n) throw new Error('price unavailable');
        if (options.zeroPrice) return 0n;
        return args[0] === 0n ? 3000_00000000n : 100000000n;
      case 'symbol': return address === ETH ? 'WETH' : 'USDC';
      case 'decimals': return address === ORACLE ? options.badDecimals ? 18 : 8 : address === ETH ? 18 : 6;
      case 'balanceOf': if (options.failTokenized) throw new Error('secret-rpc-key'); return options.tokenized ? 2n * E18 : 0n;
      case 'asset': return USDC;
      case 'convertToAssets': expect(args[0]).toBe(2n * E18); return 120_000000n;
      case 'hub': return HUB;
      case 'assetId': return 1n;
      case 'getReserveId':
        if (options.badTokenizedFeed) throw new Error('Reserve not listed');
        expect(args).toEqual([HUB, 1n]); return 1n;
      default: throw new Error(functionName);
    }
  } } as unknown as ChainClient;
  return { client, blocks, calls };
}
describe('Aave v4 lending positions', () => {
  it('normalizes accrued supply, premium-inclusive debt, native account Value/Ray, and USD prices', async () => {
    const m = fixture(); const result = await readAaveV4(m.client, wallet, 123n, onlyMarket); const p = result.positions[0];
    expect(result.status).toBe('ok'); expect(p.suppliedUsd).toBe(30000); expect(p.debtUsd).toBe(15000.5);
    expect(p.healthFactor).toBe(1.6); expect(p.risk).toBe('lower');
    expect(p.assets[0]).toMatchObject({ supplied: 10, borrowed: 0, priceUsd: 3000, liquidationThreshold: .8 });
    expect(p.assets[1].borrowed).toBe(15000.5);
    expect(p.assets[0].liquidationPriceUsd).toBeCloseTo(1875.0625);
    expect(m.blocks.every(b => b === 123n)).toBe(true);
  });
  it('uses the wallet config key and includes disabled collateral in net value without counting it as protection', async () => {
    const m = fixture({ disabledDeposit: true }); const result = await readAaveV4(m.client, wallet, 123n, onlyMarket);
    const p = result.positions[0];
    expect(p.suppliedUsd).toBe(31000);
    expect(p.assets[1]).toMatchObject({ supplied: 1000, borrowed: 15000.5, collateral: false });
    expect(p.assets[1].liquidationPriceUsd).toBeNull();
    expect(p.assets[0].liquidationPriceUsd).toBeCloseTo(1875.0625);
    expect(m.calls.filter(c => c.name === 'getDynamicReserveConfig')).toHaveLength(1);
  });
  it('keeps each lending market separate rather than offsetting debt with collateral in another market', async () => {
    const result = await readAaveV4(fixture().client, wallet, 123n, { spokes: [M1, M2], tokenizations: [] });
    expect(result.positions).toHaveLength(2);
    expect(result.positions.map(p => p.healthFactor)).toEqual([1.6, 1.6]);
    expect(result.positions[0].id).not.toBe(result.positions[1].id);
  });
  it('isolates a failed market and retains successful balances without leaking provider details', async () => {
    const result = await readAaveV4(fixture({ failSecondMarket: true }).client, wallet, 123n, { spokes: [M1, M2], tokenizations: [] });
    expect(result.status).toBe('partial'); expect(result.positions).toHaveLength(2);
    expect(result.positions[0].suppliedUsd).toBe(30000);
    expect(result.positions[1]).toMatchObject({ suppliedUsd: null, debtUsd: null, healthFactor: null, risk: 'unknown' });
    expect(JSON.stringify(result)).not.toContain('secret-rpc-key');
  });
  it('retains balances while withholding risk and liquidation prices if the native account cannot be read', async () => {
    const result = await readAaveV4(fixture({ failAccount: true }).client, wallet, 123n, onlyMarket);
    const p = result.positions[0];
    expect(result.status).toBe('partial'); expect(p.suppliedUsd).toBe(30000); expect(p.debtUsd).toBe(15000.5);
    expect(p.risk).toBe('unknown'); expect(p.healthFactor).toBeNull();
    expect(p.assets.every(a => a.liquidationPriceUsd === null)).toBe(true);
  });
  it('retains authoritative health and quantities if a USD price is missing, and never invents a zero dollar balance', async () => {
    const result = await readAaveV4(fixture({ missingEthPrice: true }).client, wallet, 123n, onlyMarket);
    const p = result.positions[0];
    expect(result.status).toBe('partial'); expect(p.suppliedUsd).toBeNull(); expect(p.healthFactor).toBe(1.6);
    expect(p.assets[0].priceUsd).toBeNull(); expect(p.assets[0].supplied).toBe(10);
    expect(p.assets[0].liquidationPriceUsd).toBeNull();
  });
  it('treats invalid oracle prices or precision as unknown rather than assuming a dollar peg', async () => {
    for (const options of [{ zeroPrice: true }, { badDecimals: true }]) {
      const result = await readAaveV4(fixture(options).client, wallet, 123n, onlyMarket);
      expect(result.status).toBe('partial'); expect(result.positions[0].suppliedUsd).toBeNull();
      expect(result.positions[0].assets.every(a => a.priceUsd === null)).toBe(true);
      if ('badDecimals' in options) expect(result.positions[0].debtUsd).toBeNull();
    }
  });
  it('handles debt-free positions without exposing the native max-uint health sentinel', async () => {
    const result = await readAaveV4(fixture({ noDebt: true }).client, wallet, 123n, onlyMarket);
    const p = result.positions[0];
    expect(p.risk).toBe('no-debt'); expect(p.debtUsd).toBe(0); expect(p.healthFactor).toBeNull();
    expect(p.assets.every(a => a.liquidationPriceUsd === null)).toBe(true);
  });
  it('does not report incomplete reserve reads as a debt-free or empty position', async () => {
    await expect(readAaveV4(fixture({ failReserve: true }).client, wallet, 123n, onlyMarket)).rejects.toThrow('deployment could not be read');
  });
  it('returns empty only after checking all user reserves successfully', async () => {
    const m = fixture({ empty: true }); const result = await readAaveV4(m.client, wallet, 123n, onlyMarket);
    expect(result.status).toBe('ok'); expect(result.positions).toEqual([]);
    expect(m.calls.filter(c => c.name === 'getUserPosition')).toHaveLength(2);
  });
});
describe('Aave v4 tokenized deposits', () => {
  it('counts current underlying once, prices it through a matching hub/asset reserve, and does not invent liquidation risk', async () => {
    const m = fixture({ empty: true, tokenized: true });
    const result = await readAaveV4(m.client, wallet, 123n, { spokes: [M1], tokenizations: [T1] });
    expect(result.status).toBe('ok'); expect(result.positions).toHaveLength(1);
    expect(result.positions[0]).toMatchObject({ suppliedUsd: 120, debtUsd: 0, healthFactor: null, risk: 'no-debt' });
    expect(result.positions[0].assets[0]).toMatchObject({ supplied: 120, borrowed: 0, collateral: false, liquidationPriceUsd: null });
    expect(m.blocks.every(b => b === 123n)).toBe(true);
  });
  it('preserves deposit quantities when no trustworthy matching USD price is available', async () => {
    const result = await readAaveV4(fixture({ empty: true, tokenized: true, badTokenizedFeed: true }).client, wallet, 123n, { spokes: [M1], tokenizations: [T1] });
    expect(result.status).toBe('partial'); expect(result.positions[0].suppliedUsd).toBeNull();
    expect(result.positions[0].assets[0].supplied).toBe(120);
  });
  it('does not duplicate tokenized shares in lending positions', async () => {
    const result = await readAaveV4(fixture({ tokenized: true }).client, wallet, 123n, { spokes: [M1], tokenizations: [T1] });
    expect(result.positions).toHaveLength(2);
    expect(result.positions.reduce((sum, p) => sum + p.suppliedUsd!, 0)).toBe(30120);
  });
  it('keeps lending data when a tokenized deposit contract cannot be checked', async () => {
    const result = await readAaveV4(fixture({ failTokenized: true }).client, wallet, 123n, { spokes: [M1], tokenizations: [T1] });
    expect(result.status).toBe('partial'); expect(result.positions[0].suppliedUsd).toBe(30000);
    expect(result.positions[1].suppliedUsd).toBeNull(); expect(result.positions[1].risk).toBe('unknown');
  });
});
it('retains on-chain hub and asset IDs for exact Merkl campaign matching', async () => {
  const result = await readAaveV4(fixture().client, wallet, 123n, onlyMarket);
  const eth = result.positions[0].assets.find(a => a.address === ETH)!;
  expect(eth.v4Reserves).toEqual([{ hub: HUB, assetId: '0', supplied: 10, borrowed: 0 }]);
});

it('merges same-token reserves with enabled-only collateral weights and debt exposure', () => {
  const a: Asset = { address: ETH, symbol: 'WETH', supplied: 2, borrowed: 0, priceUsd: 3000, collateral: true, liquidationThreshold: .8, liquidationPriceUsd: null };
  const [merged] = mergeV4Assets([a, { ...a, supplied: 2, liquidationThreshold: .9 }, { ...a, supplied: 1, borrowed: 1, collateral: false, liquidationThreshold: null }]);
  expect(merged.supplied).toBe(5); expect(merged.borrowed).toBe(1);
  const [withReserves] = mergeV4Assets([{ ...a, v4Reserves: [{ hub: HUB, assetId: '5', supplied: 2, borrowed: 0 }] }, { ...a, v4Reserves: [{ hub: M2.address, assetId: '7', supplied: 2, borrowed: 0 }] }]);
  expect(withReserves.v4Reserves).toHaveLength(2);
  expect(withReserves.v4Reserves!.map(r => r.assetId)).toEqual(['5', '7']);
  expect(merged.liquidationThreshold).toBeCloseTo(.68); // (2*.8 + 2*.9) / 5.
  expect(() => mergeV4Assets([a, { ...a, priceUsd: 2900 }])).toThrow('Inconsistent reserve prices');
});
it('pins unique official lending/tokenization deployments without double counting infrastructure', () => {
  expect(AAVE_V4_SPOKES).toHaveLength(14); expect(AAVE_V4_TOKENIZATION_SPOKES).toHaveLength(37);
  const addresses = [...AAVE_V4_SPOKES, ...AAVE_V4_TOKENIZATION_SPOKES].map(s => s.address.toLowerCase());
  expect(new Set(addresses).size).toBe(51);
});
