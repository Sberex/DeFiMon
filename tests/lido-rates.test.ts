import { expect, it, vi } from 'vitest';
import { applyLidoRates, createLidoRateService, LIDO_WSTETH, LIDO_APR_URL } from '../server/lido-rates';
import { positionMonthlyInterest, totalMonthlyInterest, annualizedNplApr, monthlyInterestIssues, supplyApr } from '../src/monthly-interest';
import type { ProtocolResult } from '../src/types';
const NOW = Date.parse('2026-11-17T12:00:00Z');
function response(apr = 2.34) {
  return { data: { smaApr: apr, aprs: Array.from({ length: 7 }, (_, i) => ({ timeUnix: NOW / 1000 - (6 - i) * 86400, apr })) }, meta: { chainId: 1, address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', symbol: 'stETH' } };
}
function protocols(address = LIDO_WSTETH.ethereum): ProtocolResult[] {
  return ['aave-v3', 'aave-v4', 'morpho', 'fluid', 'compound', 'euler'].map(id => ({ id, name: id, status: 'ok', coverage: '', positions: [{ id: 'loan', label: 'wstETH / USDC', suppliedUsd: 10000, debtUsd: 5000, healthFactor: 1.5, risk: 'lower', notes: [], assets: [
    { address, symbol: 'wstETH', supplied: 5, borrowed: 0, priceUsd: 2000, collateral: true, liquidationThreshold: .8, liquidationPriceUsd: null, supplyRate: { apr: .01, note: 'Protocol lending interest' } },
    { address: '0x1111111111111111111111111111111111111111', symbol: 'USDC', supplied: 0, borrowed: 5000, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, borrowRate: { apr: .04, note: 'Borrow APR' } },
  ] }] }));
}
it('converts Lido percentage APR into the rate fraction once and identifies its seven-day source', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(response())));
  const load = createLidoRateService(fetcher as any, () => NOW), quote = await load();
  expect(quote.apr).toBeCloseTo(.0234); expect(fetcher).toHaveBeenCalledWith(LIDO_APR_URL, expect.anything());
  expect(quote.source).toMatchObject({ kind: 'lido', windowDays: 7, endTimestamp: NOW / 1000, url: 'https://lido.fi/', oracle: '' });
});
it('deduplicates concurrent requests, caches valid rates for five minutes and retries failed reads after one minute', async () => {
  let now = NOW, fail = false; const fetcher = vi.fn(async () => fail ? new Response('', { status: 503 }) : new Response(JSON.stringify(response())));
  const load = createLidoRateService(fetcher as any, () => now);
  const [a,b] = await Promise.all([load(),load()]); expect(a).toBe(b); expect(fetcher).toHaveBeenCalledTimes(1);
  now += 300001; fail = true; expect((await load()).apr).toBeNull(); await load(); expect(fetcher).toHaveBeenCalledTimes(2);
  now += 60001; fail = false; expect((await load()).apr).toBeCloseTo(.0234); expect(fetcher).toHaveBeenCalledTimes(3);
});
it('rejects stale reports, wrong identity, duplicate observations, inconsistent averages and unreadable API responses', async () => {
  for (const mutation of [
    (r: ReturnType<typeof response>) => { r.meta.chainId = 42161; },
    (r: ReturnType<typeof response>) => { r.meta.address = LIDO_WSTETH.ethereum; },
    (r: ReturnType<typeof response>) => { r.data.smaApr = 6; },
    (r: ReturnType<typeof response>) => { r.data.aprs.forEach(o => { o.timeUnix -= 4 * 86400; }); },
    (r: ReturnType<typeof response>) => { r.data.aprs[0].timeUnix = NOW / 1000 + 3600; },
    (r: ReturnType<typeof response>) => { r.data.aprs[0].timeUnix = r.data.aprs[1].timeUnix; },
  ]) {
    const r = response(); mutation(r);
    expect((await createLidoRateService((async () => new Response(JSON.stringify(r))) as any, () => NOW)()).apr).toBeNull();
  }
  const unavailable = await createLidoRateService((async () => { throw new Error('private-key'); }) as any, () => NOW)();
  expect(unavailable.apr).toBeNull(); expect(JSON.stringify(unavailable)).not.toContain('private-key');
});
it('keeps genuine zero or negative APR rather than silently replacing losses', async () => {
  for (const apr of [0, -1]) expect((await createLidoRateService((async () => new Response(JSON.stringify(response(apr)))) as any, () => NOW)()).apr).toBe(apr / 100);
});
it.each(['ethereum', 'plasma', 'arbitrum', 'base'] as const)('applies staking yield exactly once to %s collateral across lending protocols and NPL totals', async network => {
  const p = protocols(LIDO_WSTETH[network]), load = createLidoRateService((async () => new Response(JSON.stringify(response()))) as any, () => NOW);
  const r = await applyLidoRates(p, network, load);
  for (const protocol of r) {
    const pos = protocol.positions[0], a = pos.assets[0];
    expect(supplyApr(a.supplyRate, a.intrinsicSupplyRate)).toBeCloseTo(.0334);
    expect(positionMonthlyInterest(pos).earnedUsd).toBeCloseTo(10000 * .0334 / 12);
    expect(positionMonthlyInterest(pos).nplUsd).toBeCloseTo((334 - 200) / 12);
    expect(annualizedNplApr(positionMonthlyInterest(pos).nplUsd, 5000)).toBeCloseTo(.0268);
  }
  const again = await applyLidoRates(r, network, load);
  expect(totalMonthlyInterest(again).nplUsd).toBe(totalMonthlyInterest(r).nplUsd);
  expect(p[0].positions[0].assets[0].intrinsicSupplyRate).toBeUndefined();
});
it('matches exact network/contracts and excludes deposits without collateral, zero supplies and ticker lookalikes', async () => {
  const p = protocols(); p[0].positions[0].assets[0].address = LIDO_WSTETH.arbitrum;
  p[1].positions[0].assets[0].collateral = false; p[2].positions[0].assets[0].supplied = 0;
  p[3].positions[0].assets[0].address = '0x1111111111111111111111111111111111111111';
  const load = createLidoRateService((async () => new Response(JSON.stringify(response()))) as any, () => NOW);
  const r = await applyLidoRates(p, 'ethereum', load);
  expect(r.slice(0,4).every(p => !p.positions[0].assets[0].intrinsicSupplyRate)).toBe(true);
  const none = vi.fn(); await applyLidoRates(p.slice(0,4), 'ethereum', none); expect(none).not.toHaveBeenCalled();
});
it('keeps failed Lido earnings unknown, identifies the missing source and retains matched rewards separately', async () => {
  const p = protocols(); p[0].positions[0].assets[0].merklSupplyRate = { apr: .005, note: 'Matched reward', components: [] };
  const good = await applyLidoRates(p, 'ethereum', createLidoRateService((async () => new Response(JSON.stringify(response()))) as any, () => NOW));
  const a = good[0].positions[0].assets[0]; expect(supplyApr(a.supplyRate, a.intrinsicSupplyRate, a.merklSupplyRate)).toBeCloseTo(.0384);
  const bad = await applyLidoRates(p, 'ethereum', async () => { throw new Error('secret'); });
  expect(totalMonthlyInterest(bad).nplUsd).toBeNull(); expect(monthlyInterestIssues(bad)[0].reason).toContain('Lido staking APR unavailable');
});
