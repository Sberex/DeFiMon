import { expect, it, vi } from 'vitest';
import { publishUtilizationObservations, UTILIZATION_STATE_PATH, UTILIZATION_NOTIFICATIONS_PATH } from '../server/utilization-alert-store';
import { defaultAlertRules } from '../src/alert-rules';
import type { UtilizationObservation } from '../server/utilization-alert-reader';
const time = '2026-11-23T06:00:00.000Z';
const watch = { address: '0x1111111111111111111111111111111111111111', network: 'ethereum' as const, protocol: 'morpho', positionId: 'one', ruleUpdatedAt: time, thresholdPercent: 90 };
const observation: UtilizationObservation = { watch, checkedAt: time, blockNumber: '100', status: 'ok', readings: [{ market: 'market', marketAddress: '0x2222222222222222222222222222222222222222', token: '0x3333333333333333333333333333333333333333', symbol: 'USDC', label: 'Market', utilizationPercent: 95, note: 'Borrowed / supplied.' }] };
function github(disableOnConflict = false) {
  let head = '1'.repeat(40), sequence = 0, tree: any[] = [], attempts = 0;
  const files: Record<string, any> = { 'analysis/wallet-history.json': { version: 1, wallets: [{ address: watch.address, lastCheckedAt: time, manualLiquidationPrices: [], alerts: [{ network: 'ethereum', protocol: 'morpho', positionId: watch.positionId, updatedAt: time, rules: { ...defaultAlertRules(), utilizationAbove: { enabled: true, thresholdPercent: 90 } } }] }] }, 'analysis/liquidity-alert-notifications.json': { untouched: true } };
  const blobs = new Map();
  const fetcher = vi.fn(async (url: any, init: any) => {
    const path = new URL(url).pathname.replace('/repos/test/repo',''), method = init.method;
    if (path.startsWith('/git/ref/')) return Response.json({ object: { sha: head } });
    if (path.startsWith('/contents/')) { const v = files[path.slice('/contents/'.length)]; return v ? Response.json({ encoding: 'base64', content: Buffer.from(JSON.stringify(v)).toString('base64') }) : Response.json({}, { status: 404 }); }
    if (method === 'GET' && path.startsWith('/git/commits/')) return Response.json({ tree: { sha: 'tree' } });
    const body = JSON.parse(init.body);
    if (path === '/git/blobs') { const sha = `blob-${++sequence}`; blobs.set(sha, JSON.parse(body.content)); return Response.json({ sha }); }
    if (path === '/git/trees') { tree = body.tree; expect(tree.map(t=>t.path)).toEqual([UTILIZATION_STATE_PATH, UTILIZATION_NOTIFICATIONS_PATH]); return Response.json({ sha: 'tree-new' }); }
    if (path === '/git/commits') return Response.json({ sha: '3'.repeat(40) });
    if (method === 'PATCH') {
      expect(body.force).toBe(false); attempts++;
      if (disableOnConflict && attempts === 1) { files['analysis/wallet-history.json'].wallets[0].alerts[0].rules.utilizationAbove.enabled = false; head = '2'.repeat(40); return Response.json({}, { status: 422 }); }
      for (const entry of tree) files[entry.path] = blobs.get(entry.sha); head = body.sha; return Response.json({});
    }
    throw Error(`Unexpected request: ${path}`);
  }) as any;
  return { files, fetcher };
}
it('atomically saves utilization state and notifications independently of liquidity data and does not duplicate retries', async () => {
  const g = github(), options = { token: 'secret', repository: 'test/repo', fetcher: g.fetcher, eventName: 'schedule' as const };
  expect(await publishUtilizationObservations([observation], time, options)).toMatchObject({ committed: true, added: 1 });
  expect(g.files[UTILIZATION_STATE_PATH].lastScheduledRunAt).toBe(time); expect(g.files[UTILIZATION_NOTIFICATIONS_PATH].notifications).toHaveLength(1);
  expect(g.files['analysis/liquidity-alert-notifications.json']).toEqual({ untouched: true });
  expect(await publishUtilizationObservations([observation], time, options)).toMatchObject({ committed: false, added: 0 });
});
it('re-reads saved thresholds after a branch conflict, so concurrently disabled alerts produce no notifications', async () => {
  const g = github(true);
  const result = await publishUtilizationObservations([observation], time, { token: 'secret', repository: 'test/repo', fetcher: g.fetcher });
  expect(result.added).toBe(0); expect(g.files[UTILIZATION_NOTIFICATIONS_PATH]).toBeUndefined();
});
