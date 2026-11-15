import { readFileSync } from 'node:fs';
import { isAddress } from 'viem';
import type { NetworkId } from '../src/types.js';
import { isNetworkId } from '../src/networks.js';
import { networks } from './networks.js';
export type TokenMatches = Record<string, Partial<Record<NetworkId, string>>>;
/** Reject typos and ambiguous groups rather than comparing unrelated token contracts. */
export function parseTokenMatches(value: unknown): TokenMatches {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('token-matches.json must contain an object of token groups.');
  const result: TokenMatches = {}, seen = new Set<string>();
  for (const [name, group] of Object.entries(value)) {
    if (!name.trim() || name.length > 80 || !group || typeof group !== 'object' || Array.isArray(group) || !Object.keys(group).length) throw new Error('Each token match needs a name and at least one network address.');
    const addresses: Partial<Record<NetworkId, string>> = {};
    for (const [network, address] of Object.entries(group)) {
      if (!isNetworkId(network) || typeof address !== 'string' || !isAddress(address, { strict: false }) || /^0x0{40}$/i.test(address)) throw new Error(`Invalid network or contract address in token-matches.json for ${name}. Use ethereum, plasma or arbitrum and a nonzero token contract address.`);
      const key = `${network}:${address.toLowerCase()}`;
      if (seen.has(key)) throw new Error(`Duplicate network/address in token-matches.json for ${name}. Each contract must belong to only one token group.`);
      seen.add(key); addresses[network] = address.toLowerCase();
    }
    Object.defineProperty(result, name, { value: addresses, enumerable: true });
  }
  return result;
}
const tokenMatches = parseTokenMatches(JSON.parse(readFileSync(new URL('../config/token-matches.json', import.meta.url), 'utf8')));
// The editable file is the sole cross-chain identity source. Never infer matches from API tickers.
export function correspondingTokens(address: string, from: NetworkId, to: NetworkId, matches: TokenMatches = tokenMatches): string[] {
  const key = normalizeMarketToken(address, from);
  if (from === to) return [key];
  const group = Object.values(matches).find(addresses => addresses[from]?.toLowerCase() === key);
  return group?.[to] ? [group[to]!.toLowerCase()] : [];
}
export function normalizeMarketToken(address: string, network: NetworkId) {
  return address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ? networks[network].wrappedNative.toLowerCase() : address.toLowerCase();
}
