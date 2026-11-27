import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import type { DiscoveryQuery, DiscoveryResult } from '../src/market-discovery';
let server: Server, base: string;
const load = vi.fn(async (query: DiscoveryQuery): Promise<DiscoveryResult> => ({
  query,
  checkedAt: '2026-11-26T17:00:00Z',
  markets: [],
  coverage: [],
  messages: [],
}));
beforeAll(async () => {
  server = createApp(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    load,
  ).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const a = server.address();
  if (!a || typeof a === 'string') throw Error();
  base = `http://127.0.0.1:${a.port}`;
});
afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    ),
);
const post = (body: unknown) =>
  fetch(`${base}/api/market-discovery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
it('rejects unconfigured tokens and arbitrary parameters before discovery', async () => {
  const before = load.mock.calls.length;
  for (const query of [
    { supply: 'invented', borrow: null },
    { supply: null },
    { supply: null, borrow: null, provider: 'https://private' },
    { supply: 123, borrow: null },
    null,
  ])
    expect((await post(query)).status).toBe(400);
  expect(load.mock.calls.length).toBe(before);
});
it('searches without wallet parameters and deduplicates repeated searches', async () => {
  const query = { supply: 'sUSDai', borrow: 'USDC' };
  const before = load.mock.calls.length;
  const r = await post(query);
  expect(r.status).toBe(200);
  expect(r.headers.get('cache-control')).toBe('no-store');
  expect(await r.json()).toMatchObject({ query, markets: [] });
  await post(query);
  expect(load.mock.calls.length).toBe(before + 1);
});
it('does not cache failures or expose provider details', async () => {
  load.mockRejectedValueOnce(Error('https://provider/private-secret'));
  const r = await post({ supply: 'scrvUSD', borrow: null });
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain('private-secret');
  expect((await post({ supply: 'scrvUSD', borrow: null })).status).toBe(200);
});
it('shares in-flight work for broad wildcard requests', async () => {
  let finish!: (value: DiscoveryResult) => void;
  const pending = new Promise<DiscoveryResult>((resolve) => {
    finish = resolve;
  });
  load.mockReturnValueOnce(pending);
  const a = post({ supply: null, borrow: null });
  await vi.waitFor(() =>
    expect(load).toHaveBeenCalledWith({ supply: null, borrow: null }),
  );
  const before = load.mock.calls.length,
    b = post({ supply: null, borrow: null });
  finish({
    query: { supply: null, borrow: null },
    checkedAt: '2026-11-26T17:00:00Z',
    markets: [],
    coverage: [],
    messages: [],
  });
  expect((await a).status).toBe(200);
  expect((await b).status).toBe(200);
  expect(load.mock.calls.length).toBe(before);
});

it('validates leveraged searches and shares cached reader work while filtering strategy responses only', async () => {
  const { strategyMarket } = await import('./fixtures/strategies');
  const strategyPost = (body: unknown) => fetch(`${base}/api/leveraged-strategies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const before = load.mock.calls.length;
  for (const body of [{ supply: 'USDC', borrow: null }, { supply: 'sUSDai', borrow: 'sUSDai' }, { supply: null, borrow: null, healthFactor: 2 }]) expect((await strategyPost(body)).status).toBe(400);
  expect(load.mock.calls.length).toBe(before);
  const query = { supply: 'sUSDai', borrow: null };
  load.mockResolvedValueOnce({ query, checkedAt: '2026-11-27T00:00:00Z', markets: [strategyMarket(), strategyMarket({ borrowApr: .1 })], coverage: [], messages: [] });
  const response = await strategyPost(query);
  expect(response.status).toBe(200);
  expect((await response.json()).markets).toMatchObject([{ modelledApr: expect.closeTo(.295, 10) }]);
  const ordinary = await post(query);
  expect((await ordinary.json()).markets).toHaveLength(2);
  expect(load.mock.calls.length).toBe(before + 1);
});
