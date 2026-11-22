import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePositionAlertInput, type PositionAlertInput } from '../src/alert-rules.js';
import { mergeWalletHistory, parseManualPriceInput, parseWalletHistory, walletKey, type ManualPriceInput, type SavedWallet, type WalletHistoryFile, type WalletHistoryResponse } from '../src/wallet-history.js';
export interface WalletHistoryStore {
  readWallet(address: string): Promise<WalletHistoryResponse>;
  recordCheck(address: string): Promise<WalletHistoryResponse>;
  savePrices(address: string, input: ManualPriceInput): Promise<WalletHistoryResponse>;
  saveAlerts(address: string, input: PositionAlertInput): Promise<WalletHistoryResponse>;
}
export function createWalletHistoryStore(options: { path?: string; token?: () => string | undefined; repository?: string; branch?: string; fetcher?: typeof fetch; now?: () => number } = {}): WalletHistoryStore {
  const path = options.path ?? fileURLToPath(new URL('../analysis/wallet-history.json', import.meta.url));
  const token = options.token ?? (() => process.env.COOKBOOK_GITHUB_TOKEN), fetcher = options.fetcher ?? fetch, now = options.now ?? Date.now;
  const repository = options.repository ?? 'Sberex/DeFiMon', branch = options.branch ?? 'main';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid wallet history repository.');
  const endpoint = `https://api.github.com/repos/${repository}/contents/analysis/wallet-history.json`;
  const headers = () => ({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) });
  let current: WalletHistoryFile | undefined, queue = Promise.resolve(), pending = false, warning: string | undefined, clock = 0;
  const empty = (): WalletHistoryFile => ({ version: 1, wallets: [] });
  async function load() {
    if (current) return;
    try { current = parseWalletHistory(JSON.parse(await readFile(path, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') current = empty(); else throw new Error('Wallet history could not be read. Existing records were not replaced.'); }
  }
  async function save(data: WalletHistoryFile) {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`); await rename(temp, path); current = data;
  }
  async function remote() {
    const response = await fetcher(`${endpoint}?ref=${encodeURIComponent(branch)}`, { headers: headers(), signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (response.status === 404) return { data: empty(), sha: undefined };
    if (!response.ok) throw new Error('Wallet history read unavailable.');
    const body = await response.json();
    if (typeof body.sha !== 'string') throw new Error('Wallet history version unavailable.');
    let content = body;
    if (body.encoding === 'none') {
      const blob = await fetcher(`https://api.github.com/repos/${repository}/git/blobs/${encodeURIComponent(body.sha)}`, { headers: headers(), signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (!blob.ok) throw new Error('Wallet history blob unavailable.'); content = await blob.json();
    }
    if (content.encoding !== 'base64' || typeof content.content !== 'string') throw new Error('Wallet history content unavailable.');
    return { data: parseWalletHistory(JSON.parse(Buffer.from(content.content, 'base64').toString('utf8'))), sha: body.sha };
  }
  function serial<T>(run: () => Promise<T>): Promise<T> { const result = queue.then(run); queue = result.then(() => {}, () => {}); return result; }
  function result(address: string): WalletHistoryResponse {
    return { wallet: structuredClone(current!.wallets.find(w => w.address === address) ?? null), persistence: { mode: token() ? 'github' : 'local', synced: !!token() && !pending && !warning, message: !token() ? 'Wallet history is saved on this server; GitHub sync is not configured.' : warning ?? (pending ? 'Wallet history is saved locally; GitHub sync will retry on the next check or calculation.' : undefined) } };
  }
  async function update(address: string, change?: (wallet: SavedWallet | undefined) => SavedWallet) {
    const key = walletKey(address); await load();
    let base: Awaited<ReturnType<typeof remote>> | undefined;
    try { base = await remote(); const merged = mergeWalletHistory(base.data, current!); if (JSON.stringify(merged) !== JSON.stringify(base.data)) pending = true; await save(merged); warning = undefined; }
    catch { warning = 'Saved wallet history could not be downloaded from GitHub. Using the server copy.'; }
    if (change) {
      const wallet = change(current!.wallets.find(w => w.address === key));
      await save(mergeWalletHistory(current!, { version: 1, wallets: [wallet] })); pending = true;
    }
    if (!token() || !pending) return result(key);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const latest = attempt === 0 && base ? base : await remote();
        const merged = mergeWalletHistory(latest.data, current!);
        if (JSON.stringify(merged) === JSON.stringify(latest.data)) { await save(merged); pending = false; warning = undefined; return result(key); }
        const response = await fetcher(endpoint, { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000), body: JSON.stringify({ branch, message: 'Update wallet history, collateral prices and alert preferences [skip ci] [skip render]', sha: latest.sha, content: Buffer.from(`${JSON.stringify(merged, null, 2)}\n`).toString('base64') }) });
        if ([409, 422].includes(response.status)) continue;
        if (!response.ok) throw new Error('Wallet history write unavailable.');
        await save(merged); pending = false; warning = undefined; return result(key);
      } catch { break; }
    }
    warning = 'Wallet history is saved locally; GitHub sync failed and will retry on the next check or calculation.';
    return result(key);
  }
  const timestamp = () => { clock = Math.max(now(), clock + 1); return new Date(clock).toISOString(); };
  return {
    readWallet: address => serial(() => update(address)),
    recordCheck: address => serial(() => update(address, old => ({ ...old, address: walletKey(address), lastCheckedAt: timestamp(), manualLiquidationPrices: old?.manualLiquidationPrices ?? [] }))),
    saveAlerts: (address, input) => serial(() => {
      const parsed = parsePositionAlertInput(input);
      return update(address, old => {
        const at = timestamp();
        const next: SavedWallet = { address: walletKey(address), lastCheckedAt: old?.lastCheckedAt ?? at, manualLiquidationPrices: [], alerts: [{ ...parsed, updatedAt: at }] };
        return old ? mergeWalletHistory({ version: 1, wallets: [old] }, { version: 1, wallets: [next] }).wallets[0] : next;
      });
    }),
    savePrices: (address, input) => serial(() => {
      const parsed = parseManualPriceInput(input);
      return update(address, old => {
        const at = timestamp();
        const next: SavedWallet = { address: walletKey(address), lastCheckedAt: old?.lastCheckedAt ?? at, manualLiquidationPrices: [{ ...parsed, updatedAt: at }] };
        return old ? mergeWalletHistory({ version: 1, wallets: [old] }, { version: 1, wallets: [next] }).wallets[0] : next;
      });
    }),
  };
}
