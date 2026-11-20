import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCookbookStore } from '../server/cookbook-store';
import { cookbookPositions, emptyCookbook, parseCookbook, updateCookbook } from '../src/cookbook';
import { snapshot } from './fixtures/cookbook';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function path() { const dir = await mkdtemp(join(tmpdir(), 'defimon-cookbook-')); dirs.push(dir); return join(dir, 'cookbook.json'); }
function github(start = emptyCookbook()) {
  let file = start, sha = 'version-1', calls = 0;
  const fetcher = vi.fn(async (_url: any, init: any) => {
    if (init.method !== 'PUT') return new Response(JSON.stringify({ encoding: 'base64', content: Buffer.from(JSON.stringify(file)).toString('base64'), sha }));
    calls++; const body = JSON.parse(init.body); expect(body.sha).toBe(sha);
    expect(body.message).toContain('[skip ci]'); expect(body.message).toContain('[skip render]');
    file = parseCookbook(JSON.parse(Buffer.from(body.content, 'base64').toString())); sha = `version-${calls + 1}`;
    return new Response('{}');
  }) as unknown as typeof fetch;
  return { fetcher, read: () => file };
}
it('writes the JSON atomically in local mode and makes missing GitHub persistence explicit', async () => {
  const filePath = await path(), g = github();
  const store = createCookbookStore({ path: filePath, token: () => undefined, fetcher: g.fetcher });
  await store.record(snapshot());
  const file = parseCookbook(JSON.parse(await readFile(filePath, 'utf8')));
  expect(cookbookPositions(file)).toHaveLength(1);
  const result = await store.read();
  expect(result.persistence).toMatchObject({ mode: 'local', synced: false });
  expect(result.persistence.message).toContain('server restarts');
});
it('loads remote state before refreshing a wallet, removing old positions even after an empty local startup', async () => {
  const g = github(updateCookbook(emptyCookbook(), snapshot()));
  const store = createCookbookStore({ path: await path(), token: () => 'test-cookbook-token', fetcher: g.fetcher });
  await store.record(snapshot(.1, '2026-11-20T12:00:00.000Z'));
  expect(cookbookPositions(g.read())).toEqual([]);
  expect((await store.read()).persistence).toMatchObject({ mode: 'github', synced: true });
});
it('serializes concurrent wallet refreshes without losing either address', async () => {
  const g = github(), store = createCookbookStore({ path: await path(), token: () => 'test-cookbook-token', fetcher: g.fetcher });
  await Promise.all([store.record(snapshot()), store.record(snapshot(.3, '2026-11-20T11:00:00.000Z', '0x4444444444444444444444444444444444444444'))]);
  expect(cookbookPositions(g.read())).toHaveLength(2);
});
it('retries a GitHub version conflict and merges the other writer’s snapshots', async () => {
  const g = github(updateCookbook(emptyCookbook(), snapshot(.3, '2026-11-20T11:00:00.000Z', '0x4444444444444444444444444444444444444444')));
  let conflict = true;
  const fetcher = vi.fn(async (...args: Parameters<typeof fetch>) => {
    if (args[1]?.method === 'PUT' && conflict) { conflict = false; return new Response('{}', { status: 409 }); }
    return g.fetcher(...args);
  });
  const store = createCookbookStore({ path: await path(), token: () => 'test-cookbook-token', fetcher });
  await store.record(snapshot());
  expect(cookbookPositions(g.read())).toHaveLength(2);
  expect(fetcher.mock.calls.filter(c => c[1]?.method === 'PUT')).toHaveLength(2);
});
it('retains local snapshots after a GitHub failure, retries later, and never exposes credentials', async () => {
  const g = github(); let fail = true;
  const fetcher = (async (...args: Parameters<typeof fetch>) => args[1]?.method === 'PUT' && fail ? new Response('test-cookbook-token', { status: 403 }) : g.fetcher(...args)) as typeof fetch;
  const store = createCookbookStore({ path: await path(), token: () => 'test-cookbook-token', fetcher });
  await store.record(snapshot());
  const pending = await store.read();
  expect(pending.persistence.synced).toBe(false); expect(cookbookPositions(pending.data)).toHaveLength(1);
  expect(JSON.stringify(pending)).not.toContain('test-cookbook-token');
  fail = false; await store.record(snapshot());
  expect((await store.read()).persistence.synced).toBe(true); expect(cookbookPositions(g.read())).toHaveLength(1);
});
it('does not overwrite corrupt local JSON with an empty catalog', async () => {
  const filePath = await path(); await writeFile(filePath, '{not-json');
  const store = createCookbookStore({ path: filePath, token: () => undefined, fetcher: github().fetcher });
  await expect(store.record(snapshot())).rejects.toThrow('not replaced');
  expect(await readFile(filePath, 'utf8')).toBe('{not-json');
});

it('reads an immutable Git blob when Contents omits data for a JSON file above 1 MiB', async () => {
  const data = updateCookbook(emptyCookbook(), snapshot());
  const fetcher = vi.fn(async (url: any) => new Response(JSON.stringify(String(url).includes('/git/blobs/')
    ? { encoding: 'base64', content: Buffer.from(JSON.stringify(data)).toString('base64') }
    : { encoding: 'none', content: '', sha: 'fixed-blob-version', size: 1048577 }))) as unknown as typeof fetch;
  const store = createCookbookStore({ path: await path(), token: () => undefined, fetcher });
  expect(cookbookPositions((await store.read()).data)).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/git/blobs/fixed-blob-version'), expect.anything());
});
