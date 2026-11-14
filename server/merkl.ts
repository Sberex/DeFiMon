import { formatUnits, getAddress, isAddress, type Address } from 'viem';
import type { MerklNetworkRewards, MerklRewards, MerklTokenReward } from '../src/types.js';
import { networkOrder } from '../src/networks.js';
import { networks } from './networks.js';
// Public @merkl/api@1.20.21: UserController rewards.summary GET and UserRewardsSummaryResourceDto.
export const MERKL_API = 'https://api.merkl.xyz/v4';
const MAX_UINT = (1n << 256n) - 1n;
type Obj = Record<string, unknown>;
function object(value: unknown): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Merkl object');
  return value as Obj;
}
function amount(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d{1,78}$/.test(value)) throw new Error('Invalid reward amount');
  const result = BigInt(value); if (result > MAX_UINT) throw new Error('Invalid reward amount'); return result;
}
function total(values: (number | null)[]) { const sum = values.some(v => v === null) ? null : values.reduce<number>((a, b) => a + b!, 0); return sum !== null && Number.isFinite(sum) ? sum : null; }
function timestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value > 1e12 ? value / 1000 : value;
}
function tokenReward(value: unknown, chainId: number, now: number): MerklTokenReward | null {
  const row = object(value), token = object(row.token);
  if (token.isTest === true || token.type === 'POINT' || token.type === 'PRETGE') return null;
  if (token.type !== 'TOKEN' || token.chainId !== chainId || typeof token.address !== 'string' || !isAddress(token.address, { strict: false }) || /^0x0{40}$/i.test(token.address) || typeof token.symbol !== 'string' || !token.symbol.trim() || token.symbol.length > 64 || !Number.isInteger(token.decimals) || Number(token.decimals) < 0 || Number(token.decimals) > 36) throw new Error('Invalid reward token');
  const published = amount(row.amount), claimed = amount(row.claimed), pendingRaw = amount(row.pending);
  // Merkl amounts are cumulative; claimed tokens already belong in the wallet, not unclaimed rewards.
  const unclaimedRaw = published > claimed ? published - claimed : 0n;
  if (unclaimedRaw === 0n && pendingRaw === 0n) return null;
  const decimals = Number(token.decimals);
  const unclaimed = Number(formatUnits(unclaimedRaw, decimals)), pending = Number(formatUnits(pendingRaw, decimals));
  const updated = timestamp(token.updatedAt);
  const priceUsd = token.verified === true && typeof token.price === 'number' && Number.isFinite(token.price) && token.price > 0 && updated !== null && now - updated <= 3600 && updated <= now + 300 ? token.price : null;
  const usd = (quantity: number) => quantity === 0 ? 0 : priceUsd === null || !Number.isFinite(quantity * priceUsd) ? null : quantity * priceUsd;
  return { address: getAddress(token.address.toLowerCase()), symbol: token.symbol, decimals, unclaimed, pending, unclaimedRaw: String(unclaimedRaw), pendingRaw: String(pendingRaw), priceUsd, unclaimedUsd: usd(unclaimed), pendingUsd: usd(pending) };
}
export function unavailableMerkl(address: string, message = 'Merkl rewards are unavailable. Check access to api.merkl.xyz and refresh. Reward balances are unknown.'): MerklRewards {
  return { address, updatedAt: new Date().toISOString(), status: 'error', message, networks: networkOrder.map(id => ({ chain: networks[id].name, status: 'error', rewards: [], unclaimedUsd: null, pendingUsd: null, message })) };
}
export function parseMerklRewards(address: Address, value: unknown, now = Date.now() / 1000): MerklRewards {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid Merkl response');
  const result: MerklNetworkRewards[] = networkOrder.map(id => ({ chain: networks[id].name, status: 'ok', rewards: [], unclaimedUsd: 0, pendingUsd: 0 }));
  const seenChains = new Set<number>();
  const invalid = new Set<number>();
  for (const valueRow of value) {
    const row = object(valueRow), chain = object(row.chain);
    if (!Number.isSafeInteger(chain.id) || Number(chain.id) <= 0) throw new Error('Invalid Merkl chain');
    const index = networkOrder.findIndex(id => networks[id].id === chain.id);
    if (index < 0) continue;
    const entry = result[index];
    if (seenChains.has(index)) { invalid.add(index); continue; }
    seenChains.add(index);
    if (!Array.isArray(row.rewards) || row.rewards.length > 5000) { invalid.add(index); continue; }
    const dispute = timestamp(chain.endOfDisputePeriod);
    if (dispute !== null && dispute > now) entry.disputeUntil = dispute;
    const seenTokens = new Set<string>();
    for (const reward of row.rewards) {
      try {
        const token = tokenReward(reward, Number(chain.id), now);
        if (!token) continue;
        const key = token.address.toLowerCase();
        if (seenTokens.has(key)) { invalid.add(index); continue; }
        seenTokens.add(key); entry.rewards.push(token);
      } catch { invalid.add(index); }
    }
    entry.unclaimedUsd = total(entry.rewards.map(t => t.unclaimedUsd));
    entry.pendingUsd = total(entry.rewards.map(t => t.pendingUsd));
  }
  result.forEach((entry, index) => {
    if (invalid.has(index)) {
      entry.status = 'partial'; entry.unclaimedUsd = null; entry.pendingUsd = null;
      entry.message = 'Some Merkl reward records could not be verified. Readable token balances are shown; complete totals are unknown.';
    } else if (entry.rewards.some(r => r.priceUsd === null) || entry.unclaimedUsd === null || entry.pendingUsd === null) {
      entry.status = 'partial'; entry.message = 'Some rewards have no fresh, verified Merkl USD quote. Token balances are shown; dollar values are incomplete.';
    }
  });
  return { address: getAddress(address), updatedAt: new Date(now * 1000).toISOString(), status: result.some(n => n.status !== 'ok') ? 'partial' : 'ok', networks: result };
}
export async function readMerklRewards(address: Address, fetcher: typeof fetch = fetch): Promise<MerklRewards> {
  try {
    const wallet = getAddress(address);
    const response = await fetcher(`${MERKL_API}/users/${wallet}/rewards/summary`, { signal: AbortSignal.timeout(12000), cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) return unavailableMerkl(wallet, response.status === 429 ? 'Merkl rate limit reached. Refresh later; reward balances are unknown.' : undefined);
    const text = await response.text(); if (text.length > 2000000) throw new Error('Merkl response too large');
    return parseMerklRewards(wallet, JSON.parse(text));
  } catch { return unavailableMerkl(address); }
}
