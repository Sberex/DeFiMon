import { expect, it, vi } from 'vitest';
vi.mock('../server/aave-discovery-modes', () => ({ aaveDiscoveryModes: async (markets: unknown[]) => ({ markets, coverage: [], messages: [] }) }));
vi.mock('../server/market-merkl', () => ({ applyMarketMerkl: async (markets: unknown[]) => ({ markets, coverage: [], messages: [] }) }));
import {
  discoveryChoices,
  groupedDiscoveryMarkets,
  type DiscoveryMarket,
} from '../src/market-discovery';
import {
  createMarketDiscovery,
  discoveryTargets,
  parseDiscoveryQuery,
} from '../server/market-discovery';
import {
  marketPair,
  option,
  type Reader,
  matchesSupply,
  matchesBorrow,
} from '../server/market-readers';
import { configuredTokenRegistry } from '../server/token-registry';
import { networks } from '../server/networks';
import type { ChainClient } from '../server/rpc';
const usdc = configuredTokenRegistry.USDC.addresses.ethereum!,
  susdai = configuredTokenRegistry.sUSDai.addresses.ethereum!,
  other = '0x1111111111111111111111111111111111111111';
it('validates explicit config groups and wildcards without accepting addresses or arbitrary reader flags', () => {
  expect(parseDiscoveryQuery({ supply: null, borrow: null })).toEqual({
    supply: null,
    borrow: null,
  });
  for (const q of [
    {},
    { supply: null },
    { supply: 'missing', borrow: null },
    { supply: usdc, borrow: null },
    { supply: null, borrow: null, anySupply: true },
    [],
    null,
  ])
    expect(() => parseDiscoveryQuery(q)).toThrow();
});
it('builds borrowing plus deposit searches for Any borrow and only borrowing for a specific loan token', () => {
  const t = discoveryTargets({ supply: 'sUSDai', borrow: null }, 'ethereum');
  expect(t).toHaveLength(2);
  expect(t[0]).toMatchObject({
    supplies: [susdai],
    anySupply: false,
    anyBorrow: true,
    borrowed: '*',
  });
  expect(t[1].borrowed).toBeUndefined();
  const b = discoveryTargets({ supply: null, borrow: 'USDC' }, 'ethereum');
  expect(b).toHaveLength(1);
  expect(b[0]).toMatchObject({
    anySupply: true,
    anyBorrow: false,
    borrows: [usdc],
  });
  expect(matchesSupply(b[0], other)).toBe(true);
  expect(matchesBorrow(b[0], other)).toBe(false);
  const baseScrv = discoveryTargets({ supply: 'scrvUSD', borrow: null }, 'base');
  expect(baseScrv).toHaveLength(2);
  expect(baseScrv[0].supplied).toBe('0x646a737b9b6024e49f5908762b3ff73e65b5160c');
  expect(discoveryTargets({ supply: 'scrvUSD', borrow: null }, 'arc')).toEqual([]);
});
it('offers case-insensitive prefix search from the actual config including savings assets', () => {
  expect(discoveryChoices('sUsDa')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'sUSDai', category: 'Savings stablecoin' }),
    ]),
  );
  expect(discoveryChoices('not-a-real-token')).toEqual([]);
});
function fixture(
  reader?: Reader,
  overrides: Parameters<typeof createMarketDiscovery>[0] = {},
) {
  const queries: any[] = [];
  const read: Reader =
    reader ??
    (async (_c, n, b, targets) => {
      queries.push({ n, targets });
      const t = targets.find((t) => t.borrowed)!;
      const s = t.supplies[0] ?? other,
        loan = t.borrows[0] ?? other;
      return [
        {
          ...option(
            marketPair(t, s, loan),
            'Morpho',
            n,
            b,
            other,
            'Test market',
            0.01,
            0.04,
            0.86,
          ),
          liquidity: {
            amount: 100,
            token: loan,
            symbol: 'UNIT',
            rawAmount: '100000000',
            decimals: 6,
            note: 'Verified native cash',
          },
        },
      ];
    });
  const service = createMarketDiscovery({
    sources: { morpho: { name: 'Morpho', read } },
    clientFor: (n) =>
      ({
        getChainId: async () => networks[n].id,
        getBlockNumber: async () => 456n,
        readContract: async ({ functionName }: any) =>
          functionName === 'decimals' ? 6 : 'UNIT',
      }) as unknown as ChainClient,
    prices: async () =>
      new Map([
        [other, 2],
        [usdc, 1],
      ]),
    intrinsic: async () => ({
      apr: 0.08,
      estimated: true,
      note: 'Verified',
      source: { chain: 'Ethereum', oracle: other },
    }),
    pt: async (p) => p,
    ...overrides,
  });
  return { service, queries };
}
it('keeps actual wildcard token identities, native liquidity and configured type, adding intrinsic yield once', async () => {
  const { service, queries } = fixture();
  const r = await service({ supply: 'sUSDai', borrow: 'USDC' });
  expect(queries.some((q) => q.n === 'ethereum')).toBe(true);
  const m = r.markets.find((m) => m.network === 'ethereum')!;
  expect(m).toMatchObject({
    supplyAsset: { address: susdai, category: 'Savings stablecoin' },
    borrowAsset: { address: usdc, category: 'Stablecoin' },
    totalSupplyApr: 0.09,
    liquidityUsd: 100,
  });
});
it('accepts unconfigured native assets on wildcard sides and rejects mismatched or missing contracts', async () => {
  const good = await fixture().service({ supply: null, borrow: 'USDC' });
  expect(
    good.markets.find((m) => m.network === 'ethereum')?.supplyAsset.address,
  ).toBe(other);
  const bad = await fixture(async (_c, n, b, t) => [
    option(
      marketPair(t[0], other, other),
      'Morpho',
      n,
      b,
      other,
      'Wrong',
      0,
      0.1,
      0.8,
    ),
  ]).service({ supply: 'sUSDai', borrow: 'USDC' });
  expect(bad.markets).toEqual([]);
  expect(bad.coverage.some((c) => c.status === 'partial')).toBe(true);
});
it('retains known markets when another chain fails, hides provider details and marks source errors', async () => {
  const f = fixture(async (c, n, b, t, w) => {
    if (n === 'ethereum') throw Error('secret-provider-key');
    return [
      option(
        marketPair(t[0], t[0].supplies[0], t[0].borrows[0]),
        'Morpho',
        n,
        b,
        other,
        'Other chain',
        0,
        0.1,
        0.8,
      ),
    ];
  });
  const r = await f.service({ supply: 'sUSDai', borrow: 'USDC' });
  expect(r.markets.some((m) => m.network === 'arbitrum')).toBe(true);
  expect(r.coverage).toContainEqual(
    expect.objectContaining({ network: 'ethereum', status: 'error' }),
  );
  expect(JSON.stringify(r)).not.toContain('secret-provider-key');
});
it('groups chains in dashboard order and sorts by USD liquidity instead of comparing incompatible token units', () => {
  const m = (
    network: string,
    amount: number,
    usd: number | null,
    name: string,
    token: string = other,
  ) =>
    ({
      network,
      market: name,
      supplyAsset: { name },
      borrowAsset: { address: token },
      liquidity: { amount },
      liquidityUsd: usd,
    }) as unknown as DiscoveryMarket;
  const groups = groupedDiscoveryMarkets([
    m('base', 2, 200, 'Base'),
    m('ethereum', 100000, 100000, 'USDC'),
    m('ethereum', 100, 300000, 'ETH'),
    m('ethereum', 5000000, null, 'Unpriced'),
    m('arbitrum', 1, 1, 'Arbitrum'),
  ]);
  expect(groups.map((g) => g.network)).toEqual([
    'ethereum',
    'arbitrum',
    'base',
  ]);
  expect(groups[0].markets.map((m) => m.market)).toEqual([
    'ETH',
    'USDC',
    'Unpriced',
  ]);
});

it('keeps missing savings yield unavailable and uses verified PT APY as the supply rate, including expired zero', async () => {
  const unavailable = await fixture(undefined, {
    intrinsic: async () => undefined,
  }).service({ supply: 'sUSDai', borrow: 'USDC' });
  expect(unavailable.markets[0].totalSupplyApr).toBeNull();
  expect(unavailable.markets[0].supplyAsset.intrinsicApr).toBeNull();
  for (const apr of [0.14, 0]) {
    const f = fixture(undefined, {
      pt: async (protocols) =>
        protocols.map((p) => ({
          ...p,
          positions: p.positions.map((position) => ({
            ...position,
            assets: position.assets.map((asset) => ({
              ...asset,
              supplyRate: {
                apr,
                note: 'Verified Pendle rate',
                pendlePt: {
                  network: 'ethereum',
                  marketAddress: null,
                  expiry: null,
                  updatedAt: null,
                },
              },
            })),
          })),
        })),
    });
    const result = await f.service({ supply: null, borrow: 'USDC' });
    expect(result.markets[0].totalSupplyApr).toBe(apr);
    expect(result.markets[0].supplyRateNote).toBe('Verified Pendle rate');
  }
});
it('exposes all required Fluid pool assets and does not accept liquidity denominated in an unrelated token', async () => {
  const r = await fixture(async (_c, n, b, t) => [
    {
      ...option(
        marketPair(t[0], t[0].supplies[0], t[0].borrows[0]),
        'Fluid',
        n,
        b,
        other,
        'Pool',
        0,
        0.04,
        0.8,
      ),
      requiredTokens: {
        supplied: [t[0].supplies[0], other],
        borrowed: [t[0].borrows[0]],
      },
      liquidity: {
        amount: 100,
        token: other,
        symbol: 'Wrong token',
        note: 'Not debt cash',
      },
    },
  ]).service({ supply: 'sUSDai', borrow: 'USDC' });
  expect(r.markets[0].requiredSupplyAssets).toHaveLength(2);
  expect(r.markets[0].liquidity).toBeNull();
  expect(r.coverage[0].status).toBe('partial');
});
