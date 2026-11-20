import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeLendingPositionCount, createTestCasesStore, parseTestCases } from '../server/test-cases';
import { snapshot } from './fixtures/cookbook';
const first = '0x1111111111111111111111111111111111111111', second = '0x2222222222222222222222222222222222222222';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function path() { const dir = await mkdtemp(join(tmpdir(), 'defimon-test-cases-')); dirs.push(dir); return join(dir, 'test-cases.json'); }
function portfolio(count: number, address = first) {
  const data = snapshot(.2, '2026-11-20T10:00:00.000Z', address), original = data.protocols[0].positions[0];
  data.protocols[0].positions = Array.from({ length: count }, (_, i) => ({ ...structuredClone(original), id: `loan-${i}` }));
  return data;
}
function github(initial: string[] = []) {
  let values = initial, sha = 'one';
  const fetcher = vi.fn(async (_url: any, init: any) => {
    if (init.method !== 'PUT') return new Response(JSON.stringify({ sha, encoding: 'base64', content: Buffer.from(JSON.stringify(values)).toString('base64') }));
    const body = JSON.parse(init.body); expect(body.sha).toBe(sha);
    expect(body.message).toContain('[skip ci]'); expect(body.message).toContain('[skip render]');
    values = JSON.parse(Buffer.from(body.content, 'base64').toString()); sha += 'next'; return new Response('{}');
  });
  return { fetcher, get: () => values };
}
it('requires three positions, counts multiple rows once, and ignores zero or unreadable holdings', () => {
  expect(activeLendingPositionCount(portfolio(2))).toBe(2);
  const data = portfolio(3);
  expect(activeLendingPositionCount(data)).toBe(3);
  data.protocols[0].positions[0].assets.forEach(a => { a.supplied = 0; a.borrowed = 0; });
  expect(activeLendingPositionCount(data)).toBe(2);
  data.protocols[0].positions[1].assets = [];
  expect(activeLendingPositionCount(data)).toBe(1);
  data.protocols[0].status = 'error'; expect(activeLendingPositionCount(data)).toBe(0);
});
it('counts distinct networks but not duplicate responses or shared Spark/Morpho holdings', () => {
  const data = portfolio(1); data.protocols[0].positions[0].id = 'morpho-market-same';
  data.protocols = [data.protocols[0], { ...structuredClone(data.protocols[0]), id: 'spark' }, { ...structuredClone(data.protocols[0]), chain: 'Arbitrum' }];
  expect(activeLendingPositionCount(data)).toBe(2);
  data.protocols.push(structuredClone(data.protocols[0])); expect(activeLendingPositionCount(data)).toBe(2);
});
it('does not load or write storage for fewer than three positions', async () => {
  const g = github(), file = await path(), store = createTestCasesStore({ path: file, token: () => 'test-token', fetcher: g.fetcher });
  await store.record(portfolio(2)); expect(g.fetcher).not.toHaveBeenCalled();
  await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('appends qualifying addresses once, preserves existing entries and never removes them on a later smaller scan', async () => {
  const g = github([second]), file = await path(), store = createTestCasesStore({ path: file, token: () => 'test-token', fetcher: g.fetcher });
  await store.record(portfolio(3)); await store.record(portfolio(4)); await store.record(portfolio(1));
  expect(g.get()).toEqual([second, first]);
  expect(g.fetcher.mock.calls.filter(c => c[1].method === 'PUT')).toHaveLength(1);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([second, first]);
});
it('deduplicates addresses without changing the original address spelling', () => {
  const mixed = '0xDC3AbF85E090528669cf1b44eF4082B269C21A95';
  expect(parseTestCases([mixed, mixed.toLowerCase()])).toEqual([mixed]);
  expect(() => parseTestCases(['invalid'])).toThrow();
});
it('serializes simultaneous qualifying analyses without losing addresses', async () => {
  const g = github(), store = createTestCasesStore({ path: await path(), token: () => 'test-token', fetcher: g.fetcher });
  await Promise.all([store.record(portfolio(3)), store.record(portfolio(3, second)), store.record(portfolio(3))]);
  expect(g.get()).toEqual([first, second]);
});
it('merges concurrent GitHub changes after a version conflict', async () => {
  const g = github([second]); let conflict = true;
  const fetcher = vi.fn(async (...args: Parameters<typeof fetch>) => {
    if (args[1]?.method === 'PUT' && conflict) { conflict = false; return new Response('{}', { status: 409 }); }
    return g.fetcher(...args);
  });
  const store = createTestCasesStore({ path: await path(), token: () => 'test-token', fetcher });
  await store.record(portfolio(3)); expect(g.get()).toEqual([second, first]);
  expect(fetcher.mock.calls.filter(c => c[1]?.method === 'PUT')).toHaveLength(2);
});
it('retains failed appends locally for retry without exposing credentials or overwriting corrupt JSON', async () => {
  const g = github(); let fail = true;
  const fetcher = (async (...args: Parameters<typeof fetch>) => args[1]?.method === 'PUT' && fail ? new Response('private-test-token', { status: 403 }) : g.fetcher(...args)) as typeof fetch;
  const file = await path(), store = createTestCasesStore({ path: file, token: () => 'private-test-token', fetcher });
  await expect(store.record(portfolio(3))).rejects.toThrow('retained locally');
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([first]);
  fail = false; await store.record(portfolio(3)); expect(g.get()).toEqual([first]);
  const broken = await path(); await writeFile(broken, 'not-json');
  const corrupt = createTestCasesStore({ path: broken, token: () => undefined });
  await expect(corrupt.record(portfolio(3))).rejects.toThrow('not replaced');
  expect(await readFile(broken, 'utf8')).toBe('not-json');
});
