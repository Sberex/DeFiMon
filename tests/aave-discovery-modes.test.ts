import { expect, it, vi } from 'vitest';
import {
  aaveDiscoveryModes,
  AAVE_DISCOVERY_UI,
} from '../server/aave-discovery-modes';
import { leveragedMarkets } from '../src/leveraged-strategies';
import { strategyMarket } from './fixtures/strategies';
import {
  merklMarketTokens as t,
  merklMarketPool as pool,
} from './fixtures/merkl-market';
import type { ChainClient } from '../server/rpc';
function markets() {
  return [
    strategyMarket({
      protocol: 'Aave v3',
      network: 'plasma',
      market: pool,
      lltv: 0.001,
      collateralLtv: 0.0005,
      supplyAsset: {
        address: t.susde,
        name: 'sUSDe',
        category: 'Savings stablecoin',
        intrinsicApr: 0.0497,
      },
      borrowAsset: { address: t.usdt, name: 'USDT0', category: 'Stablecoin' },
      totalSupplyApr: 0.0497,
      borrowApr: 0.0358,
      protocolBorrowApr: 0.0436,
      merklBorrowApr: 0.0078,
    }),
    strategyMarket({
      protocol: 'Aave v3',
      network: 'plasma',
      market: pool,
      lltv: 0.001,
      collateralLtv: 0.0005,
      supplyAsset: {
        address: t.susde,
        name: 'sUSDe',
        category: 'Savings stablecoin',
        intrinsicApr: 0.0497,
      },
      borrowAsset: { address: t.gho, name: 'GHO', category: 'Stablecoin' },
      totalSupplyApr: 0.0497,
      borrowApr: 0.0405,
      protocolBorrowApr: 0.0469,
      merklBorrowApr: 0.0064,
    }),
  ];
}
function setup() {
  const categories = [
    {
      id: 2,
      eMode: {
        ltv: 9000,
        liquidationThreshold: 9200,
        liquidationBonus: 10400,
        collateralBitmap: 6n,
        borrowableBitmap: 16385n,
        ltvzeroBitmap: 0n,
        isolated: false,
        label: 'sUSDe Stablecoins',
      },
    },
  ];
  const readContract = vi.fn(async ({ functionName, args }: any): Promise<unknown> => {
    if (functionName === 'getEModes') return categories;
    if (functionName === 'getPool') return pool;
    if (functionName === 'getReserveData')
      return { id: args[0] === t.susde ? 2 : args[0] === t.usdt ? 0 : 14 };
    throw Error('Unexpected call');
  });
  return {
    categories,
    readContract,
    client: { readContract } as unknown as ChainClient,
  };
}
it('uses verified collateral and borrow eMode membership and models distinct Merkl-adjusted Plasma returns', async () => {
  const s = setup(),
    input = markets();
  s.categories.push({
    id: 23,
    eMode: {
      ...s.categories[0].eMode,
      ltv: 9010,
      liquidationThreshold: 9210,
      label: 'sUSDe correlated stablecoins',
    },
  });
  const result = await aaveDiscoveryModes(input, s.client, 'plasma', 123n);
  expect(result.coverage[0].status).toBe('ok');
  expect(result.markets[0].lltv).toBe(0.001); // Ordinary discovery retains the standard mode.
  expect(input[0].borrowingModes).toBeUndefined();
  const modeled = leveragedMarkets(result.markets);
  expect(modeled.map((m) => m.modelledMode.id)).toEqual([23, 23]);
  expect(modeled.map((m) => m.lltv)).toEqual([0.921, 0.921]);
  expect(modeled[0].modelledApr).toBeCloseTo(
    (0.0497 - 0.0358 * 0.901) / 0.099,
    12,
  );
  expect(modeled[1].modelledApr).toBeCloseTo(
    (0.0497 - 0.0405 * 0.901) / 0.099,
    12,
  );
  for (const m of modeled) {
    expect(m.modelledDebtRatio).toBe(0.901);
    expect(m.modelledHealthFactor).toBeGreaterThanOrEqual(1.02);
    expect(m.modelledLtvLimited).toBe(true);
  }
  const withoutRewards = leveragedMarkets(
    result.markets.map((m) => ({
      ...m,
      borrowApr: m.protocolBorrowApr!,
      merklBorrowApr: 0,
    })),
  );
  expect(modeled[0].modelledApr).toBeGreaterThan(withoutRewards[0].modelledApr);
  expect(modeled[1].modelledApr).toBeGreaterThan(withoutRewards[1].modelledApr);
  expect(s.readContract.mock.calls.every(([q]) => q.blockNumber === 123n)).toBe(
    true,
  );
  expect(
    s.readContract.mock.calls.find(([q]) => q.functionName === 'getEModes')![0]
      .address,
  ).toBe(AAVE_DISCOVERY_UI.plasma);
  expect(
    s.readContract.mock.calls.filter(
      ([q]) => q.functionName === 'getReserveData',
    ),
  ).toHaveLength(3);
});
it('excludes borrowers outside the category bitmap and collateral with zero entry LTV', async () => {
  const s = setup();
  s.categories[0].eMode.borrowableBitmap = 1n;
  const r = await aaveDiscoveryModes(markets(), s.client, 'plasma', 123n);
  expect(leveragedMarkets(r.markets).map((m) => m.modelledMode.id)).toEqual([
    2, 0,
  ]);
  s.categories[0].eMode.ltvzeroBitmap = 4n;
  expect(
    leveragedMarkets(
      (await aaveDiscoveryModes(markets(), s.client, 'plasma', 124n)).markets,
    ).map((m) => m.modelledMode.id),
  ).toEqual([0, 0]);
});
it('does not invent eMode or entry capacity when enumeration, reserve identity, or market verification fails', async () => {
  for (const failure of ['enumeration', 'reserve', 'pool'] as const) {
    const s = setup();
    const original = s.readContract.getMockImplementation()!;
    s.readContract.mockImplementation(async (q) => {
      if (
        q.functionName ===
        (failure === 'enumeration'
          ? 'getEModes'
          : failure === 'reserve'
            ? 'getReserveData'
            : 'getPool')
      ) {
        if (failure === 'pool') return t.ausdt;
        throw Error('private-provider');
      }
      return original(q);
    });
    const r = await aaveDiscoveryModes(markets(), s.client, 'plasma', 123n);
    expect(r.coverage[0].status).toBe('partial');
    expect(leveragedMarkets(r.markets).map((m) => m.modelledMode.id)).toEqual([
      0, 0,
    ]);
    expect(JSON.stringify(r)).not.toContain('private-provider');
  }
  const s = setup();
  s.readContract.mockRejectedValue(Error('offline'));
  const r = await aaveDiscoveryModes(
    markets().map((m) => ({ ...m, collateralLtv: 0 })),
    s.client,
    'plasma',
    123n,
  );
  expect(leveragedMarkets(r.markets)).toEqual([]);
});
it('rejects malformed eMode categories and never uses categories for unrelated protocols', async () => {
  const s = setup();
  s.categories[0].eMode.ltv = 9900;
  expect(
    leveragedMarkets(
      (await aaveDiscoveryModes(markets(), s.client, 'plasma', 123n)).markets,
    ).map((m) => m.modelledMode.id),
  ).toEqual([0, 0]);
  const unrelated = markets().map((m) => ({ ...m, protocol: 'Morpho' }));
  const other = setup();
  expect(
    (await aaveDiscoveryModes(unrelated, other.client, 'plasma', 1n)).markets,
  ).toEqual(unrelated);
  expect(other.readContract).not.toHaveBeenCalled();
});
