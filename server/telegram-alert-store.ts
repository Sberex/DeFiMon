import { parseWalletHistory } from '../src/wallet-history.js';
import { parseLiquidityNotifications } from './liquidity-alert-tracker.js';
import { parseUtilizationNotifications } from './utilization-alert-tracker.js';
import { parseTelegramState, type TelegramStore, type TelegramState, type TelegramSnapshot } from './telegram-alerts.js';
export const TELEGRAM_DELIVERIES_PATH = 'analysis/telegram-deliveries.json';
export function createTelegramStore(options: { token: string; repository: string; branch?: string; fetcher?: typeof fetch }): TelegramStore {
  const { token, repository } = options, branch = options.branch ?? 'main', fetcher = options.fetcher ?? fetch;
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w./-]+$/.test(branch)) throw Error('Telegram delivery needs a repository and contents-write credential.');
  const root = `https://api.github.com/repos/${repository}`;
  async function request(path: string, method = 'GET', body?: unknown) {
    return fetcher(root + path, { method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000), cache: 'no-store' });
  }
  async function json(path: string, method = 'GET', body?: unknown): Promise<any> { const r = await request(path, method, body); if (!r.ok) throw Error('Telegram GitHub storage operation failed.'); return r.json(); }
  async function file(path: string, head: string) {
    let data = await json(`/contents/${path}?ref=${head}`);
    if (data.encoding === 'none' && /^[\da-f]{40}$/.test(data.sha)) data = await json(`/git/blobs/${data.sha}`);
    if (data.encoding !== 'base64' || typeof data.content !== 'string') throw Error('Telegram source file unavailable.');
    return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  }
  async function snapshot(): Promise<{ head: string; snapshot: TelegramSnapshot }> {
    const ref = await json(`/git/ref/heads/${encodeURIComponent(branch)}`), head = ref.object?.sha;
    if (typeof head !== 'string' || !/^[\da-f]{40}$/.test(head)) throw Error('Telegram source branch unavailable.');
    const [state, history, liquidity, utilization] = await Promise.all([file(TELEGRAM_DELIVERIES_PATH, head), file('analysis/wallet-history.json', head), file('analysis/liquidity-alert-notifications.json', head), file('analysis/utilization-alert-notifications.json', head)]);
    const notifications = [...parseLiquidityNotifications(liquidity).notifications, ...parseUtilizationNotifications(utilization).notifications];
    if (new Set(notifications.map(n => n.id)).size !== notifications.length) throw Error('Duplicate alert identifiers.');
    return { head, snapshot: { state: parseTelegramState(state), history: parseWalletHistory(history), notifications } };
  }
  return {
    read: async () => (await snapshot()).snapshot,
    update: async change => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { head, snapshot: current } = await snapshot(), next: TelegramState = parseTelegramState(change(structuredClone(current.state), current));
        if (JSON.stringify(next) === JSON.stringify(current.state)) return next;
        const parent = await json(`/git/commits/${head}`), blob = await json('/git/blobs', 'POST', { content: JSON.stringify(next, null, 2) + '\n', encoding: 'utf-8' });
        const tree = await json('/git/trees', 'POST', { base_tree: parent.tree.sha, tree: [{ path: TELEGRAM_DELIVERIES_PATH, mode: '100644', type: 'blob', sha: blob.sha }] });
        const commit = await json('/git/commits', 'POST', { message: 'Update Telegram alert delivery receipts [skip ci] [skip render]', tree: tree.sha, parents: [head] });
        const update = await request(`/git/refs/heads/${encodeURIComponent(branch)}`, 'PATCH', { sha: commit.sha, force: false });
        if (update.ok) return next;
        if (![409,422].includes(update.status)) throw Error('Telegram delivery checkpoint could not be published; a message may already have been sent.');
      }
      throw Error('Telegram delivery branch changed repeatedly; a message may already have been sent.');
    },
  };
}
