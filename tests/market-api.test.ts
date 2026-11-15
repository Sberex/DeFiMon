import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import type { ComparisonTarget, MarketSearch } from '../src/market-comparison';
const target: ComparisonTarget = { id: 'pair', network: 'ethereum', supplied: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', borrowed: '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f' };
const load = vi.fn(async (): Promise<MarketSearch> => ({ checkedAt: '2026-11-15T12:00:00Z', coverage: [], alternatives: [] }));
let server: Server, base: string;
beforeAll(async () => {
  server = createApp(undefined, undefined, load).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error(); base = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
const post = (body: unknown) => fetch(`${base}/api/recommendations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
it('validates bounded token-only requests before calling a market source', async () => {
  const before = load.mock.calls.length;
  for (const targets of [[], Array.from({ length: 41 }, (_, i) => ({ ...target, id: String(i) })), [target, target], [{ ...target, network: 'base' }], [{ ...target, supplied: 'bad' }], [{ ...target, supplied: 12 }], [{ ...target, borrowed: 123 }], [{ ...target, supplyBasket: ['bad'] }], [{ ...target, arbitraryUrl: 'https://example.com' }]]) {
    expect((await post({ targets })).status).toBe(400);
  }
  expect(load.mock.calls.length).toBe(before);
});
it('returns fresh search results without accepting or logging wallet/provider credentials', async () => {
  const response = await post({ targets: [target] });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ alternatives: [], coverage: [] });
});
it('returns a safe error when a source orchestration fails', async () => {
  load.mockRejectedValueOnce(new Error('https://private-provider/secret-key'));
  const response = await post({ targets: [target] });
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret-key');
});
