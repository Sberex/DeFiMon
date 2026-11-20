import { readFileSync } from 'node:fs';
import { isAddress } from 'viem';
import { parseIntrinsicOracles, type IntrinsicOracle } from './intrinsic-oracles.js';
import type { NetworkId, TokenCategory } from '../src/types.js';
export type TokenAddresses = Partial<Record<NetworkId, string>> & Record<string, string | undefined>;
export interface RegistryToken { category: TokenCategory; addresses: TokenAddresses; intrinsicOracles?: IntrinsicOracle[] }
export type TokenRegistry = Record<string, RegistryToken>;
const categories = new Set<TokenCategory>(['Other', 'Stablecoin', 'Savings stablecoin']);
export const evmChains: Record<string, { chainId: number; name: string }> = JSON.parse(readFileSync(new URL('../config/evm-chains.json', import.meta.url), 'utf8'));
/** Network names must be explicit EVM registry keys. Categories never act as contract matches. */
export function parseTokenRegistry(value: unknown): TokenRegistry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('token-matches.json must contain an object of token groups.');
  const result: TokenRegistry = Object.create(null), seen = new Set<string>();
  for (const [name, group] of Object.entries(value)) {
    if (!name.trim() || name.length > 160 || !group || typeof group !== 'object' || Array.isArray(group)) throw new Error('Each token match needs a name and network addresses.');
    const category = '_category' in group ? group._category : 'Other';
    if (typeof category !== 'string' || !categories.has(category as TokenCategory)) throw new Error(`Invalid _category for ${name}. Use Stablecoin, Savings stablecoin or Other.`);
    const addresses: TokenAddresses = Object.create(null);
    for (const [network, address] of Object.entries(group)) {
      if (network === '_category' || network === '_intrinsicOracles') continue;
      if (!Object.hasOwn(evmChains, network) || typeof address !== 'string' || !isAddress(address, { strict: false }) || /^0x0{40}$/i.test(address) || /^0x[eE]{40}$/.test(address)) throw new Error(`Invalid EVM network or contract address in token-matches.json for ${name}.`);
      const key = `${network}:${address.toLowerCase()}`;
      if (seen.has(key)) throw new Error(`Duplicate network/address in token-matches.json for ${name}. Each contract must belong to only one token group.`);
      seen.add(key); addresses[network] = address.toLowerCase();
    }
    if (!Object.keys(addresses).length) throw new Error(`Token ${name} needs at least one EVM contract address.`);
    const intrinsicOracles = '_intrinsicOracles' in group ? parseIntrinsicOracles(group._intrinsicOracles, addresses, name) : undefined;
    result[name] = { category: category as TokenCategory, addresses, ...(intrinsicOracles ? { intrinsicOracles } : {}) };
  }
  return result;
}
export const configuredTokenRegistry = parseTokenRegistry(JSON.parse(readFileSync(new URL('../config/token-matches.json', import.meta.url), 'utf8')));
const byNetwork = new Map<string, { address: `0x${string}`; symbol: string; category: TokenCategory }[]>();
for (const [group, token] of Object.entries(configuredTokenRegistry)) {
  for (const [network, address] of Object.entries(token.addresses)) {
    if (!address) continue;
    const rows = byNetwork.get(network) ?? [];
    rows.push({ address: address as `0x${string}`, symbol: group.split('#')[0], category: token.category });
    byNetwork.set(network, rows);
  }
}
export const configuredWalletTokens = (network: NetworkId) => byNetwork.get(network) ?? [];
const categoryByContract = new Map(Object.values(configuredTokenRegistry).flatMap(token => Object.entries(token.addresses).map(([network, address]) => [`${network}:${address}`, token.category] as const)));
export const configuredTokenCategory = (network: NetworkId, address: string) => categoryByContract.get(`${network}:${address.toLowerCase()}`);
