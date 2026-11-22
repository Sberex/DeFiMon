import { parseWalletHistory, type WalletHistoryFile } from '../src/wallet-history.js';
import { advanceLiquidityAlerts, emptyLiquidityNotifications, emptyLiquidityState, parseLiquidityNotifications, parseLiquidityState } from './liquidity-alert-tracker.js';
import type { LiquidityObservation } from './liquidity-alert-reader.js';
export const LIQUIDITY_STATE_PATH = 'analysis/liquidity-alert-state.json';
export const LIQUIDITY_NOTIFICATIONS_PATH = 'analysis/liquidity-alert-notifications.json';
/** One Git commit atomically advances baselines and appends notifications. */
export async function publishLiquidityObservations(observations: LiquidityObservation[], runAt: string, options: { token: string; repository: string; branch?: string; fetcher?: typeof fetch }) {
  const { token, repository } = options, branch = options.branch ?? 'main', fetcher = options.fetcher ?? fetch;
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w./-]+$/.test(branch)) throw Error('Tracker publishing requires a repository and contents-write token.');
  const root = `https://api.github.com/repos/${repository}`;
  async function request(path: string, method = 'GET', body?: unknown) {
    const r = await fetcher(`${root}${path}`, { method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000), cache: 'no-store' });
    return r;
  }
  async function json(path: string, method = 'GET', body?: unknown) {
    const r = await request(path, method, body); if (!r.ok) throw Error(`GitHub tracker operation failed (${r.status}).`); return r.json();
  }
  async function read(path: string, head: string, fallback?: unknown) {
    const r = await request(`/contents/${path}?ref=${head}`);
    if (r.status === 404 && fallback !== undefined) return fallback;
    if (!r.ok) throw Error(`Tracker source could not be read (${r.status}).`);
    let data = await r.json();
    if (data.encoding === 'none' && /^[\da-f]{40}$/.test(data.sha)) data = await json(`/git/blobs/${data.sha}`);
    if (data.encoding !== 'base64' || typeof data.content !== 'string') throw Error('Tracker source content unavailable.');
    return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = await json(`/git/ref/heads/${encodeURIComponent(branch)}`), head = ref.object?.sha;
    if (typeof head !== 'string' || !/^[\da-f]{40}$/.test(head)) throw Error('Invalid branch head.');
    const history = parseWalletHistory(await read('analysis/wallet-history.json', head)) as WalletHistoryFile;
    const state = parseLiquidityState(await read(LIQUIDITY_STATE_PATH, head, emptyLiquidityState()));
    const notifications = parseLiquidityNotifications(await read(LIQUIDITY_NOTIFICATIONS_PATH, head, emptyLiquidityNotifications()));
    const next = advanceLiquidityAlerts(history, state, notifications, observations, runAt);
    if (JSON.stringify(next.state) === JSON.stringify(state) && JSON.stringify(next.notifications) === JSON.stringify(notifications)) return { committed: false, added: 0, watches: next.state.watches.length };
    const parent = await json(`/git/commits/${head}`), tree: { path: string; mode: string; type: string; sha: string }[] = [];
    for (const [path, value] of [[LIQUIDITY_STATE_PATH, next.state], [LIQUIDITY_NOTIFICATIONS_PATH, next.notifications]] as const) {
      const blob = await json('/git/blobs', 'POST', { content: `${JSON.stringify(value, null, 2)}\n`, encoding: 'utf-8' });
      tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const mergedTree = await json('/git/trees', 'POST', { base_tree: parent.tree.sha, tree });
    const commit = await json('/git/commits', 'POST', { message: `Track market liquidity: ${next.added} increase notifications [skip ci] [skip render]`, tree: mergedTree.sha, parents: [head] });
    const update = await request(`/git/refs/heads/${encodeURIComponent(branch)}`, 'PATCH', { sha: commit.sha, force: false });
    if (update.ok) return { committed: true, added: next.added, watches: next.state.watches.length };
    if (![409, 422].includes(update.status)) throw Error(`Tracker commit could not be published (${update.status}).`);
    // A dashboard save or another commit moved main: reload all three JSON files
    // and recompute against the fresh baseline without repeating on-chain reads.
  }
  throw Error('Tracker branch changed repeatedly; retry this workflow run. No commit was overwritten.');
}
