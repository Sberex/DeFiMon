import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { isolateProtocol } from '../server/portfolio';
import { example } from '../src/example';
let server: Server;
let base: string;
let reads = 0;
const chains: string[] = [];
beforeAll(async () => {
  server = createApp(async (_wallet, network) => { reads++; chains.push(network); return example; }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP port');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
it('rejects invalid addresses before reading the chain', async () => {
  const before = reads;
  for (const address of ['not-a-wallet', '0x0000000000000000000000000000000000000000']) {
    const response = await fetch(`${base}/api/portfolio/${address}`);
    expect(response.status).toBe(400);
  }
  expect(reads).toBe(before);
});
it('serves the reader response with no-store caching', async () => {
  const response = await fetch(`${base}/api/portfolio/${example.address}`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await response.json()).protocols).toHaveLength(5);
});
it('returns health and configuration presence without secret values', async () => {
  const response = await fetch(`${base}/api/health`);
  const body = await response.json();
  expect(body.status).toBe('ok');
  expect(typeof body.ethereumConfigured).toBe('boolean');
});
it('isolates protocol errors without exposing RPC credentials or claiming empty balances', async () => {
  const failed = await isolateProtocol('aave', 'Aave', 'test market', async () => { throw new Error('https://secret-rpc/key-private'); });
  expect(failed.status).toBe('error');
  expect(failed.message).toContain('unknown');
  expect(JSON.stringify(failed)).not.toContain('key-private');
});

it('routes the selected network and rejects unsupported or ambiguous networks before any reads', async () => {
  await fetch(`${base}/api/portfolio/${example.address}?chain=plasma`);
  expect(chains.at(-1)).toBe('plasma');
  await fetch(`${base}/api/portfolio/${example.address}`);
  expect(chains.at(-1)).toBe('ethereum');
  const before = reads;
  for (const query of ['chain=unknown', 'chain=plasma&chain=ethereum', 'chain[network]=plasma']) {
    expect((await fetch(`${base}/api/portfolio/${example.address}?${query}`)).status).toBe(400);
  }
  expect(reads).toBe(before);
});
