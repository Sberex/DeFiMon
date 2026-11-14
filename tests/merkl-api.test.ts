import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { example } from '../src/example';
import { merklExample } from '../src/merkl-example';
let server: Server, base: string, reads = 0;
beforeAll(async () => {
  server = createApp(async () => example, async address => { reads++; if (address.toLowerCase() !== example.address) throw new Error('private-upstream-secret'); return { ...merklExample, address }; }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
it('returns separate read-only rewards with no-store and leaves the lending response unchanged', async () => {
  const response = await fetch(`${base}/api/rewards/${example.address}`);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await response.json()).networks).toHaveLength(3);
  expect(await (await fetch(`${base}/api/portfolio/${example.address}`)).json()).toEqual(example);
});
it('rejects invalid addresses, zero addresses and provider/query injection before a lookup', async () => {
  const before = reads;
  for (const input of ['bad', '0x' + '0'.repeat(40), example.address + '?provider=https://bad', example.address + '?chain=all']) expect((await fetch(`${base}/api/rewards/${input}`)).status).toBe(400);
  expect(reads).toBe(before);
});
it('turns upstream failures into unknown rewards without exposing private details or breaking portfolio reads', async () => {
  const response = await fetch(`${base}/api/rewards/0x2222222222222222222222222222222222222222`);
  const body = await response.json(); expect(body.status).toBe('error'); expect(JSON.stringify(body)).not.toContain('private-upstream-secret');
  expect((await fetch(`${base}/api/portfolio/${example.address}`)).status).toBe(200);
});
