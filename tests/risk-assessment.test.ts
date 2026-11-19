import { expect, it } from 'vitest';
import type { Asset, Position, ProtocolResult } from '../src/types';
import { badDebtReasons, overviewProtocols } from '../src/risk-assessment';
import { totalMonthlyInterest, protocolMonthlyInterest } from '../src/monthly-interest';
import { recommendationPositions } from '../src/recommendations';
const asset = (changes: Partial<Asset> = {}): Asset => ({ address: '0x1111111111111111111111111111111111111111', symbol: 'USDC', supplied: 1000, borrowed: 0, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, supplyRate: { apr: .12, note: '' }, borrowRate: { apr: .06, note: '' }, ...changes });
const position = (changes: Partial<Position> = {}): Position => ({ id: 'deposit', label: 'USDC deposit', assets: [asset()], suppliedUsd: 1000, debtUsd: 0, healthFactor: null, risk: 'no-debt', notes: [], ...changes });
const protocol = (positions: Position[], id = 'morpho'): ProtocolResult => ({ id, name: id, status: 'ok', coverage: '', positions, chain: 'Ethereum' });
it('moves a priced Morpho supply-only deposit with a failing market collateral oracle out of totals and recommendations', () => {
  const bad = position({ id: 'msY', collateralOracleChecks: [{ asset: 'msY', oracle: 'oracle', status: 'unavailable' }], assets: [asset({ supplied: 6000000, supplyRate: { apr: 8, note: '' } })], suppliedUsd: 6000000 });
  const p = protocol([bad, position()]), before = structuredClone(p);
  expect(badDebtReasons('morpho', bad)).toEqual(['msY collateral oracle could not return a price.']);
  expect(overviewProtocols([p])[0].positions.map(p => p.id)).toEqual(['deposit']);
  expect(protocolMonthlyInterest(p)).toMatchObject({ netValueUsd: 1000, earnedUsd: 10, paidUsd: 0, nplUsd: 10 });
  expect(recommendationPositions([p]).map(p => p.label)).toEqual(['USDC deposit']);
  expect(p).toEqual(before);
});
it('applies missing/zero native oracle checks only to Morpho and Euler, and does not infer failure from absent display prices', () => {
  for (const status of ['unavailable', 'zero'] as const) {
    const p = position({ collateralOracleChecks: [{ asset: 'Collateral', oracle: 'oracle', status }] });
    expect(badDebtReasons('morpho', p)).toHaveLength(1); expect(badDebtReasons('euler', p)).toHaveLength(1);
    expect(badDebtReasons('aave-v3', p)).toEqual([]);
  }
  expect(badDebtReasons('morpho', position({ assets: [asset({ priceUsd: null, collateral: true })] }))).toEqual([]);
});
it('compares debt with unweighted pledged collateral, excluding ordinary loan-token deposits on every protocol', () => {
  for (const id of ['morpho', 'euler', 'aave-v3', 'aave-v4', 'fluid', 'compound']) {
    const p = position({ assets: [asset({ collateral: true, collateralSupplied: 100, supplied: 10000 }), asset({ supplied: 0, borrowed: 101 })], debtUsd: 101 });
    expect(badDebtReasons(id, p)).toEqual(['Wallet borrowing value exceeds the value of its supplied collateral.']);
    p.assets[1].borrowed = 100;
    expect(badDebtReasons(id, p)).toEqual([]); // Equality and low health alone are not this rule.
    p.assets[1].borrowed = 90; p.healthFactor = .8;
    expect(badDebtReasons(id, p)).toEqual([]);
    p.assets[1].priceUsd = null;
    expect(badDebtReasons(id, p)).toEqual([]);
  }
});
it('retains unknown rates and incomplete discovery while excluded-only readable positions contribute zero', () => {
  const bad = position({ collateralOracleChecks: [{ asset: 'msY', oracle: 'oracle', status: 'unavailable' }] });
  expect(totalMonthlyInterest([{ ...protocol([bad]), status: 'partial' }])).toMatchObject({ nplUsd: 0, earnedUsd: 0, paidUsd: 0, issues: [] });
  expect(totalMonthlyInterest([{ ...protocol([bad]), balanceDiscoveryComplete: false }]).nplUsd).toBeNull();
  const unread = position({ assets: [asset({ supplyRate: undefined })] });
  expect(totalMonthlyInterest([protocol([bad, unread])]).nplUsd).toBeNull();
});
it('uses authoritative unweighted account collateral, including eMode, rather than mistaking missing row flags for zero', () => {
  const p = position({ suppliedUsd: 48580.73, collateralValueUsd: 48580.73, debtUsd: 46174.86, healthFactor: 1.01, assets: [asset({ supplied: 48580.73 }), asset({ supplied: 0, borrowed: 46174.86 })] });
  expect(badDebtReasons('aave-v3', p)).toEqual([]);
  expect(overviewProtocols([protocol([p], 'aave-v3')])[0].positions).toHaveLength(1);
  expect(recommendationPositions([protocol([p], 'aave-v3')])).toHaveLength(1);
  expect(protocolMonthlyInterest(protocol([p], 'aave-v3')).netValueUsd).toBeCloseTo(2405.87);
  p.debtUsd = 48580.73; expect(badDebtReasons('aave-v3', p)).toEqual([]);
  p.debtUsd = 48580.74; expect(badDebtReasons('aave-v3', p)).toHaveLength(1);
  p.collateralValueUsd = null; expect(badDebtReasons('aave-v3', p)).toEqual([]);
});
