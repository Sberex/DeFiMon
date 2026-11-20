import { expect, it, vi } from 'vitest';
import { createTokenDiscovery } from '../server/token-discovery';
import { correspondingTokens } from '../server/market-tokens';
const A = '0x1111111111111111111111111111111111111111', B = '0x2222222222222222222222222222222222222222', C = '0x3333333333333333333333333333333333333333', D = '0x4444444444444444444444444444444444444444';
const platforms = [{ id: 'ethereum', chain_identifier: 1 }, { id: 'arbitrum-one', chain_identifier: 42161 }, { id: 'plasma', chain_identifier: 9745 }, { id: 'other-network', chain_identifier: 10 }];
const target = { id: 'source', network: 'ethereum' as const, supplied: A };
const cg = (contracts = { ethereum: A, 'arbitrum-one': B, plasma: C }) => ({ id: 'new-token', symbol: 'SAME', platforms: contracts });
const cmc = (arb = B) => ({ data: { '42': { id: 42, slug: 'new-token', platform: { name: 'Ethereum', token_address: A }, contract_address: [{ contract_address: arb, platform: { name: 'Arbitrum', coin: { slug: 'arbitrum' } } }, { contract_address: C, platform: { name: 'Plasma', coin: { slug: 'plasma' } } }] } }, status: { error_code: 0 } });
function mock(handler: (url: string, options: RequestInit) => unknown | Response) {
  return vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    const result = String(url).includes('/asset_platforms') ? platforms : handler(String(url), options ?? {});
    return result instanceof Response ? result : new Response(JSON.stringify(result));
  }) as unknown as typeof fetch;
}
it('manual groups override discovery, including deliberately missing destination networks', async () => {
  const fetcher = vi.fn();
  const result = await createTokenDiscovery({ fetcher, manual: { MANUAL: { ethereum: A } }, env: {} }).resolve([target]);
  expect(fetcher).not.toHaveBeenCalled(); expect(result.reports[0].status).toBe('manual');
  expect(correspondingTokens(A, 'ethereum', 'arbitrum', result.matches)).toEqual([]);
});
it('discovers CoinGecko platform contracts using source chain/address, without guessing symbols', async () => {
  const fetcher = mock(url => { expect(url).toContain(`/ethereum/contract/${A}`); return cg(); });
  const result = await createTokenDiscovery({ fetcher, manual: {}, env: {} }).resolve([target]);
  expect(result.reports[0]).toMatchObject({ status: 'found', matches: { ethereum: A, arbitrum: B, plasma: C }, sources: [{ provider: 'CoinGecko', assetId: 'new-token' }] });
  expect(correspondingTokens(A, 'ethereum', 'plasma', result.matches)).toEqual([C]);
  expect(JSON.stringify(result)).not.toContain('other-network');
});
it('uses CoinMarketCap authenticated contract metadata when CoinGecko is unavailable', async () => {
  const secret = 'dummy-cmc-secret';
  const fetcher = mock((url, options) => {
    if (url.includes('coingecko.com')) return new Response('{}', { status: 503 });
    expect(url).toBe(`https://pro-api.coinmarketcap.com/v2/cryptocurrency/info?address=${A}`);
    expect(options.headers).toMatchObject({ 'X-CMC_PRO_API_KEY': secret }); return cmc();
  });
  const result = await createTokenDiscovery({ fetcher, manual: {}, env: { COINMARKETCAP_API_KEY: secret } }).resolve([target]);
  expect(result.reports[0].sources[0].provider).toBe('CoinMarketCap');
  expect(correspondingTokens(A, 'ethereum', 'arbitrum', result.matches)).toEqual([B]);
  expect(JSON.stringify(result)).not.toContain(secret);
});
it('requires an exact source contract even if the provider returns a matching ticker', async () => {
  const result = await createTokenDiscovery({ fetcher: mock(() => cg({ ethereum: D, 'arbitrum-one': B, plasma: C })), manual: {}, env: {} }).resolve([target]);
  expect(result.reports[0].status).toBe('conflict');
  expect(correspondingTokens(A, 'ethereum', 'arbitrum', result.matches)).toEqual([]);
});
it('rejects disagreements between CoinGecko and CoinMarketCap rather than choosing a destination', async () => {
  const fetcher = mock(url => url.includes('coingecko.com') ? cg() : cmc(D));
  const result = await createTokenDiscovery({ fetcher, manual: {}, env: { COINMARKETCAP_API_KEY: 'secret' } }).resolve([target]);
  expect(result.reports[0].status).toBe('conflict'); expect(result.reports[0].matches).toEqual({ ethereum: A });
  expect(result.reports[0].sources).toHaveLength(2);
});
it('rejects multiple CMC identities for the same source chain/address', async () => {
  const body = cmc(); (body.data as any)['99'] = { ...body.data['42'], id: 99 };
  const result = await createTokenDiscovery({ fetcher: mock(url => url.includes('coingecko.com') ? new Response('{}', { status: 404 }) : body), manual: {}, env: { COINMARKETCAP_API_KEY: 'secret' } }).resolve([target]);
  expect(result.reports[0].status).toBe('conflict'); expect(result.reports[0].sources).toHaveLength(0);
});
it('does not confuse identical contract strings on unrelated source networks in CMC metadata', async () => {
  const body = cmc(); (body.data as any)['99'] = { id: 99, slug: 'other-asset', contract_address: [{ contract_address: A, platform: { name: 'Plasma' } }] };
  const result = await createTokenDiscovery({ fetcher: mock(url => url.includes('coingecko.com') ? new Response('{}', { status: 404 }) : body), manual: {}, env: { COINMARKETCAP_API_KEY: 'secret' } }).resolve([target]);
  expect(result.reports[0].status).toBe('found'); expect(result.reports[0].sources[0].assetId).toBe('42');
});
it('deduplicates concurrent lookups, caches results, and does not let callers mutate cached groups', async () => {
  let time = 1000;
  const fetcher = mock(() => cg());
  const discovery = createTokenDiscovery({ fetcher, manual: {}, env: {}, now: () => time });
  const [one, two] = await Promise.all([discovery.resolve([target]), discovery.resolve([target])]);
  expect((fetcher as any).mock.calls).toHaveLength(2);
  one.reports[0].matches.arbitrum = D;
  expect(two.reports[0].matches.arbitrum).toBe(B);
  expect((await discovery.resolve([target])).reports[0].matches.arbitrum).toBe(B);
  expect((fetcher as any).mock.calls).toHaveLength(2);
  time += 3600_001; await discovery.resolve([target]); expect((fetcher as any).mock.calls).toHaveLength(3);
});
it('excludes automatic links into manual groups until the user confirms the source contract', async () => {
  const result = await createTokenDiscovery({ fetcher: mock(() => cg()), manual: { EXISTING: { arbitrum: B } }, env: {} }).resolve([target]);
  expect(result.reports[0].status).toBe('conflict');
  expect(correspondingTokens(A, 'ethereum', 'arbitrum', result.matches)).toEqual([]);
});
it('reconciles contradictory records discovered from different source networks', async () => {
  const fetcher = mock(url => url.includes('/arbitrum-one/') ? cg({ ethereum: A, 'arbitrum-one': B, plasma: D }) : cg());
  const result = await createTokenDiscovery({ fetcher, manual: {}, env: {} }).resolve([target, { ...target, id: 'other-source', network: 'arbitrum', supplied: B }]);
  expect(result.reports.every(r => r.status === 'conflict')).toBe(true);
  expect(correspondingTokens(A, 'ethereum', 'plasma', result.matches)).toEqual([]);
});
it('keeps original-network search available when providers fail and never exposes raw errors or credentials', async () => {
  const fetcher = vi.fn(async () => { throw new Error('https://provider/dummy-private-key'); }) as unknown as typeof fetch;
  const result = await createTokenDiscovery({ fetcher, manual: {}, env: { COINMARKETCAP_API_KEY: 'dummy-private-key' } }).resolve([target]);
  expect(result.reports[0].status).toBe('unavailable');
  expect(correspondingTokens(A, 'ethereum', 'ethereum', result.matches)).toEqual([A]);
  expect(correspondingTokens(A, 'ethereum', 'plasma', result.matches)).toEqual([]);
  expect(JSON.stringify(result)).not.toContain('dummy-private-key');
});
it('bounds automatic discovery work to twenty unique unlisted tokens per request', async () => {
  const fetcher = mock(url => { const token = url.match(/\/contract\/(0x[0-9a-f]+)/)?.[1]; return { id: `token-${token}`, platforms: { ethereum: token } }; });
  const targets = Array.from({ length: 23 }, (_, i) => ({ ...target, id: String(i), supplied: `0x${(i + 1).toString(16).padStart(40, '0')}` }));
  const result = await createTokenDiscovery({ fetcher, manual: {}, env: {} }).resolve(targets);
  expect(result.reports.filter(r => r.status === 'found')).toHaveLength(20);
  expect(result.reports.filter(r => r.warnings.some(w => w.includes('per-request limit')))).toHaveLength(3);
});
it('uses verified automatic groups in the protocol searches on all supported networks', async () => {
  const { searchMarkets } = await import('../server/market-search');
  const discovery = createTokenDiscovery({ fetcher: mock(() => cg()), manual: {}, env: {} });
  const seen: string[] = [];
  const sources = Object.fromEntries(['aave-v3', 'aave-v4', 'compound', 'fluid', 'morpho', 'euler', 'spark'].map(id => [id, { name: id, read: async (_client: unknown, network: string, _block: bigint, targets: any[]) => {
    seen.push(network); expect(targets[0].supplies).toEqual([network === 'ethereum' ? A : network === 'arbitrum' ? B : C]); return [];
  } }]));
  const clientFor = (network: string) => ({ getChainId: async () => network === 'ethereum' ? 1 : network === 'arbitrum' ? 42161 : 9745, getBlockNumber: async () => 100n }) as any;
  const result = await searchMarkets([target], clientFor, sources, discovery.resolve);
  expect(seen).toHaveLength(16); expect(result.tokenDiscovery?.[0].status).toBe('found');
});
it('rejects a provider asset ID that claims different token contracts on the same network', async () => {
  const fetcher = mock(url => ({ id: 'same-coin-id', platforms: { ethereum: url.includes(A) ? A : B } }));
  const result = await createTokenDiscovery({ fetcher, manual: {}, env: {} }).resolve([target, { ...target, id: 'other', supplied: B }]);
  expect(result.reports.every(r => r.status === 'conflict')).toBe(true);
});
it('handles rate limits without repeatedly calling the failed platform registry or exposing an error body', async () => {
  const fetcher = vi.fn(async () => new Response('dummy-secret-error-body', { status: 429, headers: { 'Retry-After': '60' } })) as unknown as typeof fetch;
  const discovery = createTokenDiscovery({ fetcher, manual: {}, env: {} });
  const result = await discovery.resolve([target, { ...target, id: 'other', supplied: B }]);
  await discovery.resolve([{ ...target, id: 'third', supplied: C }]);
  expect((fetcher as any).mock.calls).toHaveLength(1);
  expect(result.reports.every(r => r.status === 'unavailable')).toBe(true);
  expect(JSON.stringify(result)).not.toContain('dummy-secret-error-body');
});
it('never overwrites a manual group whose label happens to use the automatic-group prefix', async () => {
  const result = await createTokenDiscovery({ fetcher: mock(() => cg()), manual: { 'automatic-0': { ethereum: D } }, env: {} }).resolve([target]);
  expect(result.matches['automatic-0']).toEqual({ ethereum: D });
  expect(correspondingTokens(A, 'ethereum', 'arbitrum', result.matches)).toEqual([B]);
});

it('discovers Base contracts from both verified CoinGecko and CoinMarketCap records', async () => {
  for (const provider of ['cg', 'cmc']) {
    const fetcher = (async (url: string | URL | Request) => {
      if (String(url).includes('/asset_platforms')) return new Response(JSON.stringify([...platforms, { id: 'base', chain_identifier: 8453 }]));
      if (provider === 'cg') return new Response(JSON.stringify({ id: 'new-token', platforms: { ethereum: A, base: D } }));
      if (String(url).includes('coingecko.com')) return new Response('{}', { status: 503 });
      const body = cmc(); body.data['42'].contract_address.push({ contract_address: D, platform: { name: 'Base', coin: { slug: 'base' } } });
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
    const result = await createTokenDiscovery({ fetcher, manual: {}, env: { COINMARKETCAP_API_KEY: 'fixture-key' } }).resolve([target]);
    expect(correspondingTokens(A, 'ethereum', 'base', result.matches)).toEqual([D]);
  }
});

it('discovers BSC contracts from chain ID 56 and CoinMarketCap BNB Smart Chain names', async () => {
  for (const provider of ['cg', 'cmc']) {
    const fetcher = (async (url: string | URL | Request) => {
      if (String(url).includes('/asset_platforms')) return new Response(JSON.stringify([...platforms, { id: 'binance-smart-chain', chain_identifier: 56 }]));
      if (provider === 'cg') return new Response(JSON.stringify({ id: 'new-token', platforms: { ethereum: A, 'binance-smart-chain': D } }));
      if (String(url).includes('coingecko.com')) return new Response('{}', { status: 503 });
      const body = cmc(); body.data['42'].contract_address.push({ contract_address: D, platform: { name: 'BNB Smart Chain (BEP20)', coin: { slug: 'bnb' } } });
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
    const result = await createTokenDiscovery({ fetcher, manual: {}, env: { COINMARKETCAP_API_KEY: 'fixture-key' } }).resolve([target]);
    expect(correspondingTokens(A, 'ethereum', 'bsc', result.matches)).toEqual([D]);
  }
});
