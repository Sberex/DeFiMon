import { expect, it } from 'vitest';
import { availableMonthlyInterest, totalMonthlyInterest, annualizedNplApr, assetMonthlyInterest } from '../src/monthly-interest';
import type { Asset, ProtocolResult, WalletBalances } from '../src/types';
const asset = (changes: Partial<Asset> = {}): Asset => ({ address: '0x1111111111111111111111111111111111111111', symbol: 'ETH', supplied: 10, borrowed: 2, priceUsd: 3000, collateral: true, liquidationThreshold: .8, liquidationPriceUsd: 1500, supplyRate: { apr: .06, note: '' }, borrowRate: { apr: .12, note: '' }, ...changes });
const protocol = (assets = [asset()]): ProtocolResult => ({ id: 'aave-v3', name: 'Aave v3', chain: 'Ethereum', coverage: '', status: 'ok', positions: [{ id: 'main', label: 'Main market', suppliedUsd: 30000, debtUsd: 6000, healthFactor: 4, risk: 'lower', notes: [], assets }] });
const wallet = (changes: Partial<WalletBalances> = {}): WalletBalances => ({ chain: 'Ethereum', status: 'partial', coverage: '', interestDiscoveryComplete: false, pricedValueUsd: 1000, unpricedCount: 0, tokens: [{ address: '0x2222222222222222222222222222222222222222', symbol: 'Savings', balance: 1000, priceUsd: 1, valueUsd: 1000, category: 'Savings stablecoin', intrinsicSupplyRate: { apr: .12, note: '', source: { chain: 'Ethereum', oracle: '' } } }], ...changes });
it('shows readable lending and wallet income despite incomplete wallet discovery and failed chains/protocols', () => {
  const failed = { ...protocol([]), status: 'error' as const, chain: 'Arbitrum' as const };
  expect(totalMonthlyInterest([protocol(), failed], [wallet()]).nplUsd).toBeNull();
  const result = availableMonthlyInterest([protocol(), failed], [wallet()]);
  expect(result).toMatchObject({ earnedUsd: 160, paidUsd: 60, nplUsd: 100, partial: true });
  expect(result.issues.some(i => i.chain === 'Arbitrum')).toBe(true);
  expect(result.issues.some(i => i.protocol === 'Wallet tokens')).toBe(true);
  expect(annualizedNplApr(result.nplUsd, 25000)).toBeCloseTo(.048);
});
it('retains known rows when protocol position discovery is incomplete', () => {
  const p = { ...protocol(), status: 'partial' as const, balanceDiscoveryComplete: false };
  p.positions.push({ ...p.positions[0], id: 'unreadable', suppliedUsd: null, debtUsd: null, assets: [] });
  const result = availableMonthlyInterest([p]);
  expect(result).toMatchObject({ earnedUsd: 150, paidUsd: 60, nplUsd: 90, partial: true });
});
it('keeps known protocol and reward components when intrinsic yield or base rates are missing', () => {
  const a = asset({ intrinsicSupplyRate: { apr: null, note: '', source: { chain: 'Ethereum', oracle: '' } }, merklSupplyRate: { apr: .01, note: '', components: [] } });
  expect(assetMonthlyInterest(a).earnedUsd).toBeNull();
  expect(availableMonthlyInterest([protocol([a])])).toMatchObject({ earnedUsd: 175, paidUsd: 60, nplUsd: 115, partial: true });
  const rebate = asset({ borrowRate: undefined, merklBorrowRate: { apr: .01, note: '', components: [] } });
  expect(availableMonthlyInterest([protocol([rebate])])).toMatchObject({ earnedUsd: 150, paidUsd: -5, nplUsd: 155, partial: true });
});
it('shows missing borrowing costs explicitly while retaining known income, and vice versa', () => {
  const incomeOnly = availableMonthlyInterest([protocol([asset({ borrowRate: undefined })])]);
  expect(incomeOnly).toMatchObject({ earnedUsd: 150, paidUsd: null, nplUsd: 150, partial: true });
  expect(incomeOnly.issues[0].reason).toContain('Borrow APR unavailable');
  const costsOnly = availableMonthlyInterest([protocol([asset({ supplyRate: undefined })])]);
  expect(costsOnly).toMatchObject({ earnedUsd: null, paidUsd: 60, nplUsd: -60, partial: true });
});
it('does not manufacture zero when no active component can be verified and preserves genuine zero', () => {
  expect(availableMonthlyInterest([{ ...protocol([]), status: 'error' }], [wallet({ status: 'error', tokens: [] })]).nplUsd).toBeNull();
  expect(availableMonthlyInterest([protocol([asset({ supplyRate: undefined, borrowRate: undefined })])]).nplUsd).toBeNull();
  expect(availableMonthlyInterest([], [wallet({ tokens: [] })]).nplUsd).toBeNull();
  expect(availableMonthlyInterest([{ ...protocol([]), positions: [], status: 'ok' }])).toMatchObject({ nplUsd: 0, partial: false });
});
it('excludes Bad Debt and receipt tokens, preserves losses, and uses only priced readable components', () => {
  const bad = protocol(); bad.id = 'morpho'; bad.positions[0].collateralOracleChecks = [{ asset: 'ETH', oracle: '', status: 'unavailable' }];
  const loss = protocol([asset({ supplyRate: { apr: -.06, note: '' } }), asset({ priceUsd: null })]);
  const result = availableMonthlyInterest([bad, loss], [wallet({ tokens: [{ ...wallet().tokens[0], excludedReason: 'Already counted in lending' }] })]);
  expect(result).toMatchObject({ earnedUsd: -150, paidUsd: 60, nplUsd: -210, partial: true });
});
it('keeps complete portfolios identical to strict totals and rejects overflowing partial totals', () => {
  expect(availableMonthlyInterest([protocol()])).toEqual(totalMonthlyInterest([protocol()]));
  const large = asset({ supplied: 1e308, borrowed: 0, priceUsd: 1, supplyRate: { apr: 1, note: '' } });
  const result = availableMonthlyInterest([protocol(Array.from({ length: 24 }, () => large)), { ...protocol([]), status: 'error' }]);
  expect(result.nplUsd).toBeNull(); expect(result.issues.at(-1)?.reason).toContain('exceeds supported');
});
