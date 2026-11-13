import { expect, it } from 'vitest';
import { fetchMorphoDiscovery, MORPHO_API, MORPHO_BLUE } from '../server/morpho-discovery';
const wallet = '0x1111111111111111111111111111111111111111';
const asset = { address: '0x2222222222222222222222222222222222222222', symbol: 'USDC', decimals: 6, priceUsd: 1 };
const user = { address: wallet, chain: { id: 1 } };
const market = (digit = 'a') => ({ user, market: { uniqueKey: `0x${digit.repeat(64)}`, morphoBlue: { address: MORPHO_BLUE, chain: { id: 1 } }, loanAsset: asset, collateralAsset: { ...asset, address: '0x3333333333333333333333333333333333333333', symbol: 'WETH', decimals: 18, priceUsd: 3000 } } });
const vault = { address: '0x4444444444444444444444444444444444444444', name: 'Test vault', chain: { id: 1 }, factory: { address: '0x5555555555555555555555555555555555555555' }, asset };
const page = (items: unknown[], total = items.length, skip = 0) => ({ items, pageInfo: { count: items.length, countTotal: total, skip, limit: 100 } });
function fake(handler: (field: string, variables: any) => unknown | Promise<unknown>) {
  const requests: { field: string; variables: any; query: string }[] = [];
  const fetcher = (async (input, init) => {
    expect(String(input)).toBe(MORPHO_API);
    const { query, variables } = JSON.parse(String(init?.body));
    const field = query.includes('query WalletMarkets(') ? 'marketPositions' : query.includes('query WalletVaults(') ? 'vaultPositions' : 'users';
    requests.push({ field, variables, query });
    return new Response(JSON.stringify(await handler(field, variables)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fetcher, requests };
}
it('discovers Ethereum market and V1/V2 vault references without trusting API balances as current chain data', async () => {
  const { fetcher, requests } = fake(field => ({ data: { [field]: field === 'marketPositions' ? page([market()]) : field === 'vaultPositions' ? page([{ user, vault }]) : page([{ ...user, vaultV2Positions: [{ user, vault: { ...vault, address: '0x6666666666666666666666666666666666666666' } }] }]) } }));
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.successfulFamilies).toBe(3); expect(result.warnings).toEqual([]);
  expect(result.markets).toHaveLength(1); expect(result.vaults.map(v => v.version)).toEqual([1, 2]);
  expect(requests.every(r => r.variables.wallet === wallet)).toBe(true);
  expect(requests.every(r => r.query.includes('chainId_in: [1]'))).toBe(true);
  expect(requests.every(r => !r.query.includes('borrowAssets'))).toBe(true);
});
it('reads every market page instead of silently truncating to the first page', async () => {
  const { fetcher, requests } = fake((field, v) => ({ data: { [field]: field === 'marketPositions' ? page([market(v.skip ? 'b' : 'a')], 2, v.skip) : page([]) } }));
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.markets).toHaveLength(2);
  expect(requests.filter(r => r.field === 'marketPositions').map(r => r.variables.skip)).toEqual([0, 1]);
});
it('retains already discovered entries if a later page fails', async () => {
  const { fetcher } = fake((field, v) => field === 'marketPositions' && v.skip > 0 ? { errors: [{ message: 'private detail' }] } : { data: { [field]: field === 'marketPositions' ? page([market()], 2) : page([]) } });
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.markets).toHaveLength(1); expect(result.warnings.join(' ')).toContain('Earlier verified entries are retained');
  expect(JSON.stringify(result)).not.toContain('private detail');
});
it('does not turn GraphQL errors or missing pagination into an empty wallet', async () => {
  const { fetcher } = fake(field => field === 'marketPositions' ? { errors: [{ message: 'private backend' }], data: { marketPositions: page([]) } } : { data: { [field]: page([]) } });
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.successfulFamilies).toBe(2); expect(result.warnings.join(' ')).toContain('market lookup is unavailable');
  expect(JSON.stringify(result)).not.toContain('private backend');
  const invalid = fake(field => ({ data: { [field]: { items: [], pageInfo: null } } }));
  expect((await fetchMorphoDiscovery(wallet, invalid.fetcher)).successfulFamilies).toBe(0);
});
it('rejects another wallet, another chain, another core deployment, and malformed market IDs', async () => {
  for (const bad of [
    { ...market(), user: { ...user, address: asset.address } },
    { ...market(), user: { ...user, chain: { id: 8453 } } },
    { ...market(), market: { ...market().market, morphoBlue: { address: asset.address, chain: { id: 1 } } } },
    { ...market(), market: { ...market().market, uniqueKey: '0x1234' } },
  ]) {
    const { fetcher } = fake(field => ({ data: { [field]: field === 'marketPositions' ? page([bad]) : page([]) } }));
    const result = await fetchMorphoDiscovery(wallet, fetcher);
    expect(result.markets).toHaveLength(0); expect(result.warnings.join(' ')).toContain('could not be verified');
  }
});
it('counts duplicate markets once and explicitly flags possible discovery inconsistency', async () => {
  const { fetcher } = fake(field => ({ data: { [field]: field === 'marketPositions' ? page([market(), market()]) : page([]) } }));
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.markets).toHaveLength(1); expect(result.warnings.join(' ')).toContain('duplicate');
});
it('does not assume a missing/invalid dollar price is a stablecoin peg', async () => {
  const row = market(); row.market.loanAsset = { ...asset, priceUsd: null as unknown as number };
  const { fetcher } = fake(field => ({ data: { [field]: field === 'marketPositions' ? page([row]) : page([]) } }));
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.markets[0].loan.priceUsd).toBeNull();
});
it('returns an empty lookup only when all three families succeed', async () => {
  const { fetcher } = fake(field => ({ data: { [field]: page([]) } }));
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.successfulFamilies).toBe(3); expect(result.markets).toEqual([]); expect(result.vaults).toEqual([]); expect(result.warnings).toEqual([]);
});
it('reports blocked or rate-limited HTTP requests without exposing response details', async () => {
  const fetcher = (async () => new Response('sensitive upstream details', { status: 429 })) as typeof fetch;
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.successfulFamilies).toBe(0); expect(result.warnings).toHaveLength(3);
  expect(JSON.stringify(result)).not.toContain('sensitive');
});

it('supports older uniqueKey schemas only after an explicit unknown-marketId schema error', async () => {
  const seen: string[] = [];
  const fetcher = (async (_url, init) => {
    const { query } = JSON.parse(String(init?.body)); seen.push(query);
    if (query.includes('uniqueKey: marketId')) return new Response(JSON.stringify({ errors: [{ message: 'Cannot query field "marketId" on type "Market".' }] }));
    const field = query.includes('query WalletMarkets(') ? 'marketPositions' : query.includes('query WalletVaults(') ? 'vaultPositions' : 'users';
    return new Response(JSON.stringify({ data: { [field]: field === 'marketPositions' ? page([market()]) : page([]) } }));
  }) as typeof fetch;
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.markets).toHaveLength(1); expect(result.warnings).toEqual([]);
  expect(seen.filter(q => q.includes('query WalletMarkets('))).toHaveLength(2);
});
