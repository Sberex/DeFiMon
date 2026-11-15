import { expect, it, vi } from 'vitest';
import { associatedVaultQuery, fetchMorphoAssociatedVaults, fetchMorphoPortfolioDiscovery } from '../server/morpho-associated-vaults';
const wallet = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const v1 = '0x3333333333333333333333333333333333333333', v2 = '0x4444444444444444444444444444444444444444';
const factory = '0x5555555555555555555555555555555555555555';
function vault(version = 1, chain = 1) { return { address: version === 1 ? v1 : v2, name: 'Managed zero deposit vault', chain: { id: chain }, factory: { address: factory }, asset: { address: other, symbol: 'USDC', decimals: 6, price: { usd: 1, timestamp: '1794592800' } }, ...(version === 1 ? { creatorAddress: wallet, state: { curator: wallet, owner: wallet } } : { curator: { address: wallet }, owner: { address: wallet } }) }; }
const page = (items: unknown[] = [], countTotal = items.length, skip = 0) => ({ items, pageInfo: { count: items.length, countTotal, skip, limit: 100 } });
function fetcher(handler: (version: number, role: string, skip: number, query: string) => unknown | Promise<unknown>) {
  return (async (_url: unknown, options: RequestInit) => {
    const { query, variables } = JSON.parse(String(options.body));
    const match = query.match(/AssociatedVaultsV([12])(creator|curator|owner)/);
    if (!match) {
      if (query.includes('WalletMarkets')) return new Response(JSON.stringify({ data: { marketPositions: page() } }));
      if (query.includes('WalletVaults(')) return new Response(JSON.stringify({ data: { vaultPositions: page([{ user: { address: wallet, chain: { id: 1 } }, vault: vault() }]) } }));
      return new Response(JSON.stringify({ data: { userByAddress: { address: wallet, chain: { id: 1 }, vaultV2Positions: [] } } }));
    }
    expect(variables.wallet).toBe(wallet); expect(variables.first).toBe(100);
    const result = await handler(Number(match[1]), match[2], variables.skip, query);
    return new Response(JSON.stringify(result));
  }) as typeof fetch;
}
it('uses verified role filters, both versions and no deposit/TVL/listed minimum, preserving zero-deposit records', async () => {
  const requests: string[] = [];
  const result = await fetchMorphoAssociatedVaults(wallet, fetcher((version, _role, _skip, query) => { requests.push(query); return { data: { [version === 1 ? 'vaults' : 'vaultV2s']: page([vault(version)]) } }; }));
  expect(result.successfulFamilies).toBe(5); expect(result.warnings).toEqual([]);
  expect(result.vaults).toHaveLength(5);
  expect(requests.some(q => q.includes('creatorAddress_in'))).toBe(true);
  expect(requests.every(q => !/totalAssets.*_(gte|gt)|shares_gt|listed:/.test(q))).toBe(true);
  expect(() => associatedVaultQuery(2, 'creator')).toThrow();
});
it('merges depositor and multiple management-role records once per contract', async () => {
  const result = await fetchMorphoPortfolioDiscovery(wallet, fetcher(version => ({ data: { [version === 1 ? 'vaults' : 'vaultV2s']: page([vault(version)]) } })));
  expect(result.vaults).toHaveLength(2); expect(result.successfulFamilies).toBe(8);
  expect(result.vaults[0].roles).toEqual(['creator', 'curator', 'owner']);
  expect(result.vaults[1].roles).toEqual(['curator', 'owner']);
  expect(result.warnings).toEqual([]);
});
it('routes Arbitrum role queries to chain 42161 and rejects another wallet, chain or role', async () => {
  const result = await fetchMorphoAssociatedVaults(wallet, fetcher((version, _role, _skip, query) => {
    expect(query).toContain('chainId_in: [42161]'); expect(query).not.toContain('chainId_in: [1]');
    return { data: { [version === 1 ? 'vaults' : 'vaultV2s']: page([vault(version, 42161)]) } };
  }), 'arbitrum');
  expect(result.vaults).toHaveLength(5);
  const bad = await fetchMorphoAssociatedVaults(wallet, fetcher((version, role) => {
    const v = vault(version); if (version === 1) Object.assign(v, { creatorAddress: other, state: { curator: other, owner: other } }); else Object.assign(v, { curator: { address: other }, owner: { address: other } });
    return { data: { [version === 1 ? 'vaults' : 'vaultV2s']: page([v, { ...vault(version), chain: { id: 8453 } }]) } };
  }));
  expect(bad.vaults).toEqual([]); expect(bad.warnings.join(' ')).toContain('did not match');
});
it('paginates every role lookup, keeps earlier pages on a failure and marks duplicate rows incomplete', async () => {
  const result = await fetchMorphoAssociatedVaults(wallet, fetcher((version, role, skip) => {
    if (version === 1 && role === 'creator') {
      if (skip > 0) return { errors: [{ message: 'private-provider-secret' }] };
      return { data: { vaults: page([vault()], 2) } };
    }
    return { data: { [version === 1 ? 'vaults' : 'vaultV2s']: page([vault(version), vault(version)]) } };
  }));
  expect(result.vaults).toHaveLength(5);
  expect(result.warnings.join(' ')).toContain('Earlier vaults are retained'); expect(result.warnings.join(' ')).toContain('duplicate');
  expect(JSON.stringify(result)).not.toContain('private-provider-secret');
});
it('treats missing role pagination and GraphQL schema errors as unknown coverage, preserving other lookups', async () => {
  const result = await fetchMorphoAssociatedVaults(wallet, fetcher((version, role) => role === 'creator' ? { errors: [{ message: 'Cannot query field "creatorAddress" on type "Vault".' }] } : { data: { [version === 1 ? 'vaults' : 'vaultV2s']: { items: [], pageInfo: null } } }));
  expect(result.successfulFamilies).toBe(0); expect(result.failures).toHaveLength(5); expect(result.vaults).toEqual([]);
  expect(result.failures[0].code).toBe('schema');
});
it('does not query Plasma or invent a Morpho deployment when the service rejects that chain', async () => {
  const load = vi.fn(async () => new Response('{}'));
  await expect(fetchMorphoAssociatedVaults(wallet, load as typeof fetch, 'plasma')).rejects.toThrow('does not support Plasma');
  expect(load).not.toHaveBeenCalled();
});
