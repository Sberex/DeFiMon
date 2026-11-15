import type { NetworkId } from '../src/types.js';
import { walletTokenCatalog } from './deployments/wallet-tokens.js';
import { networks } from './networks.js';
// Cross-network mappings come only from the reviewed deployment list, never API symbols.
// Distinct symbols such as USDC.e, USDC, USDT0, USDT remain distinct assets.
export function correspondingTokens(address: string, from: NetworkId, to: NetworkId): string[] {
  const key = normalizeMarketToken(address, from);
  if (from === to) return [key];
  const original = walletTokenCatalog[from].find(t => t.address.toLowerCase() === key);
  if (!original) return [];
  return walletTokenCatalog[to].filter(t => t.symbol === original.symbol).map(t => t.address.toLowerCase());
}
export function normalizeMarketToken(address: string, network: NetworkId) {
  return address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ? networks[network].wrappedNative.toLowerCase() : address.toLowerCase();
}
