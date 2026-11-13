import { expect, it } from 'vitest';
import { fetchMorphoDiscovery, MORPHO_API, MORPHO_BLUE } from '../server/morpho-discovery';
const wallet = '0x1111111111111111111111111111111111111111';
const asset = { address: '0x2222222222222222222222222222222222222222', symbol: 'USDC', decimals: 6, price: { usd: 1, timestamp: '1794592800' } };
const user = { address: wallet, chain: { id: 1 } };
const market = (digit = 'a') => ({ user, market: { uniqueKey: `0x${digit.repeat(64)}`, morphoBlue: { address: MORPHO_BLUE, chain: { id: 1 } }, loanAsset: asset, collateralAsset: { ...asset, address: '0x3333333333333333333333333333333333333333', symbol: 'WETH', decimals: 18, price: { usd: 3000, timestamp: '1794592800' } } } });
const vault = { address: '0x4444444444444444444444444444444444444444', name: 'Test vault', chain: { id: 1 }, factory: { address: '0x5555555555555555555555555555555555555555' }, asset };
const page = (items: unknown[], total = items.length, skip = 0) => ({ items, pageInfo: { count: items.length, countTotal: total, skip, limit: 100 } });
const empty = (field: string) => field === 'userByAddress' ? { ...user, vaultV2Positions: [] } : page([]);
function fake(handler: (field: string, variables: any) => unknown | Promise<unknown>) {
  const requests: { field: string; variables: any; query: string }[] = [];
  const fetcher = (async (input, init) => {
    expect(String(input)).toBe(MORPHO_API);
    const { query, variables } = JSON.parse(String(init?.body));
    const field = query.includes('query WalletMarkets(') ? 'marketPositions' : query.includes('query WalletVaults(') ? 'vaultPositions' : 'userByAddress';
    requests.push({ field, variables, query });
    const result: any = await handler(field, variables);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fetcher, requests };
}
it('discovers Ethereum market and V1/V2 vault references without trusting API balances as current chain data', async () => {
  const { fetcher, requests } = fake(field => ({ data: { [field]: field === 'marketPositions' ? page([market()]) : field === 'vaultPositions' ? page([{ user, vault }]) : { ...user, vaultV2Positions: [{ user, vault: { ...vault, address: '0x6666666666666666666666666666666666666666' } }] } } }));
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.successfulFamilies).toBe(3); expect(result.warnings).toEqual([]);
  expect(result.markets).toHaveLength(1); expect(result.vaults.map(v => v.version)).toEqual([1, 2]);
  expect(result.markets[0].loan.priceUsd).toBe(1);
  expect(result.markets[0].collateral?.priceUsd).toBe(3000);
  expect(result.vaults.map(v => v.asset.priceUsd)).toEqual([1, 1]);
  expect(requests.every(r => r.variables.wallet === wallet)).toBe(true);
  expect(requests.every(r => r.query.includes('chainId_in: [1]') || r.query.includes('chainId: 1'))).toBe(true);
  expect(requests.every(r => !r.query.includes('borrowAssets'))).toBe(true);
});
it('reads every market page instead of silently truncating to the first page', async () => {
  const { fetcher, requests } = fake((field, v) => ({ data: { [field]: field === 'marketPositions' ? page([market(v.skip ? 'b' : 'a')], 2, v.skip) : empty(field) } }));
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.markets).toHaveLength(2);
  expect(requests.filter(r => r.field === 'marketPositions').map(r => r.variables.skip)).toEqual([0, 1]);
});
it('retains already discovered entries if a later page fails', async () => {
  const { fetcher } = fake((field, v) => field === 'marketPositions' && v.skip > 0 ? { errors: [{ message: 'private detail' }] } : { data: { [field]: field === 'marketPositions' ? page([market()], 2) : empty(field) } });
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.markets).toHaveLength(1); expect(result.warnings.join(' ')).toContain('Earlier verified entries are retained');
  expect(JSON.stringify(result)).not.toContain('private detail');
});
it('does not turn GraphQL errors or missing pagination into an empty wallet', async () => {
  const { fetcher } = fake(field => field === 'marketPositions' ? { errors: [{ message: 'private backend' }], data: { marketPositions: page([]) } } : { data: { [field]: empty(field) } });
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
    const { fetcher } = fake(field => ({ data: { [field]: field === 'marketPositions' ? page([bad]) : empty(field) } }));
    const result = await fetchMorphoDiscovery(wallet, fetcher);
    expect(result.markets).toHaveLength(0); expect(result.warnings.join(' ')).toContain('could not be verified');
  }
});
it('counts duplicate markets once and explicitly flags possible discovery inconsistency', async () => {
  const { fetcher } = fake(field => ({ data: { [field]: field === 'marketPositions' ? page([market(), market()]) : empty(field) } }));
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.markets).toHaveLength(1); expect(result.warnings.join(' ')).toContain('duplicate');
});
it('does not assume a missing/invalid dollar price is a stablecoin peg', async () => {
  const row = market(); row.market.loanAsset = { ...asset, price: null as any };
  const { fetcher } = fake(field => ({ data: { [field]: field === 'marketPositions' ? page([row]) : empty(field) } }));
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.markets[0].loan.priceUsd).toBeNull();
});
it('returns an empty lookup only when all three families succeed', async () => {
  const { fetcher } = fake(field => ({ data: { [field]: empty(field) } }));
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
    const field = query.includes('query WalletMarkets(') ? 'marketPositions' : query.includes('query WalletVaults(') ? 'vaultPositions' : 'userByAddress';
    return new Response(JSON.stringify({ data: { [field]: field === 'marketPositions' ? page([market()]) : field === 'userByAddress' ? { ...user, vaultV2Positions: [] } : empty(field) } }));
  }) as typeof fetch;
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.markets).toHaveLength(1); expect(result.warnings).toEqual([]);
  expect(seen.filter(q => q.includes('query WalletMarkets('))).toHaveLength(2);
});

it('handles old-schema validation returned as HTTP 400 before treating it as a network failure', async () => {
  const fetcher = (async (_url, init) => {
    const { query } = JSON.parse(String(init?.body));
    if (query.includes('uniqueKey: marketId')) return new Response(JSON.stringify({ errors: [{ message: 'Cannot query field "marketId" on type "Market".' }] }), { status: 400 });
    const field = query.includes('query WalletMarkets(') ? 'marketPositions' : query.includes('query WalletVaults(') ? 'vaultPositions' : 'userByAddress';
    return new Response(JSON.stringify({ data: { [field]: field === 'marketPositions' ? page([market()]) : field === 'userByAddress' ? { ...user, vaultV2Positions: [] } : empty(field) } }));
  }) as typeof fetch;
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.markets).toHaveLength(1); expect(result.failures).toEqual([]);
});
it('preserves sanitized reasons for network, HTTP, schema, and invalid-response failures', async () => {
  const cases = [
    { response: () => Promise.reject(Object.assign(new Error('https://private-provider/key'), { cause: { code: 'ENOTFOUND' } })), code: 'network' },
    { response: async () => new Response('private detail', { status: 403 }), code: 'http' },
    { response: async () => new Response(JSON.stringify({ errors: [{ message: 'Cannot query field "removedField" on type "Query".' }] }), { status: 400 }), code: 'schema' },
    { response: async () => new Response('<html>private content</html>'), code: 'response' },
  ];
  for (const c of cases) {
    const result = await fetchMorphoDiscovery(wallet, c.response as typeof fetch);
    expect(result.successfulFamilies).toBe(0);
    expect(result.failures?.every(f => f.code === c.code)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private');
  }
});

it('uses the introspected current price and user query across all families without legacy retries', async () => {
  const requests: string[] = [];
  const fetcher = (async (_url, init) => {
    const { query } = JSON.parse(String(init?.body)); requests.push(query);
    // These are the exact field rejections reported by the user's live endpoint.
    if (/\busers\(/.test(query)) return new Response(JSON.stringify({ errors: [{ message: 'Cannot query field "users" on type "Query".' }] }), { status: 400 });
    if (/\bdecimals priceUsd\s*[}]/.test(query)) return new Response(JSON.stringify({ errors: [{ message: 'Cannot query field "priceUsd" on type "Asset".' }] }), { status: 400 });
    expect(query).toContain('price { usd timestamp }');
    const field = query.includes('query WalletMarkets(') ? 'marketPositions' : query.includes('query WalletVaults(') ? 'vaultPositions' : 'userByAddress';
    return new Response(JSON.stringify({ data: { [field]: field === 'marketPositions' ? page([market()]) : field === 'vaultPositions' ? page([{ user, vault }]) : { ...user, vaultV2Positions: [{ user, vault }] } } }));
  }) as typeof fetch;
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.successfulFamilies).toBe(3); expect(result.failures).toEqual([]);
  expect(result.markets[0].loan.priceUsd).toBe(1); expect(result.vaults.map(v => v.version)).toEqual([1, 2]);
  expect(requests).toHaveLength(3);
});

it('retains references with unknown USD values when current and legacy price fields are unsupported', async () => {
  let calls = 0;
  const fetcher = (async (_url, init) => {
    calls++;
    const { query } = JSON.parse(String(init?.body));
    const unsupported = query.includes('price { usd timestamp }') ? 'price' : query.includes('priceUsd: oraclePriceUsd') ? 'oraclePriceUsd' : query.includes('decimals priceUsd') ? 'priceUsd' : null;
    if (unsupported) return new Response(JSON.stringify({ errors: [{ message: `Cannot query field "${unsupported}" on type "Asset".` }] }), { status: 400 });
    const field = query.includes('query WalletMarkets(') ? 'marketPositions' : query.includes('query WalletVaults(') ? 'vaultPositions' : 'userByAddress';
    const row = market();
    row.market.loanAsset = { ...row.market.loanAsset };
    delete (row.market.loanAsset as { price?: unknown }).price;
    delete (row.market.collateralAsset as { price?: unknown }).price;
    return new Response(JSON.stringify({ data: { [field]: field === 'marketPositions' ? page([row]) : empty(field) } }));
  }) as typeof fetch;
  const result = await fetchMorphoDiscovery(wallet, fetcher);
  expect(result.successfulFamilies).toBe(3); expect(calls).toBe(12);
  expect(result.markets).toHaveLength(1); expect(result.markets[0].loan.priceUsd).toBeNull();
  expect(result.warnings.join(' ')).toContain('dollar values are unavailable');
});

it('does not treat a null user, another wallet, or another network as verified empty V2 holdings', async () => {
  for (const value of [null, { ...user, address: asset.address, vaultV2Positions: [] }, { ...user, chain: { id: 8453 }, vaultV2Positions: [] }]) {
    const { fetcher } = fake(field => ({ data: { [field]: field === 'userByAddress' ? value : empty(field) } }));
    const result = await fetchMorphoDiscovery(wallet, fetcher);
    expect(result.successfulFamilies).toBe(2);
    expect(result.failures?.map(f => f.family)).toEqual(['vault V2']);
  }
});

it('leaves missing, malformed, zero, negative, or nonnumeric nested prices unknown without losing balances', async () => {
  for (const price of [null, {}, { usd: null }, { usd: 0 }, { usd: -1 }, { usd: '1' }, [], 1]) {
    const row = market();
    row.market.loanAsset = { ...asset, price, priceUsd: 123 } as any;
    const { fetcher } = fake(field => ({ data: { [field]: field === 'marketPositions' ? page([row]) : empty(field) } }));
    const result = await fetchMorphoDiscovery(wallet, fetcher);
    expect(result.markets).toHaveLength(1); expect(result.markets[0].loan.priceUsd).toBeNull();
  }
});

it('still supports documented older scalar USD fields after an explicit current-price rejection', async () => {
  for (const scalar of ['priceUsd', 'oraclePriceUsd']) {
    const fetcher = (async (_url, init) => {
      const { query } = JSON.parse(String(init?.body));
      const unsupported = query.includes('price { usd timestamp }') ? 'price' : scalar === 'oraclePriceUsd' && !query.includes('priceUsd: oraclePriceUsd') ? 'priceUsd' : null;
      if (unsupported) return new Response(JSON.stringify({ errors: [{ message: `Cannot query field "${unsupported}" on type "Asset".` }] }), { status: 400 });
      const field = query.includes('query WalletMarkets(') ? 'marketPositions' : query.includes('query WalletVaults(') ? 'vaultPositions' : 'userByAddress';
      const row = market();
      row.market.loanAsset = { ...asset, priceUsd: 0.98 } as any;
      delete (row.market.loanAsset as { price?: unknown }).price;
      return new Response(JSON.stringify({ data: { [field]: field === 'marketPositions' ? page([row]) : empty(field) } }));
    }) as typeof fetch;
    const result = await fetchMorphoDiscovery(wallet, fetcher);
    expect(result.successfulFamilies).toBe(3); expect(result.markets[0].loan.priceUsd).toBe(0.98);
  }
});
