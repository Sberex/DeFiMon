import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
vi.mock('../server/pendle', async importOriginal => ({ ...await importOriginal<typeof import('../server/pendle')>(), pendleCatalog: async () => [{ address: '0x4a5067c3ff1abb7449244025b0e37feaf77d8e3e', chainId: 1, pt: { address: '0x7f47c3e6b2c00fc4eb4d5ae50d0ab0ab6888eb4d', chainId: 1 }, yt: { address: '0x5cffcc9ddef0fdcf395e2ea24ca5ed5a12032706', chainId: 1 }, underlyingAsset: { address: '0x056b269eb1f75477a8666ae8c7fe01b64dd55ecc', chainId: 1, symbol: 'USD3' }, accountingAsset: { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', chainId: 1, symbol: 'USDC' } }] }));
import { createApp } from '../server/app';
let server: Server, base: string;
beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const a = server.address(); if (!a || typeof a === 'string') throw Error(); base = `http://127.0.0.1:${a.port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
it('returns a compact exact-contract underlying mapping with CORS and rejects unsupported networks', async () => {
  const response = await fetch(`${base}/api/pendle-safety-assets/ethereum`, { headers: { Origin: 'https://app.sberex.com' } });
  expect(response.status).toBe(200); expect(response.headers.get('access-control-allow-origin')).toBe('https://app.sberex.com');
  const body = await response.json(); expect(body.chainId).toBe(1); expect(body.markets[0].base.address).toBe('0x056b269eb1f75477a8666ae8c7fe01b64dd55ecc'); expect(body.markets[0]).not.toHaveProperty('accountingAsset');
  for (const network of ['unknown', 'arc']) expect((await fetch(`${base}/api/pendle-safety-assets/${network}`)).status).toBe(400);
});
