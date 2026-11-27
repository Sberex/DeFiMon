import { expect, it } from 'vitest';
import { assetSafetySummary, parsePharosGrades, safetyGrades } from '../src/pharos-safety';
import { createPharosGradesReader } from '../server/pharos-safety';
import type { Portfolio, Position, WalletToken } from '../src/types';
const now = Date.now();
const rows = [{ id: 'usdc-circle', grade: 'A+', score: 91, ratingStatus: 'rated' }, { id: 'usdt-tether', grade: 'B', score: 75, ratingStatus: 'rated' }, { id: 'susdai-usd-ai', grade: 'C-', score: 54, ratingStatus: 'rated' }, { id: 'usde-ethena', grade: 'F', score: 30, ratingStatus: 'rated' }, { id: 'ybold-yearn', grade: 'NR', score: null, ratingStatus: 'not-rated' }];
const payload = () => ({ schemaVersion: 1, publicationStatus: 'current', asOfSec: Math.floor(now / 1000), methodologyVersion: '10.57', grades: rows });
const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', susdai = '0x0b2b2b2076d95dda7817e785989fe353fe955ef9', unknown = '0x1111111111111111111111111111111111111111';
const position = (overrides: Partial<Position> = {}): Position => ({ id: 'test', label: 'Test deposit', suppliedUsd: 200, debtUsd: 0, healthFactor: null, risk: 'no-debt', notes: [], assets: [{ address: usdc, symbol: 'USDC', supplied: 200, borrowed: 0, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null }], ...overrides });
const portfolio = (): Portfolio => ({ address: unknown, chain: 'Ethereum', updatedAt: new Date(now).toISOString(), blockNumber: '1', protocols: [], wallets: [] });
const token = (address: string, symbol: string, value: number | null, balance = 1): WalletToken => ({ address, symbol, balance, valueUsd: value, priceUsd: null });
it('validates current Pharos grades and rejects stale, held, duplicate, malformed and future-dated publications', () => {
  expect(parsePharosGrades(payload(), now).grades).toHaveLength(5);
  for (const invalid of [null, {}, { ...payload(), schemaVersion: 2 }, { ...payload(), publicationStatus: 'held' }, { ...payload(), asOfSec: now / 1000 - 73 * 3600 }, { ...payload(), asOfSec: Math.floor(now / 1000) + 600 }, { ...payload(), grades: [] }, { ...payload(), grades: [rows[0], rows[0]] }, { ...payload(), grades: [{ ...rows[0], score: 101 }] }, { ...payload(), grades: [{ ...rows[0], grade: 'excellent' }] }]) expect(() => parsePharosGrades(invalid, now)).toThrow();
  expect(safetyGrades.indexOf('A+')).toBeLessThan(safetyGrades.indexOf('A'));
  expect(safetyGrades.indexOf('D')).toBeLessThan(safetyGrades.indexOf('F'));
});
it('groups gross wallet and supplied exposure by exact contract, counts receipts once, includes Bad Debt and never adds borrowing', () => {
  const p = portfolio();
  p.wallets = [{ chain: 'Ethereum', status: 'ok', pricedValueUsd: 4100, unpricedCount: 1, coverage: '', tokens: [token(usdc, 'RENAMED', 100), token('native', 'ETH', 4000, 2), token(unknown, 'USDC', null, 3), { ...token('0x2222222222222222222222222222222222222222', 'aUSDC', 200), excludedReason: 'Counted by lending reader' }] }, { chain: 'Arc', status: 'ok', pricedValueUsd: 50, unpricedCount: 0, coverage: '', tokens: [token('native', 'USDC', 50, 50)] }];
  p.protocols = [{ id: 'morpho', name: 'Morpho', chain: 'Ethereum', status: 'ok', coverage: '', positions: [position({ debtUsd: 100, assets: [{ ...position().assets[0], borrowed: 100 }] }), position({ id: 'bad', suppliedUsd: 120, debtUsd: 200, riskAssessment: { reasons: ['Bad Debt'] }, assets: [{ ...position().assets[0], address: susdai, symbol: 'sUSDai', supplied: 100, priceUsd: 1.2 }] }), position({ id: 'vault', suppliedUsd: 50, vault: { address: unknown, version: 2, roles: [], totalAssets: 1000000, totalAssetsUsd: 1000000 }, assets: [{ ...position().assets[0], supplied: 50 }] })] }];
  const s = assetSafetySummary(p, parsePharosGrades(payload(), now));
  expect(s.groups.map(g => g.grade)).toEqual(['A+', 'C-', 'Not Rated']);
  expect(s.knownValueUsd).toBe(4520); expect(s.ratedValueUsd).toBe(520); expect(s.notRatedValueUsd).toBe(4000); expect(s.unpriced).toBe(1);
  const asset = s.groups[0].assets[0]; expect(asset.symbol).toBe('USDC'); expect(asset.valueUsd).toBe(400); expect(asset.holdings).toHaveLength(4);
  expect(s.groups[2].assets.some(a => a.holdings.some(h => h.amount === 3))).toBe(true);
});
it('preserves unpriced holdings and separates unallocatable position totals rather than assigning them an invented grade', () => {
  const p = portfolio();
  p.protocols = [{ id: 'fluid', name: 'Fluid', status: 'partial', balanceDiscoveryComplete: false, coverage: '', positions: [position({ suppliedUsd: 300, assets: [{ ...position().assets[0], priceUsd: null }, { ...position().assets[0], address: unknown, symbol: 'Other', priceUsd: null }] })] }];
  const summary = assetSafetySummary(p, parsePharosGrades(payload(), now));
  expect(summary.knownValueUsd).toBe(300); expect(summary.notRatedValueUsd).toBe(300); expect(summary.ratedValueUsd).toBe(0); expect(summary.unpriced).toBe(2); expect(summary.incomplete).toBe(true);
  expect(summary.groups.find(g => g.grade === 'Not Rated')!.assets.some(a => a.symbol === 'Unallocated supplied value')).toBe(true);
  p.protocols[0].positions[0].assets.pop();
  const single = assetSafetySummary(p, parsePharosGrades(payload(), now)); expect(single.ratedValueUsd).toBe(300); expect(single.unpriced).toBe(0);
});
it('keeps known values under Not Rated when the feed is unavailable and omits zero balances', () => {
  const p = portfolio(); p.wallets = [{ chain: 'Ethereum', status: 'error', pricedValueUsd: 30, unpricedCount: 0, coverage: '', tokens: [token(usdc, 'USDC', 30, 30), token(unknown, 'Empty', 0, 0)] }];
  const s = assetSafetySummary(p, null); expect(s.groups.map(g => g.grade)).toEqual(['Not Rated']); expect(s.notRatedValueUsd).toBe(30); expect(s.groups[0].assets).toHaveLength(1); expect(s.incomplete).toBe(true);
});
it('coalesces concurrent grade reads, expires its cache, and retries failed checks without serving stale ratings', async () => {
  let calls = 0, clock = now;
  const reader = createPharosGradesReader(async () => { calls++; return new Response(JSON.stringify(payload())); }, () => clock);
  const [a, b] = await Promise.all([reader(), reader()]); expect(a).toEqual(b); expect(calls).toBe(1);
  clock += 600001; await reader(); expect(calls).toBe(2);
  let attempts = 0; const failed = createPharosGradesReader(async () => { attempts++; return new Response('{}', { status: 503 }); }, () => clock);
  await expect(failed()).rejects.toThrow('temporarily unavailable'); await expect(failed()).rejects.toThrow(); expect(attempts).toBe(1);
  clock += 60001; await expect(failed()).rejects.toThrow(); expect(attempts).toBe(2);
});

it('keeps sUSDai rated D when unrelated Pharos entries have pipeline gaps', () => {
  const feed = parsePharosGrades({ ...payload(), grades: [
    { id: 'susdai-usd-ai', grade: 'D', score: 47, ratingStatus: 'rated' },
    { id: 'tbrl-tenbin', grade: null, score: null, ratingStatus: 'pipeline-gap', partialEvidence: { reasonCode: 'partial-evidence-pipeline-gap', excludedPillars: ['backing', 'exit'], causes: [] } },
    { id: 'tmxn-tenbin', grade: null, score: null, ratingStatus: 'pipeline-gap' },
  ] }, now);
  expect(feed.grades[0]).toMatchObject({ grade: 'D', score: 47 });
  expect(feed.grades[1]).toMatchObject({ grade: 'NR', ratingStatus: 'pipeline-gap' });
  const p = portfolio(); p.wallets = [{ chain: 'Ethereum', status: 'ok', pricedValueUsd: 100, unpricedCount: 0, coverage: '', tokens: [token(susdai, 'sUSDai', 100, 90)] }];
  expect(assetSafetySummary(p, feed).groups.map(g => g.grade)).toEqual(['D']);
  expect(parsePharosGrades(feed, now)).toEqual(feed);
});
