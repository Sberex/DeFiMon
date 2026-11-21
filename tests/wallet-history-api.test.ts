import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import type { WalletHistoryStore } from '../server/wallet-history-store';
import { example } from '../src/example';
const records: string[] = [], saves: any[] = [];
const saved = { address: example.address.toLowerCase(), lastCheckedAt: '2026-11-21T10:00:00.000Z', manualLiquidationPrices: [] };
const store: WalletHistoryStore = {
  recordCheck: vi.fn(async address => { records.push(address.toLowerCase()); return { wallet: { ...saved, address: address.toLowerCase() }, persistence: { mode: 'github' as const, synced: true } }; }),
  readWallet: vi.fn(async () => ({ wallet: saved, persistence: { mode: 'github' as const, synced: true } })),
  savePrices: vi.fn(async (address, input) => { saves.push({ address, input }); return { wallet: { ...saved, address: address.toLowerCase(), manualLiquidationPrices: [{ ...input, updatedAt: '2026-11-21T11:00:00.000Z' }] }, persistence: { mode: 'github' as const, synced: true } }; }),
};
let server: Server, base: string;
let fail = false;
beforeAll(async () => {
  server = createApp(async address => { if (fail) throw new Error('private-provider-secret'); return { ...structuredClone(example), address }; }, undefined, undefined, undefined, undefined, store).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error(); base = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
it('records every valid attempted lookup, including failed providers, and embeds the saved wallet parameters', async () => {
  const count = records.length;
  for (const suffix of ['', '', '']) {
    const response = await fetch(`${base}/api/portfolio/${example.address}${suffix}`);
    expect(response.status).toBe(200); expect((await response.json()).walletHistory.wallet).toEqual(saved);
  }
  fail = true; const failed = await fetch(`${base}/api/portfolio/${example.address}`); fail = false;
  expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('private-provider-secret');
  expect(records).toHaveLength(count + 4);
  await fetch(`${base}/api/portfolio/invalid`); expect(records).toHaveLength(count + 4);
});
it('returns only the requested wallet without adding a check when reading saved parameters', async () => {
  const count = records.length;
  const response = await fetch(`${base}/api/wallet-history/${example.address}`);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await response.json()).wallet.address).toBe(example.address.toLowerCase()); expect(records).toHaveLength(count);
});
it('saves valid zero-valued collateral assumptions and rejects malformed or excessive writes', async () => {
  const url = `${base}/api/wallet-history/${example.address}/liquidation-prices`;
  const body = { network: 'ethereum', protocol: 'aave-v3', positionId: 'pool-1', pricesUsd: { '0x1111111111111111111111111111111111111111': 0 } };
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  expect(response.status).toBe(200); expect((await response.json()).wallet.manualLiquidationPrices[0]).toMatchObject(body); expect(saves.at(-1).input).toEqual(body);
  const count = saves.length;
  for (const value of [{ ...body, network: 'moon' }, { ...body, positionId: '' }, { ...body, pricesUsd: { token: -1 } }, { ...body, wallet: example.address }, { ...body, pricesUsd: {} }]) {
    expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })).status).toBe(400);
  }
  expect(saves).toHaveLength(count);
});
it('does not turn a history save failure into a failed wallet analysis', async () => {
  vi.mocked(store.recordCheck).mockRejectedValueOnce(new Error('private-github-secret'));
  const response = await fetch(`${base}/api/portfolio/${example.address}`);
  expect(response.status).toBe(200);
  const data = await response.json(); expect(data.protocols.length).toBeGreaterThan(0); expect(data.walletHistory.persistence.synced).toBe(false);
  expect(JSON.stringify(data)).not.toContain('private-github-secret');
});
