import { parseTokenRegistry, configuredTokenRegistry, type TokenAddresses } from './token-registry.js';
import type { NetworkId } from '../src/types.js';
import { networks } from './networks.js';
export type TokenMatches = Record<string, TokenAddresses>;
/** Preserve the flat network/address format; validated category metadata is not a match. */
export function parseTokenMatches(value: unknown): TokenMatches {
  return Object.fromEntries(Object.entries(parseTokenRegistry(value)).map(([name, token]) => [name, token.addresses]));
}
export const manualTokenMatches: TokenMatches = Object.fromEntries(Object.entries(configuredTokenRegistry).map(([name, token]) => [name, token.addresses]));
// Manual groups take precedence. Additional groups must be verified by source network/contract identity.
export function correspondingTokens(address: string, from: NetworkId, to: NetworkId, matches: TokenMatches = manualTokenMatches): string[] {
  const key = normalizeMarketToken(address, from);
  if (from === to) return [key];
  const groups = Object.values(matches).filter(addresses => addresses[from]?.toLowerCase() === key);
  const destinations = [...new Set(groups.flatMap(group => group[to] ? [group[to]!.toLowerCase()] : []))];
  return destinations.length === 1 ? destinations : [];
}
export function normalizeMarketToken(address: string, network: NetworkId) {
  return address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ? networks[network].wrappedNative.toLowerCase() : address.toLowerCase();
}
