import { expect, it, vi } from 'vitest';
import { publishLiquidityObservations, LIQUIDITY_STATE_PATH, LIQUIDITY_NOTIFICATIONS_PATH } from '../server/liquidity-alert-store';
import { advanceLiquidityAlerts, emptyLiquidityNotifications, emptyLiquidityState } from '../server/liquidity-alert-tracker';
import { defaultAlertRules } from '../src/alert-rules';
import type { LiquidityObservation, LiquidityWatch } from '../server/liquidity-alert-reader';
const time = '2026-11-22T10:00:00.000Z', later = '2026-11-22T10:05:00.000Z';
const watch: LiquidityWatch = { address: '0x1111111111111111111111111111111111111111', network: 'ethereum', protocol: 'morpho', positionId: 'market-one', ruleUpdatedAt: time };
const history = { version: 1, wallets: [{ address: watch.address, lastCheckedAt: time, manualLiquidationPrices: [], alerts: [{ network: watch.network, protocol: watch.protocol, positionId: watch.positionId, updatedAt: time, rules: { ...defaultAlertRules(), newLiquidityAdded: true } }] }] };
const observation = (amount: string, block: string, checkedAt: string): LiquidityObservation => ({ watch, checkedAt, blockNumber: block, status: 'ok', readings: [{ market: '0x2222222222222222222222222222222222222222', marketAddress: '0x2222222222222222222222222222222222222222', token: '0x3333333333333333333333333333333333333333', symbol: 'USDC', decimals: 6, rawAmount: amount, label: 'Test market', note: 'Available cash' }] });
function github(conflict = false, disable = false, fail = false) {
  let head = '1'.repeat(40), attempts = 0;
  const initial = advanceLiquidityAlerts(history as any, emptyLiquidityState(), emptyLiquidityNotifications(), [observation('100000000', '100', time)], time);
  const files: Record<string, any> = { 'analysis/wallet-history.json': structuredClone(history), [LIQUIDITY_STATE_PATH]: initial.state, [LIQUIDITY_NOTIFICATIONS_PATH]: initial.notifications };
  const blobs = new Map<string, any>(), trees = new Map<string, any>(); let sequence = 0, pendingTree: any;
  const fetcher = vi.fn(async (url: any, init: any) => {
    const path = new URL(url).pathname.replace('/repos/test/repo', ''), method = init.method;
    if (method === 'GET' && path.startsWith('/git/ref/')) return Response.json({ object: { sha: head } });
    if (method === 'GET' && path.startsWith('/contents/')) { const value = files[path.slice('/contents/'.length)]; return Response.json({ encoding: 'base64', content: Buffer.from(JSON.stringify(value)).toString('base64') }); }
    if (method === 'GET' && path.startsWith('/git/commits/')) return Response.json({ tree: { sha: 'parent-tree' } });
    const body = JSON.parse(init.body);
    if (path === '/git/blobs') { if (fail) return Response.json({}, { status: 500 }); const sha = `blob-${++sequence}`; blobs.set(sha, JSON.parse(body.content)); return Response.json({ sha }); }
    if (path === '/git/trees') { const sha = `tree-${++sequence}`; trees.set(sha, body.tree); return Response.json({ sha }); }
    if (path === '/git/commits') { pendingTree = trees.get(body.tree); expect(body.message).toContain('[skip ci] [skip render]'); expect(body.parents).toEqual([head]); return Response.json({ sha: '3'.repeat(40) }); }
    if (method === 'PATCH') {
      expect(body.force).toBe(false); attempts++;
      if (conflict && attempts === 1) {
        head = '2'.repeat(40);
        if (disable) files['analysis/wallet-history.json'].wallets[0].alerts[0].rules.newLiquidityAdded = false;
        else files[LIQUIDITY_STATE_PATH] = advanceLiquidityAlerts(history as any, emptyLiquidityState(), emptyLiquidityNotifications(), [observation('200000000', '101', time)], time).state;
        return Response.json({}, { status: 422 });
      }
      for (const entry of pendingTree) files[entry.path] = blobs.get(entry.sha);
      head = body.sha; return Response.json({});
    }
    throw Error(`Unexpected request ${method} ${path}`);
  }) as any;
  return { files, fetcher, attempts: () => attempts };
}
it('commits notification and baseline together and recomputes changes against the latest head after a conflict', async () => {
  const g = github(true);
  const r = await publishLiquidityObservations([observation('250000000', '102', later)], later, { token: 'test-secret', repository: 'test/repo', fetcher: g.fetcher });
  expect(r).toMatchObject({ committed: true, added: 1 }); expect(g.attempts()).toBe(2);
  expect(g.files[LIQUIDITY_NOTIFICATIONS_PATH].notifications[0].liquidityChange).toBe('50');
  expect(g.files[LIQUIDITY_STATE_PATH].watches[0].baselines[0].rawAmount).toBe('250000000');
  expect(JSON.stringify(g.files)).not.toContain('test-secret');
  const again = await publishLiquidityObservations([observation('250000000', '102', later)], later, { token: 'test-secret', repository: 'test/repo', fetcher: g.fetcher });
  expect(again.committed).toBe(false); expect(g.files[LIQUIDITY_NOTIFICATIONS_PATH].notifications).toHaveLength(1);
});
it('rechecks enabled preferences before committing so a concurrent disable cannot produce a notification', async () => {
  const g = github(true, true);
  const r = await publishLiquidityObservations([observation('250000000', '102', later)], later, { token: 'test', repository: 'test/repo', fetcher: g.fetcher });
  expect(r.added).toBe(0); expect(g.files[LIQUIDITY_STATE_PATH].watches).toEqual([]); expect(g.files[LIQUIDITY_NOTIFICATIONS_PATH].notifications).toEqual([]);
});
it('leaves both JSON files untouched when publishing fails before the atomic branch update', async () => {
  const g = github(false, false, true), original = JSON.stringify(g.files);
  await expect(publishLiquidityObservations([observation('250000000', '102', later)], later, { token: 'test', repository: 'test/repo', fetcher: g.fetcher })).rejects.toThrow();
  expect(JSON.stringify(g.files)).toBe(original); expect(g.attempts()).toBe(0);
});
