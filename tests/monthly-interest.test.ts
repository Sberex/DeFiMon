import { expect, it } from 'vitest';
import type { Asset, Position, ProtocolResult } from '../src/types';
import { assetMonthlyInterest, positionMonthlyInterest, protocolMonthlyInterest, totalMonthlyInterest, supplyApr, borrowApr, annualizedNplApr } from '../src/monthly-interest';
const asset = (changes: Partial<Asset> = {}): Asset => ({ address: 'eth', symbol: 'ETH', supplied: 10, borrowed: 2, priceUsd: 3000, collateral: true, liquidationThreshold: .8, liquidationPriceUsd: 1500, supplyRate: { apr: .06, note: '' }, borrowRate: { apr: .12, note: '' }, ...changes });
const position = (assets: Asset[] = [asset()]): Position => ({ id: 'loan', label: 'Loan', assets, suppliedUsd: 30000, debtUsd: 6000, healthFactor: 4, risk: 'lower', notes: [] });
const protocol = (positions: Position[] = [position()]): ProtocolResult => ({ id: 'aave-v3', name: 'Aave v3', coverage: '', status: 'ok', positions });
it('uses balance × APR / 12 in token units and current price for USD, then subtracts paid from earned', () => {
  const result = assetMonthlyInterest(asset());
  expect(result.earnedTokens).toBeCloseTo(.05);
  expect(result.paidTokens).toBeCloseTo(.02);
  expect(result.earnedUsd).toBeCloseTo(150);
  expect(result.paidUsd).toBeCloseTo(60);
  expect(result.nplUsd).toBeCloseTo(90);
});
it('sums multiple assets and positions within a protocol without mutating balances or rates', () => {
  const p = protocol([position(), { ...position([asset({ supplied: 0, borrowed: 1200, priceUsd: 1, symbol: 'USDC' })]), suppliedUsd: 0, debtUsd: 1200 }]);
  const before = structuredClone(p);
  const result = protocolMonthlyInterest(p);
  expect(result.earnedUsd).toBeCloseTo(150);
  expect(result.paidUsd).toBeCloseTo(72);
  expect(result.nplUsd).toBeCloseTo(78);
  expect(result.netValueUsd).toBe(22800);
  expect(p).toEqual(before);
});
it('includes intrinsic yield exactly once using the same combined supply APR as the table', () => {
  const a = asset({ supplied: 1200, borrowed: 0, priceUsd: 1.1, supplyRate: { apr: .02, note: '' }, intrinsicSupplyRate: { apr: .0756, note: '', source: { chain: 'Ethereum', oracle: 'feed' } } });
  expect(supplyApr(a.supplyRate, a.intrinsicSupplyRate)).toBeCloseTo(.0956);
  expect(assetMonthlyInterest(a).earnedTokens).toBeCloseTo(9.56);
  expect(assetMonthlyInterest(a).earnedUsd).toBeCloseTo(10.516);
  expect(assetMonthlyInterest(a).nplUsd).toBeCloseTo(10.516);
});
it('preserves negative NPL, true zero, negative supply costs and borrowing incentives', () => {
  expect(assetMonthlyInterest(asset({ supplyRate: { apr: 0, note: '' } })).nplUsd).toBe(-60);
  const result = assetMonthlyInterest(asset({ supplyRate: { apr: -.06, note: '' }, borrowRate: { apr: -.12, note: '' } }));
  expect(result.earnedUsd).toBeCloseTo(-150);
  expect(result.paidUsd).toBeCloseTo(-60);
  expect(result.nplUsd).toBeCloseTo(-90);
});
it('does not require a rate or price for zero balances or zero-interest components', () => {
  const zero = assetMonthlyInterest(asset({ supplied: 0, borrowed: 0, priceUsd: null, supplyRate: undefined, borrowRate: undefined }));
  expect(zero).toMatchObject({ earnedTokens: 0, paidTokens: 0, earnedUsd: 0, paidUsd: 0, nplUsd: 0 });
  expect(assetMonthlyInterest(asset({ supplied: 10, borrowed: 0, priceUsd: null, supplyRate: { apr: 0, note: '' } })).earnedUsd).toBe(0);
});
it('keeps missing active rates, intrinsic components, and USD prices unknown while retaining readable sides', () => {
  for (const changes of [{ supplyRate: undefined }, { supplyRate: { apr: null, note: '' } }, { intrinsicSupplyRate: { apr: null, note: '', source: { chain: 'Ethereum' as const, oracle: 'feed' } } }]) {
    const result = assetMonthlyInterest(asset(changes));
    expect(result.earnedUsd).toBeNull(); expect(result.paidUsd).toBe(60); expect(result.nplUsd).toBeNull();
  }
  const unpriced = assetMonthlyInterest(asset({ priceUsd: null }));
  expect(unpriced.earnedTokens).toBeCloseTo(.05); expect(unpriced.earnedUsd).toBeNull(); expect(unpriced.nplUsd).toBeNull();
  expect(assetMonthlyInterest(asset({ borrowRate: undefined })).paidUsd).toBeNull();
});
it('does not turn unreadable positions or failed and unenumerated protocols into zero NPL', () => {
  const unknown = { ...position([]), suppliedUsd: null, debtUsd: null };
  expect(positionMonthlyInterest(unknown).nplUsd).toBeNull();
  expect(protocolMonthlyInterest(protocol([position(), unknown])).nplUsd).toBeNull();
  expect(protocolMonthlyInterest({ ...protocol([]), status: 'partial' }).nplUsd).toBeNull();
  expect(protocolMonthlyInterest({ ...protocol(), status: 'error' }).nplUsd).toBeNull();
  expect(protocolMonthlyInterest(protocol([]))).toMatchObject({ earnedUsd: 0, paidUsd: 0, nplUsd: 0, netValueUsd: 0 });
});
it('retains the checked-position subtotal for partial coverage and keeps each protocol/network independent', () => {
  const partial = { ...protocol(), status: 'partial' as const };
  expect(protocolMonthlyInterest(partial).nplUsd).toBeCloseTo(90);
  for (const chain of ['Ethereum', 'Plasma', 'Arbitrum'] as const) {
    for (const id of ['aave-v3', 'aave-v4', 'morpho', 'compound', 'fluid']) expect(protocolMonthlyInterest({ ...protocol(), chain, id }).nplUsd).toBeCloseTo(90);
  }
});
it('rejects nonfinite calculations rather than displaying NaN or infinity', () => {
  expect(assetMonthlyInterest(asset({ supplyRate: { apr: Infinity, note: '' } })).earnedUsd).toBeNull();
  expect(assetMonthlyInterest(asset({ supplied: 1e308, priceUsd: 1e308 })).earnedUsd).toBeNull();
  expect(supplyApr({ apr: 1e308, note: '' }, { apr: 1e308, note: '' })).toBeNull();
});

it('totals each protocol and network once, including all Fluid vaults and deposits once', () => {
  const fluid = { ...protocol([position(), position()]), id: 'fluid', chain: 'Ethereum' as const };
  const aave = { ...protocol(), chain: 'Plasma' as const };
  const compound = { ...protocol(), id: 'compound', chain: 'Arbitrum' as const };
  const total = totalMonthlyInterest([fluid, aave, compound]);
  expect(total.earnedUsd).toBeCloseTo(600);
  expect(total.paidUsd).toBeCloseTo(240);
  expect(total.nplUsd).toBeCloseTo(360);
  expect(total.partial).toBe(false);
});
it('withholds total NPL for a failed reader or missing active rate rather than omitting borrowing costs', () => {
  expect(totalMonthlyInterest([protocol(), { ...protocol(), status: 'error' }]).nplUsd).toBeNull();
  const missing = protocol([position([asset({ borrowRate: undefined })])]);
  expect(totalMonthlyInterest([protocol(), missing])).toMatchObject({ earnedUsd: 300, paidUsd: null, nplUsd: null });
});
it('labels totals from partial coverage and preserves a genuine zero portfolio', () => {
  expect(totalMonthlyInterest([{ ...protocol(), status: 'partial' }])).toMatchObject({ nplUsd: 90, partial: true });
  expect(totalMonthlyInterest([protocol([])])).toMatchObject({ earnedUsd: 0, paidUsd: 0, nplUsd: 0, partial: false });
});

it('combines protocol interest, intrinsic yield and Merkl APR once while subtracting borrow rebates', () => {
  expect(supplyApr({ apr: .02, note: '' }, { apr: .0756, note: '' }, { apr: .0132, note: '' })).toBeCloseTo(.1088);
  expect(borrowApr({ apr: .04, note: '' }, { apr: .05, note: '' })).toBeCloseTo(-.01);
  expect(borrowApr({ apr: null, note: '' }, { apr: .02, note: '' })).toBeNull();
});

it('annualizes NPL over net value with signed results and guards zero, unknown and nonfinite values', () => {
  expect(annualizedNplApr(100, 10000)).toBeCloseTo(.12);
  expect(annualizedNplApr(-50, 10000)).toBeCloseTo(-.06);
  expect(annualizedNplApr(0, 10000)).toBe(0);
  expect(annualizedNplApr(100, -10000)).toBeCloseTo(-.12);
  expect(annualizedNplApr(-50, -10000)).toBeCloseTo(.06);
  for (const [npl, value] of [[100, 0], [null, 100], [100, null], [Infinity, 100], [100, Infinity], [1e308, 1]]) expect(annualizedNplApr(npl, value)).toBeNull();
});
