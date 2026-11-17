import { expect, it, vi } from 'vitest';
import { applyPtCollateralRates } from '../server/pendle-collateral';
import { positionMonthlyInterest, totalMonthlyInterest, annualizedNplApr, supplyApr } from '../src/monthly-interest';
import type { ChainClient } from '../server/rpc';
import type { ProtocolResult } from '../src/types';
import type { PendleMarket } from '../server/pendle';
const addr = (c: string) => `0x${c.repeat(40)}` as `0x${string}`;
const PT = addr('1'), YT = addr('2'), SY = addr('3'), USDC = addr('4'), MARKET = addr('5');
const now = Date.parse('2026-11-17T10:00:00Z') / 1000;
function fixture(options: { expired?: boolean; mismatch?: boolean; noBlock?: boolean; stale?: boolean; apiFailure?: boolean; rate?: number; networkId?: number } = {}) {
  const expiry = options.expired ? now - 1 : now + 30 * 86400;
  const token = (address: `0x${string}`, symbol: string) => ({ address, symbol, decimals: 6, chainId: options.networkId ?? 1 });
  const market: PendleMarket = { address: MARKET, chainId: options.networkId ?? 1, pt: token(PT, 'PT-USD3-17DEC2026'), yt: token(YT, 'YT-USD3-17DEC2026'), sy: token(SY, 'SY-USD3'), accountingAsset: token(USDC, 'USDC'), expiry: new Date(expiry * 1000).toISOString(), dataUpdatedAt: new Date((now - (options.stale ? 1801 : 60)) * 1000).toISOString(), impliedApy: options.rate ?? .1507 };
  const readContract = vi.fn(async ({ functionName, blockNumber }: any) => { expect(blockNumber).toBe(123n); return functionName === 'readTokens' ? [SY, options.mismatch ? USDC : PT, YT] : BigInt(expiry); });
  const client = { getBlock: async () => { if (options.noBlock) throw new Error('secret-key'); return { timestamp: BigInt(now) }; }, readContract } as unknown as ChainClient;
  const catalog = vi.fn(async () => { if (options.apiFailure) throw new Error('secret-key'); return [market]; });
  const protocols: ProtocolResult[] = ['aave-v3', 'aave-v4', 'morpho', 'fluid', 'compound', 'euler'].map(id => ({ id, name: id, status: 'ok', coverage: '', positions: [{ id: 'loan', label: `${id} PT / USDC`, suppliedUsd: 990, debtUsd: 500, healthFactor: 1.5, risk: 'lower', notes: [], assets: [
    { symbol: 'PT-USD3-17DEC2026', address: PT, supplied: 1000, borrowed: 0, priceUsd: .99, collateral: true, liquidationThreshold: .9, liquidationPriceUsd: null, supplyRate: { apr: .02, note: 'Old protocol lending rate' } },
    { symbol: 'USDC', address: USDC, supplied: 0, borrowed: 500, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, borrowRate: { apr: .06, note: 'Debt rate' } },
  ] }] }));
  return { protocols, client, catalog, readContract, market };
}
it('uses exact PT addresses across all lending protocols, overriding rather than adding the base rate', async () => {
  const f = fixture(); const result = await applyPtCollateralRates(f.protocols, f.client, 'ethereum', 123n, f.catalog);
  for (const p of result) {
    const position = p.positions[0]; expect(position.assets[0].supplyRate?.apr).toBe(.1507);
    expect(position.assets[0].supplyRate?.pendlePt?.marketAddress).toBe(MARKET);
    expect(positionMonthlyInterest(position).earnedUsd).toBeCloseTo(990 * .1507 / 12);
    expect(positionMonthlyInterest(position).nplUsd).toBeCloseTo(990 * .1507 / 12 - 500 * .06 / 12);
    expect(annualizedNplApr(positionMonthlyInterest(position).nplUsd, 490)).toBeCloseTo((990 * .1507 - 500 * .06) / 490);
  }
  expect(f.readContract).toHaveBeenCalledTimes(3); expect(f.protocols[0].positions[0].assets[0].supplyRate?.apr).toBe(.02);
  const total = totalMonthlyInterest(result); expect(total.nplUsd).toBeCloseTo(6 * (990 * .1507 / 12 - 2.5));
  const again = await applyPtCollateralRates(result, f.client, 'ethereum', 123n, f.catalog);
  expect(totalMonthlyInterest(again).nplUsd).toBe(total.nplUsd);
});
it('removes a duplicate intrinsic rate while retaining separately matched incentives once', async () => {
  const f = fixture(); const asset = f.protocols[0].positions[0].assets[0];
  asset.intrinsicSupplyRate = { apr: .08, estimated: true, note: '', source: { chain: 'Ethereum', oracle: SY } };
  asset.merklSupplyRate = { apr: .01, note: 'Existing matched reward', components: [] };
  const result = await applyPtCollateralRates(f.protocols, f.client, 'ethereum', 123n, f.catalog), updated = result[0].positions[0].assets[0];
  expect(updated.intrinsicSupplyRate).toBeUndefined(); expect(supplyApr(updated.supplyRate, updated.intrinsicSupplyRate, updated.merklSupplyRate)).toBeCloseTo(.1607);
});
it('uses zero accretion at maturity and unknown for stale, missing or unverified active PT yields', async () => {
  const expired = fixture({ expired: true, stale: true });
  expect((await applyPtCollateralRates(expired.protocols, expired.client, 'ethereum', 123n, expired.catalog))[0].positions[0].assets[0].supplyRate?.apr).toBe(0);
  for (const options of [{ stale: true }, { mismatch: true }, { noBlock: true }, { apiFailure: true }, { rate: Infinity }]) {
    const f = fixture(options), r = await applyPtCollateralRates(f.protocols, f.client, 'ethereum', 123n, f.catalog, async () => null);
    expect(r[0].positions[0].assets[0].supplyRate?.apr).toBeNull(); expect(totalMonthlyInterest(r).nplUsd).toBeNull(); expect(JSON.stringify(r)).not.toContain('secret-key');
  }
});
it('does not assign a known PT APY to YT, ordinary collateral, deposits or zero balances', async () => {
  const f = fixture(); const a = f.protocols[0].positions[0].assets[0];
  a.address = YT; a.symbol = 'YT-USD3';
  f.protocols[1].positions[0].assets[0].collateral = false;
  f.protocols[2].positions[0].assets[0].supplied = 0;
  f.protocols[3].positions[0].assets[0].address = USDC; f.protocols[3].positions[0].assets[0].symbol = 'USDC';
  const r = await applyPtCollateralRates(f.protocols, f.client, 'ethereum', 123n, f.catalog);
  expect(r.slice(0, 4).map(p => p.positions[0].assets[0].supplyRate?.apr)).toEqual([.02, .02, .02, .02]);
});
it.each([['plasma', 9745], ['arbitrum', 42161], ['base', 8453]] as const)('looks up %s PT yields on the selected network', async (network, networkId) => {
  const f = fixture({ networkId }); const r = await applyPtCollateralRates(f.protocols, f.client, network, 123n, f.catalog);
  expect(f.catalog).toHaveBeenCalledWith(network); expect(r[0].positions[0].assets[0].supplyRate?.apr).toBe(.1507);
});
it('uses refreshed individual-market APY for PT collateral monthly income when the catalog is stale', async () => {
  const f = fixture({ stale: true });
  const refresh = vi.fn(async () => ({ ...f.market, impliedApy: .1416, dataUpdatedAt: new Date(now * 1000).toISOString() }));
  const result = await applyPtCollateralRates(f.protocols, f.client, 'ethereum', 123n, f.catalog, refresh);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(result[0].positions[0].assets[0].supplyRate?.apr).toBe(.1416);
  expect(positionMonthlyInterest(result[0].positions[0]).earnedUsd).toBeCloseTo(990 * .1416 / 12);
});
