import { expect, it, vi } from 'vitest';
import { MERKL_API, parseMerklRewards, readMerklRewards } from '../server/merkl';
const wallet = '0x1111111111111111111111111111111111111111';
const token = '0x2222222222222222222222222222222222222222';
const now = 2000000000;
const reward = (changes: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}) => ({ amount: '10000000', claimed: '4000000', pending: '2000000', token: { address: token, chainId: 1, symbol: 'RWD', decimals: 6, type: 'TOKEN', isTest: false, verified: true, price: 1.5, updatedAt: now, ...metadata }, ...changes });
const chain = (id = 1, rewards: unknown[] = [reward()]) => ({ chain: { id, endOfDisputePeriod: 0 }, rewards });
it('subtracts cumulative claims, converts token units, and keeps pending separate', () => {
  const result = parseMerklRewards(wallet, [chain()], now);
  expect(result.networks.map(n => n.chain)).toEqual(['Ethereum', 'Plasma', 'Arbitrum']);
  expect(result.networks[0].rewards[0]).toMatchObject({ unclaimed: 6, pending: 2, unclaimedRaw: '6000000', pendingRaw: '2000000', priceUsd: 1.5, unclaimedUsd: 9, pendingUsd: 3 });
  expect(result.networks[0].unclaimedUsd).toBe(9);
  expect(result.networks[1].rewards).toEqual([]);
});
it('does not count claimed tokens twice and clamps indexer reconciliation differences to zero', () => {
  const result = parseMerklRewards(wallet, [chain(1, [reward({ claimed: '20000000' })])], now);
  expect(result.networks[0].rewards[0]).toMatchObject({ unclaimed: 0, unclaimedUsd: 0, pending: 2 });
  expect(parseMerklRewards(wallet, [chain(1, [reward({ claimed: '10000000', pending: '0' })])], now).networks[0].rewards).toEqual([]);
});
it('shows confirmed empty reports as empty rather than a failure, and filters unsupported chains and non-token rewards', () => {
  expect(parseMerklRewards(wallet, [], now).status).toBe('ok');
  const result = parseMerklRewards(wallet, [chain(1, [reward({}, { type: 'POINT' }), reward({}, { type: 'PRETGE' }), reward({}, { isTest: true })]), chain(10, [reward()])], now);
  expect(result.networks.every(n => n.rewards.length === 0 && n.unclaimedUsd === 0)).toBe(true);
});
it('requires matching token chain, valid integer amounts, token identity and decimals while retaining good rows', () => {
  for (const bad of [reward({}, { chainId: 9745 }), reward({ amount: '-1' }), reward({ claimed: '1.1' }), reward({ pending: 5 }), reward({ amount: '9'.repeat(79) }), reward({}, { address: 'bad' }), reward({}, { decimals: 37 })]) {
    const result = parseMerklRewards(wallet, [chain(1, [reward(), bad])], now);
    expect(result.status).toBe('partial'); expect(result.networks[0].rewards).toHaveLength(1); expect(result.networks[0].unclaimedUsd).toBeNull();
  }
});
it('rejects duplicate chain/token rows instead of doubling reward balances', () => {
  for (const data of [[chain(), chain()], [chain(1, [reward(), reward()])]]) {
    const result = parseMerklRewards(wallet, data, now);
    expect(result.networks[0].rewards).toHaveLength(1); expect(result.networks[0].unclaimedUsd).toBeNull(); expect(result.status).toBe('partial');
  }
});
it('preserves token rewards but keeps stale, missing, unverified or invalid USD quotes unknown', () => {
  for (const changes of [{ updatedAt: now - 3601 }, { updatedAt: now + 301 }, { updatedAt: null }, { price: null }, { price: '1' }, { price: -1 }, { verified: false }]) {
    const result = parseMerklRewards(wallet, [chain(1, [reward({}, changes)])], now);
    expect(result.networks[0].rewards[0].unclaimed).toBe(6); expect(result.networks[0].unclaimedUsd).toBeNull(); expect(result.status).toBe('partial');
  }
  expect(parseMerklRewards(wallet, [chain(1, [reward({}, { updatedAt: now * 1000 })])], now).networks[0].unclaimedUsd).toBe(9);
});
it('routes all three networks correctly and reports dispute windows without promising immediate claimability', () => {
  const result = parseMerklRewards(wallet, [chain(9745, [reward({}, { chainId: 9745 })]), { ...chain(42161, [reward({}, { chainId: 42161 })]), chain: { id: 42161, endOfDisputePeriod: now + 600 } }], now);
  expect(result.networks[1].rewards[0].unclaimed).toBe(6); expect(result.networks[2].disputeUntil).toBe(now + 600);
});
it('calls the official summary endpoint without keys, histories, provider URLs or wallet signing', async () => {
  const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) => new Response(JSON.stringify([chain()])));
  await readMerklRewards(wallet, fetcher as typeof fetch);
  expect(fetcher.mock.calls[0][0]).toBe(`${MERKL_API}/users/${wallet}/rewards/summary`);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' } });
});
it('isolates connection, rate-limit, HTTP and schema failures without inventing empty balances or leaking errors', async () => {
  for (const fetcher of [async () => { throw new Error('private-provider-secret'); }, async () => new Response('no', { status: 429 }), async () => new Response('no', { status: 403 }), async () => new Response('{bad'), async () => new Response('{}'), async () => new Response(JSON.stringify([{}]))]) {
    const result = await readMerklRewards(wallet, fetcher as typeof fetch);
    expect(result.status).toBe('error'); expect(result.networks.every(n => n.unclaimedUsd === null && n.status === 'error')).toBe(true); expect(JSON.stringify(result)).not.toContain('private-provider-secret');
  }
});
