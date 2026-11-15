import { getAddress, isAddress, type Address } from 'viem';
import type { NetworkId } from '../src/types.js';
import { networks } from './networks.js';
import { createMorphoQuery } from './morpho-api.js';
import { fetchMorphoDiscovery, parseMorphoToken, type MorphoDiscovery, type MorphoVaultRef } from './morpho-discovery.js';
import { toMorphoFailure } from './morpho-errors.js';
type Role = 'creator' | 'curator' | 'owner';
type Obj = Record<string, unknown>;
const definitions: { version: 1 | 2; role: Role; field: string; filter: string }[] = [
  { version: 1, role: 'creator', field: 'vaults', filter: 'creatorAddress_in' },
  { version: 1, role: 'curator', field: 'vaults', filter: 'curatorAddress_in' },
  { version: 1, role: 'owner', field: 'vaults', filter: 'ownerAddress_in' },
  { version: 2, role: 'curator', field: 'vaultV2s', filter: 'curatorAddress_in' },
  { version: 2, role: 'owner', field: 'vaultV2s', filter: 'ownerAddress_in' },
];
function object(value: unknown): Obj { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid vault metadata'); return value as Obj; }
function address(value: unknown): Address { if (typeof value !== 'string' || !isAddress(value, { strict: false }) || /^0x0{40}$/i.test(value)) throw new Error('Invalid vault address'); return getAddress(value.toLowerCase()); }
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function matches(value: unknown, wallet: Address) { return typeof value === 'string' && isAddress(value, { strict: false }) && same(value, wallet); }
export function associatedVaultQuery(version: 1 | 2, role: Role): string {
  const def = definitions.find(d => d.version === version && d.role === role);
  if (!def) throw new Error('Unsupported role query');
  const roles = version === 1 ? 'creatorAddress state { curator owner }' : 'curator { address } owner { address }';
  return `query AssociatedVaultsV${version}${role}($wallet: String!, $first: Int!, $skip: Int!) {
 ${def.field}(first: $first, skip: $skip, where: {chainId_in: [1], ${def.filter}: [$wallet]}) {
  items { address name chain { id } factory { address } asset { address symbol decimals price { usd timestamp } } ${roles} }
  pageInfo { count countTotal skip limit }
 }
}`;
}
function parseVault(value: unknown, wallet: Address, chainId: number, version: 1 | 2, requested: Role): MorphoVaultRef {
  const v = object(value);
  if (object(v.chain).id !== chainId || typeof v.name !== 'string' || v.name.length > 256) throw new Error('Wrong chain or vault');
  const roles: Role[] = [];
  if (version === 1) {
    if (matches(v.creatorAddress, wallet)) roles.push('creator');
    const state = v.state && typeof v.state === 'object' ? object(v.state) : {};
    if (matches(state.curator, wallet)) roles.push('curator');
    if (matches(state.owner, wallet)) roles.push('owner');
  } else {
    if (v.curator && matches(object(v.curator).address, wallet)) roles.push('curator');
    if (v.owner && matches(object(v.owner).address, wallet)) roles.push('owner');
  }
  if (!roles.includes(requested)) throw new Error('Vault does not match requested role');
  return { address: address(v.address), name: v.name, version, factory: address(object(v.factory).address), asset: parseMorphoToken(v.asset), roles };
}
export async function fetchMorphoAssociatedVaults(wallet: Address, fetcher: typeof fetch = fetch, network: NetworkId = 'ethereum') {
  if (network === 'plasma') throw new Error('Morpho API does not support Plasma.');
  const warnings = new Set<string>(), query = createMorphoQuery(fetcher, network, warnings), chainId = networks[network].id;
  const results = await Promise.allSettled(definitions.map(async definition => {
    const found: MorphoVaultRef[] = []; const seen = new Set<string>(); let skip = 0, previousTotal: number | undefined;
    for (let page = 0; page < 20; page++) {
      try {
        const data = await query(associatedVaultQuery(definition.version, definition.role), { wallet, first: 100, skip });
        const connection = object(data[definition.field]), info = object(connection.pageInfo);
        if (!Array.isArray(connection.items) || ![info.count, info.countTotal, info.skip, info.limit].every(n => Number.isSafeInteger(n) && Number(n) >= 0) || info.count !== connection.items.length || info.skip !== skip || Number(info.countTotal) < skip + connection.items.length) throw new Error('Incomplete vault pagination');
        if (previousTotal !== undefined && previousTotal !== info.countTotal) warnings.add('Morpho role lookup changed during pagination. Refresh to recheck coverage.');
        previousTotal = Number(info.countTotal);
        for (const row of connection.items) {
          try { const parsed = parseVault(row, wallet, chainId, definition.version, definition.role); const key = parsed.address.toLowerCase(); if (seen.has(key)) warnings.add('Morpho returned duplicate associated vault rows. Coverage is incomplete.'); else { seen.add(key); found.push(parsed); } }
          catch { warnings.add('Some associated Morpho vault records did not match the wallet, chain or role and were excluded.'); }
        }
        skip += connection.items.length;
        if (skip >= Number(info.countTotal)) return found;
        if (!connection.items.length) throw new Error('Vault lookup made no progress');
      } catch (error) {
        if (found.length) { warnings.add(`Morpho V${definition.version} ${definition.role} lookup was incomplete. Earlier vaults are retained.`); return found; }
        throw error;
      }
    }
    warnings.add(`Morpho V${definition.version} ${definition.role} lookup reached its page limit. Coverage is incomplete.`); return found;
  }));
  results.forEach((result, i) => { if (result.status === 'rejected') warnings.add(`Morpho V${definitions[i].version} ${definitions[i].role} vault discovery is unavailable. Those associated vaults have not been checked.`); });
  return { vaults: results.flatMap(r => r.status === 'fulfilled' ? r.value : []), warnings: [...warnings], successfulFamilies: results.filter(r => r.status === 'fulfilled').length, failures: results.flatMap((r, i) => r.status === 'rejected' ? [toMorphoFailure(`vault V${definitions[i].version} ${definitions[i].role}`, r.reason)] : []) };
}
export async function fetchMorphoPortfolioDiscovery(wallet: Address, fetcher: typeof fetch = fetch, network: NetworkId = 'ethereum'): Promise<MorphoDiscovery> {
  const [holdings, associated] = await Promise.all([fetchMorphoDiscovery(wallet, fetcher, network), fetchMorphoAssociatedVaults(wallet, fetcher, network)]);
  const warnings = new Set([...holdings.warnings, ...associated.warnings]);
  const vaults = new Map<string, MorphoVaultRef>();
  for (const v of [...holdings.vaults, ...associated.vaults]) {
    const key = v.address.toLowerCase(), existing = vaults.get(key);
    if (existing) {
      if (v.version !== existing.version || !same(v.factory, existing.factory) || !same(v.asset.address, existing.asset.address) || v.asset.decimals !== existing.asset.decimals) { warnings.add('Conflicting Morpho vault identities were excluded from role matching.'); continue; }
      existing.roles = [...new Set([...(existing.roles ?? []), ...(v.roles ?? [])])];
    } else vaults.set(key, { ...v, roles: v.roles ? [...v.roles] : undefined });
  }
  return { holdingsComplete: holdings.successfulFamilies === 3 && holdings.warnings.length === 0, markets: holdings.markets, vaults: [...vaults.values()], warnings: [...warnings], successfulFamilies: holdings.successfulFamilies + associated.successfulFamilies, failures: [...(holdings.failures ?? []), ...associated.failures] };
}
