import { afterAll, beforeAll, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { apiCors } from '../server/cors';
import { publicApiBase } from '../src/api';
let server: Server, base: string;
const previousOrigins = process.env.FRONTEND_ORIGINS;
beforeAll(async () => {
  process.env.FRONTEND_ORIGINS = 'https://sberex.github.io, https://monitor.example';
  const app = express(); app.use('/api', apiCors);
  app.post('/api/recommendations', express.json(), (_req, res) => res.json({ ok: true }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('Missing port');
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  if (previousOrigins === undefined) delete process.env.FRONTEND_ORIGINS; else process.env.FRONTEND_ORIGINS = previousOrigins;
  await new Promise<void>(resolve => server.close(() => resolve()));
});
it.each(['https://sberex.github.io', 'https://app.sberex.com'])('permits %s JSON preflight and requests without enabling credentials', async origin => {
  const headers = { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' };
  const preflight = await fetch(`${base}/api/recommendations`, { method: 'OPTIONS', headers });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-origin')).toBe(headers.Origin);
  expect(preflight.headers.get('access-control-allow-headers')).toBe('Content-Type');
  expect(preflight.headers.get('access-control-allow-credentials')).toBeNull();
  const response = await fetch(`${base}/api/recommendations`, { method: 'POST', headers: { Origin: headers.Origin, 'Content-Type': 'application/json' }, body: '{}' });
  expect(await response.json()).toEqual({ ok: true });
  expect(response.headers.get('vary')).toContain('Origin');
});
it('rejects other browser origins and allows local same-origin and non-browser requests', async () => {
  const denied = await fetch(`${base}/api/recommendations`, { method: 'OPTIONS', headers: { Origin: 'https://other.example' } });
  expect(denied.status).toBe(403); expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  for (const origin of [undefined, base]) {
    const response = await fetch(`${base}/api/recommendations`, { method: 'POST', ...(origin ? { headers: { Origin: origin } } : {}) });
    expect(response.status).toBe(200);
  }
});
it('accepts only a public server origin, keeping paths, credentials and insecure remote hosts out', () => {
  expect(publicApiBase(' https://defimon.example/ ')).toBe('https://defimon.example');
  expect(publicApiBase('')).toBe(''); expect(publicApiBase('http://localhost:3001')).toBe('http://localhost:3001');
  for (const url of ['https://user:key@example.com', 'http://example.com', 'https://example.com/api', 'https://example.com?key=private']) expect(() => publicApiBase(url)).toThrow();
});
