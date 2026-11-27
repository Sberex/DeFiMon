import { expect, it } from 'vitest';
import {
  groupedStrategyMarkets,
  leveragedMarkets,
  strategyBorrowChoices,
  strategySupplyChoices,
  validateStrategyQuery,
} from '../src/leveraged-strategies';
import config from '../config/token-matches.json';
import { strategyMarket } from './fixtures/strategies';
it('restricts configurable token choices and wildcard queries by category and oracle availability', () => {
  expect(strategySupplyChoices.some((t) => t.id === 'sUSDai')).toBe(true);
  expect(strategySupplyChoices.some((t) => t.id === 'USDC')).toBe(false);
  expect(strategyBorrowChoices.some((t) => t.id === 'USDC')).toBe(true);
  expect(strategyBorrowChoices.some((t) => t.id === 'sUSDai')).toBe(false);
  const missing = Object.entries(config).find(
    ([, t]) =>
      t._category === 'Savings stablecoin' && !('_intrinsicOracles' in t),
  );
  expect(missing).toBeDefined();
  expect(strategySupplyChoices.some((t) => t.id === missing![0])).toBe(false);
  expect(validateStrategyQuery({ supply: null, borrow: null })).toEqual({
    supply: null,
    borrow: null,
  });
  for (const query of [
    { supply: 'USDC', borrow: null },
    { supply: null, borrow: 'sUSDai' },
    { supply: missing![0], borrow: 'USDC' },
  ])
    expect(() => validateStrategyQuery(query)).toThrow();
});
it('models net equity APR at HF 1.02, including intrinsic and protocol yield without altering market inputs', () => {
  const market = strategyMarket();
  const row = leveragedMarkets([market])[0];
  expect(row.modelledDebtRatio).toBeCloseTo(0.86 / 1.02, 12);
  expect(row.modelledApr).toBeCloseTo(0.295, 12);
  expect(
    leveragedMarkets([
      strategyMarket({ totalSupplyApr: 0.09, supplyApr: 0.01 }),
    ])[0].modelledApr,
  ).toBeCloseTo(0.35875, 12);
  expect(market.modelledApr).toBeUndefined();
});
it('requires verified intrinsic advantage, fixed LLTV and a config-address-matched simple borrowing pair', () => {
  const m = strategyMarket();
  for (const patch of [
    { supplyAsset: { ...m.supplyAsset, intrinsicApr: null } },
    { supplyAsset: { ...m.supplyAsset, intrinsicApr: 0.04 } },
    {
      supplyAsset: { ...m.supplyAsset, intrinsicApr: 0.03 },
      totalSupplyApr: 0.5,
    },
    { supplyAsset: { ...m.supplyAsset, address: '0x' + 'a'.repeat(40) } },
    { borrowAsset: { ...m.borrowAsset!, address: '0x' + 'b'.repeat(40) } },
    { borrowAsset: null },
    { borrowApr: null },
    { borrowApr: NaN },
    { borrowApr: -0.01 },
    { totalSupplyApr: null },
    { lltv: null },
    { lltv: 0 },
    { lltv: 1.01 },
    {
      requiredSupplyAssets: [
        { ...m.supplyAsset, address: '0x' + 'c'.repeat(40) },
      ],
    },
    {
      requiredBorrowAssets: [
        { ...m.borrowAsset!, address: '0x' + 'c'.repeat(40) },
      ],
    },
  ])
    expect(leveragedMarkets([strategyMarket(patch)])).toEqual([]);
  expect(
    leveragedMarkets([
      strategyMarket({ borrowApr: 0, lltv: 1, liquidity: null }),
    ]),
  ).toHaveLength(1);
});
it('groups chains and ranks by APR rather than liquidity; matches addresses case-insensitively', () => {
  const high = strategyMarket({
    borrowApr: 0.01,
    liquidityUsd: 1,
    market: 'high',
  });
  const low = strategyMarket({ liquidityUsd: 1000000, market: 'low' });
  high.supplyAsset.address = high.supplyAsset.address
    .toUpperCase()
    .replace('0X', '0x');
  const base = strategyMarket({
    network: 'base',
    market: 'base',
    borrowAsset: {
      ...low.borrowAsset!,
      address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    },
  });
  expect(
    groupedStrategyMarkets([low, base, high]).map((g) => [
      g.network,
      g.markets.map((m) => m.market),
    ]),
  ).toEqual([
    ['ethereum', ['high', 'low']],
    ['base', ['base']],
  ]);
});

it('uses verified Merkl-adjusted rates in qualification and permits incentive-driven negative borrow APR', () => {
  const market = strategyMarket({ protocolBorrowApr: .09, borrowApr: .03, merklBorrowApr: .06 });
  expect(leveragedMarkets([market])[0].modelledApr).toBeCloseTo((.08-.03*.86/1.02)/(1-.86/1.02),12);
  expect(leveragedMarkets([strategyMarket({ protocolBorrowApr: .03, merklBorrowApr: .04, borrowApr: -.01 })])).toHaveLength(1);
  expect(leveragedMarkets([strategyMarket({ protocolBorrowApr: .03, merklBorrowApr: .04, borrowApr: -.5 })])).toHaveLength(0);
});
