import { expect, it } from 'vitest';
import type { Asset, Position } from '../src/types';
import { calculateLiquidation, liquidationScenario } from '../src/liquidation';
const asset = (symbol: string, supplied: number, priceUsd: number, lltv: number): Asset => ({ address: symbol, symbol, supplied, borrowed: 0, priceUsd, collateral: true, liquidationThreshold: lltv, liquidationPriceUsd: 123 });
const position = (): Position => ({ id: 'loan', label: 'Loan', debtUsd: 30000, suppliedUsd: 70000, healthFactor: 2, risk: 'lower', notes: [], assets: [asset('ETH', 10, 3000, .8), asset('WBTC', .5, 50000, .75), asset('USDC', 15000, 1, .9)] });
it('chooses largest current USD value, not quantity, order, or weighted capacity', () => {
  const p = position(); p.assets.reverse();
  p.assets.find(a => a.symbol === 'ETH')!.liquidationThreshold = .1;
  expect(liquidationScenario(p).target?.symbol).toBe('ETH');
  p.assets.find(a => a.symbol === 'USDC')!.liquidationThreshold = 1;
  expect(liquidationScenario(p).target?.symbol).toBe('ETH');
});
it('uses the requested three-collateral equation and holds total USD debt fixed', () => {
  const p = position(); p.assets[0].borrowed = 2;
  const result = calculateLiquidation(p, { WBTC: '30000', USDC: '.8' });
  expect(result.price).toBeCloseTo((30000 - 30000 * .75 * .5 - .8 * .9 * 15000) / (.8 * 10));
  expect(p.assets[0].liquidationPriceUsd).toBe(123);
});
it('supports two collateral assets and zero user prices', () => {
  const p = position(); p.assets.pop();
  expect(calculateLiquidation(p, { WBTC: '0' }).price).toBe(3750);
});
it('requires every manual price and rejects invalid, negative, or nonfinite entries', () => {
  for (const value of ['', ' ', '-1', 'NaN', 'Infinity', '1e999', '0x10', '1,000', 'abc']) expect(calculateLiquidation(position(), { WBTC: value, USDC: '1' }).message).toContain('Enter a valid');
  expect(calculateLiquidation(position(), { WBTC: '1' }).price).toBeNull();
});
it('distinguishes a zero boundary from no non-negative boundary', () => {
  expect(calculateLiquidation(position(), { WBTC: '80000', USDC: '0' }).price).toBe(0);
  expect(calculateLiquidation(position(), { WBTC: '90000', USDC: '1' }).message).toContain('No non-negative');
});
it('withholds results for missing debt, prices, effective factors, or unsupported oracle rules', () => {
  const changes: Partial<Position>[] = [{ debtUsd: null }, { debtUsd: 0 }, { liquidationModel: 'oracle-ratio' }, { liquidationModel: 'unavailable' }];
  for (const change of changes) expect(liquidationScenario({ ...position(), ...change }).target).toBeNull();
  for (const change of [{ priceUsd: null }, { liquidationThreshold: null }, { liquidationThreshold: 0 }, { liquidationThreshold: Infinity }]) {
    const p = position(); Object.assign(p.assets[1], change);
    expect(calculateLiquidation(p, { WBTC: '1', USDC: '1' }).price).toBeNull();
  }
});
it('excludes unpledged deposits and tokens with no supplied collateral', () => {
  const p = position(); p.assets.push({ ...asset('deposit', 1000000, 1, 1), collateral: false });
  expect(liquidationScenario(p).others).toHaveLength(2);
  expect(calculateLiquidation(p, { WBTC: '30000', USDC: '.8' }).price).not.toBeNull();
});
