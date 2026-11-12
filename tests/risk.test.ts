import { describe, expect, it } from 'vitest';
import { liquidationPrices, riskLevel } from '../server/risk';
import type { Asset } from '../src/types';
const eth: Asset = { symbol: 'ETH', address: '0x1', supplied: 10, borrowed: 0, priceUsd: 3000, collateral: true, liquidationThreshold: .85, liquidationPriceUsd: null };
describe('liquidation estimates', () => {
  it('finds the collateral price where weighted collateral equals debt', () => {
    const price = liquidationPrices([eth], 15000, 25500)[0].liquidationPriceUsd!;
    expect(price).toBeCloseTo(1764.705882);
    expect(price * 10 * .85).toBeCloseTo(15000);
  });
  it('holds other collateral prices fixed', () => {
    const assets = [eth, { ...eth, symbol: 'WBTC', supplied: 1, priceUsd: 60000, liquidationThreshold: .8 }];
    expect(liquidationPrices(assets, 60000, 73500)[0].liquidationPriceUsd).toBeCloseTo(3000 - 13500 / 8.5);
  });
  it('accounts for debt in the collateral asset', () => {
    const asset = { ...eth, borrowed: 2 };
    // 8.5P = 2P + 10,000; assumes remaining debt is stable.
    expect(liquidationPrices([asset], 16000, 25500)[0].liquidationPriceUsd).toBeCloseTo(10000 / 6.5);
  });
  it('does not invent downward prices for fully offset collateral or nonpositive boundaries', () => {
    expect(liquidationPrices([{ ...eth, borrowed: 9 }], 27000, 25500)[0].liquidationPriceUsd).toBeNull();
    expect(liquidationPrices([eth], 1000, 50000)[0].liquidationPriceUsd).toBeNull();
  });
  it('withholds prices for no debt, unused collateral, and unverified thresholds', () => {
    expect(liquidationPrices([eth], 0, 25500)[0].liquidationPriceUsd).toBeNull();
    expect(liquidationPrices([{ ...eth, collateral: false }], 15000, 25500)[0].liquidationPriceUsd).toBeNull();
    expect(liquidationPrices([{ ...eth, liquidationThreshold: null }], 15000, 25500)[0].liquidationPriceUsd).toBeNull();
  });
  it('shows threshold prices above spot for already unhealthy positions', () => {
    expect(liquidationPrices([eth], 30000, 25500)[0].liquidationPriceUsd).toBeGreaterThan(3000);
  });
});
it('distinguishes no borrowing, unknown risk, and liquidation boundaries', () => {
  expect(riskLevel(0, null)).toBe('no-debt');
  expect(riskLevel(100, null)).toBe('unknown');
  expect(riskLevel(100, 1)).toBe('liquidatable');
  expect(riskLevel(100, 1.05)).toBe('high');
  expect(riskLevel(100, 1.2)).toBe('watch');
  expect(riskLevel(100, 2)).toBe('lower');
});
