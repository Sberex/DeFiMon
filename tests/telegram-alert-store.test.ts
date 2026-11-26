import { expect, it, vi } from 'vitest';
import { createTelegramStore, TELEGRAM_DELIVERIES_PATH } from '../server/telegram-alert-store';
import { deliverTelegramAlerts } from '../server/telegram-alerts';
import { snapshot, at, liquidity, utilization } from './fixtures/telegram';
function github(conflict = false, fail = false) {
  const s = snapshot();
  const files: Record<string, any> = { [TELEGRAM_DELIVERIES_PATH]: s.state, 'analysis/wallet-history.json': s.history, 'analysis/liquidity-alert-notifications.json': { version: 1, notifications: [liquidity] }, 'analysis/utilization-alert-notifications.json': { version: 1, notifications: [utilization] }, 'analysis/unrelated.json': { retained: true } };
  let head = '1'.repeat(40), sequence = 0, tree: any[] = [], patches = 0;
  const blobs = new Map<string, any>();
  const fetcher = vi.fn(async (url: any, init: any) => {
    const path = new URL(url).pathname.replace('/repos/test/repo',''), method = init.method;
    if (path.startsWith('/git/ref/')) return Response.json({ object: { sha: head } });
    if (path.startsWith('/contents/')) return Response.json({ encoding: 'base64', content: Buffer.from(JSON.stringify(files[path.slice('/contents/'.length)])).toString('base64') });
    if (method === 'GET' && path.startsWith('/git/commits/')) return Response.json({ tree: { sha: 'base-tree' } });
    const body = JSON.parse(init.body);
    if (path === '/git/blobs') { if (fail) return Response.json({}, { status: 500 }); const sha = `blob-${++sequence}`; blobs.set(sha, JSON.parse(body.content)); expect(body.content).not.toContain('github-secret'); return Response.json({ sha }); }
    if (path === '/git/trees') { expect(body.base_tree).toBe('base-tree'); tree = body.tree; expect(tree.map(t => t.path)).toEqual([TELEGRAM_DELIVERIES_PATH]); return Response.json({ sha: 'new-tree' }); }
    if (path === '/git/commits') { expect(body.parents).toEqual([head]); expect(body.message).toContain('[skip ci] [skip render]'); return Response.json({ sha: '3'.repeat(40) }); }
    if (method === 'PATCH') {
      expect(body.force).toBe(false); patches++;
      if (conflict && patches === 1) { head = '2'.repeat(40); files['analysis/wallet-history.json'].wallets[0].alerts[0].rules.newLiquidityAdded = false; return Response.json({}, { status: 422 }); }
      for (const item of tree) files[item.path] = blobs.get(item.sha); head = body.sha; return Response.json({});
    }
    throw Error(`Unexpected ${method} ${path}`);
  }) as any;
  return { files, fetcher, patches: () => patches };
}
it('records receipt transitions without overwriting preferences, notifications, or unrelated files', async () => {
  const g = github(), store = createTelegramStore({ token: 'github-secret', repository: 'test/repo', fetcher: g.fetcher });
  const initialSources = JSON.stringify([g.files['analysis/wallet-history.json'], g.files['analysis/liquidity-alert-notifications.json'], g.files['analysis/utilization-alert-notifications.json']]);
  const send = vi.fn(async (_text: string) => ({ ok: true as const, messageId: 4 }));
  const result = await deliverTelegramAlerts({ store, send, owner: 'worker', now: () => Date.parse(at(2)), sleep: async () => {} });
  expect(result.sent).toBe(2); expect(g.patches()).toBe(4); expect(g.files[TELEGRAM_DELIVERIES_PATH].deliveries.every((r:any) => r.status === 'sent')).toBe(true);
  expect(JSON.stringify([g.files['analysis/wallet-history.json'], g.files['analysis/liquidity-alert-notifications.json'], g.files['analysis/utilization-alert-notifications.json']])).toBe(initialSources);
  expect(g.files['analysis/unrelated.json']).toEqual({ retained: true });
  await deliverTelegramAlerts({ store, send, owner: 'next-worker', now: () => Date.parse(at(3)) }); expect(send).toHaveBeenCalledTimes(2); expect(g.patches()).toBe(4);
});
it('re-evaluates current preferences after a branch conflict before acquiring a send lease', async () => {
  const g = github(true), store = createTelegramStore({ token: 'github-secret', repository: 'test/repo', fetcher: g.fetcher });
  const send = vi.fn(async (_text: string) => ({ ok: true as const, messageId: 4 }));
  expect(await deliverTelegramAlerts({ store, send, owner: 'worker', now: () => Date.parse(at(2)), sleep: async () => {} })).toMatchObject({ skipped: 1, sent: 1 });
  expect(send).toHaveBeenCalledTimes(1); expect(g.files[TELEGRAM_DELIVERIES_PATH].deliveries[0]).toMatchObject({ status: 'skipped', error: 'preference_changed' });
});
it('does not call Telegram when the claim cannot be saved to GitHub', async () => {
  const g = github(false, true), store = createTelegramStore({ token: 'github-secret', repository: 'test/repo', fetcher: g.fetcher }), send = vi.fn();
  await expect(deliverTelegramAlerts({ store, send, owner: 'worker', now: () => Date.parse(at(2)) })).rejects.toThrow(); expect(send).not.toHaveBeenCalled(); expect(g.patches()).toBe(0);
});
