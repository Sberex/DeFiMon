import { expect, it } from 'vitest';
import {
  discoveryModeResult,
  expandDiscoveryModes,
  groupedDiscoveryMarkets,
} from '../src/market-discovery';
import { leveragedMarkets } from '../src/leveraged-strategies';
import { strategyMarket } from './fixtures/strategies';
const base = () =>
  strategyMarket({
    protocol: 'Aave v3',
    collateralLtv: 0.7,
    lltv: 0.75,
    borrowingModes: [
      { id: 0, label: 'Standard collateral', ltv: 0.7, lltv: 0.75 },
      { id: 23, label: 'Stablecoins', ltv: 0.901, lltv: 0.921 },
      { id: 2, label: 'Correlated stablecoins', ltv: 0.9, lltv: 0.92 },
    ],
  });
it('lists each verified standard/eMode borrowing configuration separately with its own limits and shared liquidity', () => {
  const input = base();
  const rows = expandDiscoveryModes([input]);
  expect(rows.map((m) => m.borrowingMode?.id)).toEqual([0, 2, 23]);
  expect(rows.map((m) => [m.collateralLtv, m.lltv])).toEqual([
    [0.7, 0.75],
    [0.9, 0.92],
    [0.901, 0.921],
  ]);
  expect(new Set(rows.map((m) => m.route)).size).toBe(3);
  expect(new Set(rows.map((m) => m.market)).size).toBe(1);
  expect(
    rows.every(
      (m) =>
        m.liquidity?.amount === input.liquidity?.amount &&
        m.borrowApr === input.borrowApr &&
        m.totalSupplyApr === input.totalSupplyApr,
    ),
  ).toBe(true);
  expect(rows[1].note).toContain('Requires eMode 2');
  expect(input.borrowingMode).toBeUndefined();
  expect(expandDiscoveryModes(rows)).toEqual(rows);
});
it('retains only verified positive-entry modes; leaves non-Aave and deposit markets independent', () => {
  const m = base();
  m.borrowingModes = m.borrowingModes!.slice(1);
  m.collateralLtv = 0;
  m.lltv = 0;
  const rows = expandDiscoveryModes([m]);
  expect(rows).toHaveLength(2);
  expect(rows.every((m) => m.borrowingMode!.id > 0)).toBe(true);
  expect(leveragedMarkets(rows)).toHaveLength(2);
  expect(leveragedMarkets(rows).map((m) => m.modelledMode.id)).toEqual([2, 23]);
  expect(expandDiscoveryModes([{ ...m, borrowingModes: [] }])).toEqual([]);
  for (const patch of [
    { protocol: 'Morpho' },
    { borrowAsset: null },
    { borrowingModes: undefined },
  ])
    expect(expandDiscoveryModes([{ ...m, ...patch }])).toHaveLength(1);
  const malformed = base();
  malformed.borrowingModes!.push(
    { id: 4, label: 'Invalid', ltv: 0.99, lltv: 0.9 },
    malformed.borrowingModes![0],
  );
  expect(expandDiscoveryModes([malformed])).toHaveLength(3);
});
it('expands API data without changing cached inputs or chain/liquidity grouping', () => {
  const m = base(),
    file = {
      query: { supply: null, borrow: null },
      checkedAt: '2026-11-27T00:00:00Z',
      markets: [m],
      coverage: [],
      messages: [],
    };
  expect(discoveryModeResult(file).markets).toHaveLength(3);
  expect(file.markets).toHaveLength(1);
  const larger = { ...m, market: 'larger', liquidityUsd: 100000 };
  const grouped = groupedDiscoveryMarkets([m, larger]);
  expect(grouped).toHaveLength(1);
  expect(grouped[0].markets).toHaveLength(6);
  expect(grouped[0].markets[0].market).toBe('larger');
});
