import { expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWalletHistoryStore } from '../server/wallet-history-store';
import { mergeWalletHistory, parseManualPriceInput, parseWalletHistory, savedManualPrices, type WalletHistoryFile } from '../src/wallet-history';
import { example } from '../src/example';
const a = '0xe16be042f9433779909a972669be3a2003956348', b = '0xc6dd9976066f3364b4d6a72cd4f1fa0468327aa7', token = '0x1111111111111111111111111111111111111111';
const day = '2026-11-21T10:00:00.000Z', later = '2026-11-21T11:00:00.000Z';
const input = { network: 'ethereum' as const, protocol: 'aave-v3', positionId: 'pool-1', pricesUsd: { [token]: 0.8 } };
const empty = (): WalletHistoryFile => ({ version: 1, wallets: [] });
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function path() { const dir = await mkdtemp(join(tmpdir(), 'defimon-history-')); dirs.push(dir); return join(dir, 'wallet-history.json'); }
function github(initial = empty()) {
  let data = structuredClone(initial), sha = 'one';
  const fetcher = vi.fn(async (_url: any, init: any) => {
    if (init.method !== 'PUT') return Response.json({ sha, encoding: 'base64', content: Buffer.from(JSON.stringify(data)).toString('base64') });
    const body = JSON.parse(init.body); expect(body.sha).toBe(sha);
    expect(body.message).toContain('[skip ci] [skip render]');
    data = JSON.parse(Buffer.from(body.content, 'base64').toString()); sha += 'next'; return Response.json({});
  });
  return { fetcher, get: () => structuredClone(data), change: (v: WalletHistoryFile) => { data = v; sha += 'other'; } };
}
it('deduplicates case variants and merges the latest check separately from per-position price timestamps', () => {
  const file = parseWalletHistory({ version: 1, wallets: [
    { address: a.toUpperCase().replace('0X', '0x'), lastCheckedAt: later, manualLiquidationPrices: [{ ...input, updatedAt: day }] },
    { address: a, lastCheckedAt: day, manualLiquidationPrices: [{ ...input, pricesUsd: { [token]: 0 }, updatedAt: later }] },
  ] });
  expect(file.wallets).toHaveLength(1); expect(file.wallets[0].address).toBe(a);
  expect(file.wallets[0].lastCheckedAt).toBe(later);
  expect(file.wallets[0].manualLiquidationPrices[0]).toMatchObject({ updatedAt: later, pricesUsd: { [token]: 0 } });
});
it('keeps different networks, protocols, markets and wallets separate', () => {
  const rows = [input, { ...input, network: 'arbitrum' as const }, { ...input, protocol: 'compound' }, { ...input, positionId: 'pool-2' }].map(p => ({ ...p, updatedAt: day }));
  const data = parseWalletHistory({ version: 1, wallets: [{ address: a, lastCheckedAt: day, manualLiquidationPrices: rows }, { address: b, lastCheckedAt: day, manualLiquidationPrices: [] }] });
  expect(mergeWalletHistory(data, data).wallets).toHaveLength(2);
  expect(data.wallets.find(w => w.address === a)?.manualLiquidationPrices).toHaveLength(4);
});
it('rejects malformed records, unsupported chains, extra fields, invalid contracts and invalid price values', () => {
  for (const v of [{ ...input, network: 'moon' }, { ...input, positionId: '' }, { ...input, address: a }, ...[-1, NaN, Infinity, undefined, '0.8', null].map(price => ({ ...input, pricesUsd: { [token]: price } })), { ...input, pricesUsd: { ETH: 1 } }, { ...input, pricesUsd: {} }]) expect(() => parseManualPriceInput(v)).toThrow();
  for (const v of [[], { version: 2, wallets: [] }, { version: 1, wallets: [{ address: a, lastCheckedAt: 'yesterday', manualLiquidationPrices: [] }] }]) expect(() => parseWalletHistory(v)).toThrow();
});
it('restores only current manual collateral fields, ignoring removed assets and a changed largest collateral', () => {
  const p = structuredClone(example.protocols[0].positions[0]);
  p.id = 'pool-1'; p.debtUsd = 100;
  p.assets = [
    { ...p.assets[0], address: token, supplied: 1, borrowed: 0, priceUsd: 1, collateral: true, liquidationThreshold: .8 },
    { ...p.assets[0], address: b, supplied: 10, borrowed: 0, priceUsd: 10, collateral: true, liquidationThreshold: .8 },
  ];
  const wallet = { address: a, lastCheckedAt: day, manualLiquidationPrices: [{ ...input, pricesUsd: { [token]: 0, [b]: 9 }, updatedAt: day }] };
  expect(savedManualPrices(wallet, 'ethereum', 'aave-v3', p)).toEqual({ prices: { [token]: '0' }, updatedAt: day });
  wallet.manualLiquidationPrices[0].pricesUsd[token] = 0.00000001;
  expect(savedManualPrices(wallet, 'ethereum', 'aave-v3', p).prices[token]).toBe('0.00000001');
  wallet.manualLiquidationPrices[0].pricesUsd[token] = 1e22;
  expect(savedManualPrices(wallet, 'ethereum', 'aave-v3', p).prices[token]).toBe('10000000000000000000000');
  expect(savedManualPrices(wallet, 'base', 'aave-v3', p).prices).toEqual({});
  expect(savedManualPrices(wallet, 'ethereum', 'compound', p).prices).toEqual({});
});
it('logs every address once and updates the recent check without deleting its calculated assumptions', async () => {
  const g = github(), file = await path(); let now = Date.parse(day);
  const store = createWalletHistoryStore({ path: file, token: () => 'test-secret', fetcher: g.fetcher, now: () => now });
  await store.recordCheck(a); await store.savePrices(a, input); now = Date.parse(later);
  await Promise.all([store.recordCheck(a.toUpperCase().replace('0X', '0x')), store.recordCheck(b)]);
  const result = await store.readWallet(a);
  expect(result.persistence.synced).toBe(true); expect(g.get().wallets).toHaveLength(2);
  expect(result.wallet?.lastCheckedAt).toBe(later); expect(result.wallet?.manualLiquidationPrices[0].pricesUsd).toEqual(input.pricesUsd);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(g.get()); expect(JSON.stringify(g.get())).not.toContain('test-secret');
});
it('replaces prices only for the recalculated market and restores from GitHub after a restart', async () => {
  const g = github(), store = createWalletHistoryStore({ path: await path(), token: () => 'test', fetcher: g.fetcher, now: () => Date.parse(day) });
  await store.recordCheck(a); await store.savePrices(a, input); await store.savePrices(a, { ...input, positionId: 'pool-2' });
  await store.savePrices(a, { ...input, pricesUsd: { [token]: 0 } });
  const restarted = createWalletHistoryStore({ path: await path(), token: () => 'test', fetcher: g.fetcher });
  const response = await restarted.readWallet(a);
  expect(response.wallet?.manualLiquidationPrices).toHaveLength(2);
  expect(response.wallet?.manualLiquidationPrices.find(p => p.positionId === 'pool-1')?.pricesUsd).toEqual({ [token]: 0 });
  expect(response.wallet?.manualLiquidationPrices.find(p => p.positionId === 'pool-2')?.pricesUsd).toEqual({ [token]: .8 });
});
it('merges concurrent GitHub edits after conflicts instead of losing another wallet or its newer prices', async () => {
  const g = github(); let conflict = true;
  const fetcher = vi.fn(async (...args: Parameters<typeof fetch>) => {
    if (args[1]?.method === 'PUT' && conflict) {
      conflict = false;
      g.change({ version: 1, wallets: [{ address: b, lastCheckedAt: later, manualLiquidationPrices: [{ ...input, updatedAt: later }] }] });
      return Response.json({}, { status: 409 });
    }
    return g.fetcher(...args);
  });
  const store = createWalletHistoryStore({ path: await path(), token: () => 'test', fetcher, now: () => Date.parse(day) });
  expect((await store.recordCheck(a)).persistence.synced).toBe(true);
  expect(g.get().wallets.map(w => w.address)).toEqual([a,b].sort());
  expect(g.get().wallets.find(w => w.address === b)?.manualLiquidationPrices[0].updatedAt).toBe(later);
});
it('retains failed GitHub saves locally for retry and does not replace malformed existing JSON', async () => {
  const g = github(), file = await path(); let fail = true;
  const fetcher = vi.fn(async (...args: Parameters<typeof fetch>) => {
    if (args[1]?.method === 'PUT' && fail) throw new Error('private-token');
    return g.fetcher(...args);
  });
  const store = createWalletHistoryStore({ path: file, token: () => 'test', fetcher });
  expect((await store.recordCheck(a)).persistence.synced).toBe(false);
  expect((await store.savePrices(a, input)).persistence.synced).toBe(false);
  expect(JSON.parse(await readFile(file, 'utf8')).wallets[0].manualLiquidationPrices).toHaveLength(1);
  fail = false; expect((await store.recordCheck(a)).persistence.synced).toBe(true);
  const corrupt = await path(); await writeFile(corrupt, 'broken JSON');
  const invalid = createWalletHistoryStore({ path: corrupt, fetcher: g.fetcher, token: () => 'test' });
  await expect(invalid.recordCheck(a)).rejects.toThrow('Existing records');
  expect(await readFile(corrupt, 'utf8')).toBe('broken JSON');
});

it('does not overwrite malformed remote history when a new lookup can only be retained locally', async () => {
  const fetcher = vi.fn(async (_url: any, _init: any) => Response.json({ sha: 'broken', encoding: 'base64', content: Buffer.from('broken JSON').toString('base64') }));
  const store = createWalletHistoryStore({ path: await path(), token: () => 'test', fetcher: fetcher as any });
  const result = await store.recordCheck(a);
  expect(result.wallet?.address).toBe(a); expect(result.persistence.synced).toBe(false);
  // Only read requests are permitted after parsing the remote contents fails.
  expect(fetcher.mock.calls.some((args: any) => args[1]?.method === 'PUT')).toBe(false);
});

it('persists and restores alert preferences through rechecks, price saves, updates and restart without losing independent records', async () => {
  const { defaultAlertRules } = await import('../src/alert-rules');
  const rule = { network: 'ethereum' as const, protocol: 'aave-v3', positionId: 'pool-1', rules: { ...defaultAlertRules(), newLiquidityAdded: true, utilizationAbove: { enabled: true, thresholdPercent: 90 }, positionAprBelow: { enabled: true, thresholdPercent: -2 } } };
  const g = github(), file = await path(); let now = Date.parse(day);
  const store = createWalletHistoryStore({ path: file, token: () => 'test', fetcher: g.fetcher, now: () => now });
  await store.recordCheck(a); const first = await store.saveAlerts(a, rule);
  await store.saveAlerts(a, { ...rule, network: 'arbitrum' });
  await store.savePrices(a, input); now = Date.parse(later); await store.recordCheck(a);
  const cleared = await store.saveAlerts(a, { ...rule, positionId: 'POOL-1', rules: defaultAlertRules() });
  expect(cleared.wallet?.alerts).toHaveLength(2); expect(cleared.wallet?.manualLiquidationPrices).toHaveLength(1);
  expect(cleared.wallet?.alerts?.find(x => x.network === 'ethereum')?.updatedAt).not.toBe(first.wallet?.alerts?.[0].updatedAt);
  const restarted = createWalletHistoryStore({ path: await path(), token: () => 'test', fetcher: g.fetcher });
  const restored = await restarted.readWallet(a);
  expect(restored.persistence.synced).toBe(true);
  expect(restored.wallet?.alerts?.find(x => x.network === 'ethereum')?.rules).toEqual(defaultAlertRules());
  expect(restored.wallet?.alerts?.find(x => x.network === 'arbitrum')?.rules.utilizationAbove.thresholdPercent).toBe(90);
  expect(restored.wallet?.alerts?.find(x => x.network === 'arbitrum')?.rules.newLiquidityAdded).toBe(true);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(g.get());
});

it('keeps concurrent alert edits and price updates when a GitHub write conflicts', async () => {
  const { defaultAlertRules } = await import('../src/alert-rules');
  const rule = { network: 'ethereum' as const, protocol: 'aave-v3', positionId: 'pool-1', rules: defaultAlertRules() };
  const g = github(); let conflict = true;
  const fetcher = vi.fn(async (...args: Parameters<typeof fetch>) => {
    if (args[1]?.method === 'PUT' && conflict) {
      conflict = false;
      g.change({ version: 1, wallets: [{ address: a, lastCheckedAt: day, manualLiquidationPrices: [{ ...input, updatedAt: later }], alerts: [{ ...rule, network: 'base', updatedAt: later }] }] });
      return Response.json({}, { status: 409 });
    }
    return g.fetcher(...args);
  });
  const store = createWalletHistoryStore({ path: await path(), token: () => 'test', fetcher, now: () => Date.parse(day) });
  const result = await store.saveAlerts(a, rule);
  expect(result.persistence.synced).toBe(true);
  expect(result.wallet?.alerts).toHaveLength(2); expect(result.wallet?.manualLiquidationPrices[0].updatedAt).toBe(later);
});
