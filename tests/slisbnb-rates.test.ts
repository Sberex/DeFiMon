import { expect, it, vi } from 'vitest';
import { applySlisBnbRates, createSlisBnbRateService, SLISBNB, SLISBNB_MARKET } from '../server/slisbnb-rates';
import { annualizedNplApr, monthlyInterestIssues, positionMonthlyInterest, supplyApr, totalMonthlyInterest } from '../src/monthly-interest';
import type { ProtocolResult } from '../src/types';
const NOW = Date.parse('2026-11-20T12:00:00Z');
const response = () => ({ code: '000000000', timestamp: NOW, data: { marketId: SLISBNB_MARKET, chain: 'bsc', collateralToken: SLISBNB, collateralNativeApy: '0.01519' } });
function protocols(): ProtocolResult[] {
  return ['lista', 'aave-v3', 'euler', 'fluid'].map(id => ({ id, name: id, status: 'ok', coverage: '', positions: [{ id: 'loan', label: 'slisBNB / USD1', suppliedUsd: 85469.03, debtUsd: 49887.23, healthFactor: 1.47, risk: 'lower', notes: [], assets: [
    { address: SLISBNB, symbol: 'slisBNB', supplied: 144.95, borrowed: 0, priceUsd: 85469.03 / 144.95, collateral: true, liquidationThreshold: .86, liquidationPriceUsd: null, supplyRate: { apr: 0, note: 'Collateral earns no lending interest' } },
    { address: '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d', symbol: 'USD1', supplied: 0, borrowed: 49887.23, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, borrowRate: { apr: .03, note: 'Borrow APR' } },
  ] }] }));
}
it('uses Lista native APR fraction without dividing by 100 or converting it from APY', async () => {
  const q = await createSlisBnbRateService((async () => Response.json(response())) as any, () => NOW)();
  expect(q.apr).toBe(.01519); expect(q.source).toMatchObject({ kind: 'lista', chain: 'Binance Smart Chain', endTimestamp: NOW / 1000 });
});
it('adds collateral income once to supply APR, monthly NPL and APR across protocols while preserving lending and rewards', async () => {
  const p = protocols(), load = createSlisBnbRateService((async () => Response.json(response())) as any, () => NOW);
  const r = await applySlisBnbRates(p, 'bsc', load);
  for (const protocol of r) {
    const pos = protocol.positions[0], a = pos.assets[0], m = positionMonthlyInterest(pos);
    expect(supplyApr(a.supplyRate, a.intrinsicSupplyRate)).toBe(.01519);
    expect(m.earnedUsd).toBeCloseTo(85469.03 * .01519 / 12);
    expect(m.nplUsd).toBeCloseTo((85469.03 * .01519 - 49887.23 * .03) / 12);
    expect(annualizedNplApr(m.nplUsd, pos.suppliedUsd! - pos.debtUsd!)).toBeCloseTo((85469.03 * .01519 - 49887.23 * .03) / 35581.8);
  }
  expect(totalMonthlyInterest(await applySlisBnbRates(r, 'bsc', load))).toEqual(totalMonthlyInterest(r));
  expect(p[0].positions[0].assets[0].intrinsicSupplyRate).toBeUndefined();
  const a = r[0].positions[0].assets[0]; a.supplyRate = { apr: .01, note: 'Lending' }; a.merklSupplyRate = { apr: .005, note: 'Rewards', components: [] };
  expect(supplyApr(a.supplyRate, a.intrinsicSupplyRate, a.merklSupplyRate)).toBeCloseTo(.03019);
});
it('matches exact BSC collateral contract only, never ticker lookalikes or borrowed-only/deposit assets', async () => {
  const p = protocols(), load = vi.fn();
  p[0].positions[0].assets[0].collateral = false; p[1].positions[0].assets[0].supplied = 0;
  p[2].positions[0].assets[0].address = '0x1111111111111111111111111111111111111111';
  await applySlisBnbRates(p.slice(0,3), 'bsc', load); expect(load).not.toHaveBeenCalled();
  for (const network of ['ethereum', 'arbitrum', 'plasma', 'base'] as const) await applySlisBnbRates(p, network, load);
  expect(load).not.toHaveBeenCalled();
});
it('rejects stale, malformed and wrong-identity quotes and keeps unavailable staking earnings unknown', async () => {
  for (const mutate of [
    (j: ReturnType<typeof response>) => { j.data.chain = 'ethereum'; },
    (j: ReturnType<typeof response>) => { j.data.collateralToken = '0x1111111111111111111111111111111111111111'; },
    (j: ReturnType<typeof response>) => { j.data.marketId = 'wrong'; },
    (j: ReturnType<typeof response>) => { j.code = 'failure'; },
    (j: ReturnType<typeof response>) => { j.timestamp -= 3600001; },
    (j: ReturnType<typeof response>) => { j.timestamp += 300001; },
    ...['', 'NaN', '1.519', '-1', '1e-2'].map(value => (j: ReturnType<typeof response>) => { j.data.collateralNativeApy = value; }),
  ]) {
    const j = response(); mutate(j);
    expect((await createSlisBnbRateService((async () => Response.json(j)) as any, () => NOW)()).apr).toBeNull();
  }
  const p = await applySlisBnbRates(protocols(), 'bsc', async () => { throw new Error('private-provider-secret'); });
  expect(totalMonthlyInterest(p).nplUsd).toBeNull(); expect(monthlyInterestIssues(p)[0].reason).toContain('Lista slisBNB staking APR unavailable');
  expect(JSON.stringify(p)).not.toContain('private-provider-secret');
});
it('caches one concurrent request, refreshes after five minutes, retries failures after one minute, and accepts verified zero', async () => {
  let now = NOW, fail = false;
  const fetcher = vi.fn(async () => fail ? new Response('', { status: 503 }) : Response.json({ ...response(), timestamp: now }));
  const load = createSlisBnbRateService(fetcher as any, () => now);
  await Promise.all([load(), load()]); expect(fetcher).toHaveBeenCalledTimes(1);
  now += 300001; fail = true; expect((await load()).apr).toBeNull(); await load(); expect(fetcher).toHaveBeenCalledTimes(2);
  now += 60001; fail = false; expect((await load()).apr).toBe(.01519); expect(fetcher).toHaveBeenCalledTimes(3);
  const j = response(); j.data.collateralNativeApy = '0'; expect((await createSlisBnbRateService((async () => Response.json(j)) as any, () => NOW)()).apr).toBe(0);
});
