import { beforeAll, afterAll, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { parsePharosGrades } from '../src/pharos-safety';
let server: Server, base: string, fail = false;
beforeAll(async () => {
  server = createApp(undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {
    if (fail) throw Error('provider-private-details');
    return parsePharosGrades({ schemaVersion: 1, asOfSec: Math.floor(Date.now() / 1000), publicationStatus: 'current', methodologyVersion: '10.57', grades: [{ id: 'usdc-circle', grade: 'A+', score: 91, ratingStatus: 'rated' }] });
  }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error();
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
it('serves verified grades through the API CORS policy without a wallet lookup', async () => {
  const response = await fetch(`${base}/api/safety-grades`, { headers: { Origin: 'https://app.sberex.com' } });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('access-control-allow-origin')).toBe('https://app.sberex.com');
  expect((await response.json()).grades[0]).toMatchObject({ id: 'usdc-circle', grade: 'A+' });
});
it('reports a sanitized source failure rather than inventing grades', async () => {
  fail = true; const response = await fetch(`${base}/api/safety-grades`);
  expect(response.status).toBe(503); const body = await response.json(); expect(body.error).toContain('temporarily unavailable'); expect(JSON.stringify(body)).not.toContain('provider-private-details');
});
