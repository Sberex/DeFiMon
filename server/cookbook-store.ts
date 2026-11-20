import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Portfolio } from '../src/types.js';
import { emptyCookbook, mergeCookbooks, parseCookbook, updateCookbook, type CookbookFile, type CookbookResponse } from '../src/cookbook.js';
export interface CookbookStore { read(): Promise<CookbookResponse>; record(portfolio: Portfolio): Promise<void> }
export const defaultCookbookPath = fileURLToPath(new URL('../analysis/cookbook.json', import.meta.url));
export function createCookbookStore(options: { path?: string; token?: () => string | undefined; repository?: string; branch?: string; fetcher?: typeof fetch; now?: () => number } = {}): CookbookStore {
  const path = options.path ?? defaultCookbookPath, token = options.token ?? (() => process.env.COOKBOOK_GITHUB_TOKEN);
  const repository = options.repository ?? 'Sberex/DeFiMon', branch = options.branch ?? 'main', fetcher = options.fetcher ?? fetch, now = options.now ?? Date.now;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid Cookbook repository');
  const endpoint = `https://api.github.com/repos/${repository}/contents/analysis/cookbook.json`;
  let current: CookbookFile | undefined, loaded: Promise<void> | undefined, queue = Promise.resolve();
  let pending = false, lastRemoteRead = -Infinity, warning: string | undefined;
  const headers = () => ({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) });
  async function load() {
    loaded ??= (async () => {
      try { current = parseCookbook(JSON.parse(await readFile(path, 'utf8'))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') current = emptyCookbook(); else throw new Error('Cookbook JSON could not be read. Existing data was not replaced.'); }
    })();
    await loaded;
  }
  async function save(file: CookbookFile) {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`);
    await rename(temp, path); current = file;
  }
  async function remote() {
    const response = await fetcher(`${endpoint}?ref=${encodeURIComponent(branch)}`, { headers: headers(), signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (response.status === 404) return { data: emptyCookbook(), sha: undefined };
    if (!response.ok) throw new Error('GitHub Cookbook read unavailable');
    const body = await response.json();
    if (typeof body.sha !== 'string') throw new Error('Invalid GitHub Cookbook version');
    let content = body;
    // Contents omits base64 data above 1 MiB; read the immutable blob by SHA.
    if (body.encoding === 'none') {
      const blob = await fetcher(`https://api.github.com/repos/${repository}/git/blobs/${encodeURIComponent(body.sha)}`, { headers: headers(), signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (!blob.ok) throw new Error('GitHub Cookbook blob unavailable');
      content = await blob.json();
    }
    if (content.encoding !== 'base64' || typeof content.content !== 'string') throw new Error('Invalid GitHub Cookbook response');
    return { data: parseCookbook(JSON.parse(Buffer.from(content.content, 'base64').toString('utf8'))), sha: body.sha };
  }
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const result = queue.then(run); queue = result.then(() => {}, () => {}); return result;
  }
  return {
    read: () => serial(async () => {
      await load();
      if (now() - lastRemoteRead > 300000) {
        lastRemoteRead = now();
        try { const base = await remote(); await save(mergeCookbooks(base.data, current!)); }
        catch { warning = 'The latest GitHub Cookbook could not be fetched. Showing the saved JSON snapshot.'; }
      }
      return { data: structuredClone(current!), persistence: { mode: token() ? 'github' : 'local', synced: !pending,
        message: !token() ? 'Automatic saving to GitHub is not configured. New snapshots are saved locally and can be lost when the server restarts.' : pending ? 'New snapshots are saved locally, but GitHub sync failed. The next wallet check will retry.' : warning } };
    }),
    record: portfolio => serial(async () => {
      await load();
      let initialRemote: Awaited<ReturnType<typeof remote>> | undefined;
      try {
        if (token() || now() - lastRemoteRead > 300000) {
          initialRemote = await remote(); lastRemoteRead = now();
          current = mergeCookbooks(initialRemote.data, current!);
        }
      } catch { warning = 'GitHub Cookbook could not be fetched. Updates are saved locally.'; }
      const next = updateCookbook(current!, portfolio);
      if (JSON.stringify(next) === JSON.stringify(current!) && !pending) return;
      await save(next); pending = true;
      if (!token()) return;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const base = attempt === 0 && initialRemote ? initialRemote : await remote();
          const merged = mergeCookbooks(base.data, current!);
          if (JSON.stringify(merged) === JSON.stringify(base.data)) { await save(merged); pending = false; warning = undefined; return; }
          const response = await fetcher(endpoint, { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000), body: JSON.stringify({ branch, message: 'Update Cookbook snapshots [skip ci] [skip render]', sha: base.sha, content: Buffer.from(`${JSON.stringify(merged, null, 2)}\n`).toString('base64') }) });
          if ([409, 422].includes(response.status)) continue;
          if (!response.ok) throw new Error('GitHub Cookbook write unavailable');
          await save(merged); pending = false; lastRemoteRead = now(); warning = undefined; return;
        } catch { break; }
      }
      // A persistence failure must never discard a successful wallet analysis.
      warning = 'Cookbook GitHub sync is unavailable. The local JSON still contains the new snapshots.';
    }),
  };
}
