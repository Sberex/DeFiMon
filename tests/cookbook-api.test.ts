import { expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { emptyCookbook } from '../src/cookbook';
import { unavailableMerkl } from '../server/merkl';
import type { Portfolio } from '../src/types';
import { snapshot } from './fixtures/cookbook';
const wallet = '0x1111111111111111111111111111111111111111';
it('captures only server-analysed portfolio data and exposes the saved JSON without accepting client snapshots', async () => {
  const portfolio = snapshot(), record = vi.fn(async (_portfolio: Portfolio) => {}), rewards = vi.fn(async () => unavailableMerkl(wallet));
  const load = vi.fn(async () => portfolio);
  const stored = { data: emptyCookbook(), persistence: { mode: 'local' as const, synced: false } };
  const server = createApp(load, rewards, undefined, { record, read: async () => stored }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${base}/api/portfolio/${wallet}`);
    expect(response.status).toBe(200); expect(record).toHaveBeenCalledTimes(1); expect(record.mock.calls[0][0]).toMatchObject({ address: wallet });
    await fetch(`${base}/api/rewards/${wallet}`); expect(rewards).toHaveBeenCalledTimes(1);
    const cookbook = await fetch(`${base}/api/cookbook`); expect(await cookbook.json()).toEqual(stored); expect(cookbook.headers.get('cache-control')).toBe('no-store');
    const rejected = await fetch(`${base}/api/cookbook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apr: 9 }) });
    expect(rejected.status).toBe(404); expect(record).toHaveBeenCalledTimes(1);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});
it('keeps a successful portfolio response when Cookbook persistence fails', async () => {
  const portfolio = snapshot();
  const server = createApp(async () => portfolio, async () => unavailableMerkl(wallet), undefined, { record: async () => { throw Error('private-cookbook-token'); }, read: async () => { throw Error(); } }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/portfolio/${wallet}`);
    expect(response.status).toBe(200); expect(response.headers.get('x-cookbook-save')).toBe('unavailable');
    expect(await response.json()).toEqual(portfolio);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});

it('records test-case candidates from server results even when Cookbook saving fails', async () => {
  const portfolio = snapshot(), record = vi.fn(async (_portfolio: Portfolio) => {});
  const server = createApp(async () => portfolio, async () => unavailableMerkl(wallet), undefined, { record: async () => { throw Error('cookbook failure'); }, read: async () => { throw Error(); } }, { record }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/portfolio/${wallet}`);
    expect(response.status).toBe(200); expect(record).toHaveBeenCalledWith(portfolio);
    record.mockRejectedValueOnce(new Error('private-test-case-token'));
    const failedSave = await fetch(`http://127.0.0.1:${address.port}/api/portfolio/${wallet}`);
    expect(failedSave.status).toBe(200); expect(failedSave.headers.get('x-test-cases-save')).toBe('unavailable');
    expect(await failedSave.json()).toEqual(portfolio);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});
