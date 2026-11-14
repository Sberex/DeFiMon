import type { Asset, InterestRate, Position, ProtocolResult } from './types';
export interface MonthlyInterest { earnedUsd: number | null; paidUsd: number | null; nplUsd: number | null }
const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
/** Same supply APR used in the table, including sUSDai intrinsic yield exactly once. */
export function supplyApr(quote?: InterestRate, intrinsic?: InterestRate, merkl?: InterestRate): number | null {
  if (!finite(quote?.apr)) return null;
  if (intrinsic && !finite(intrinsic.apr)) return null;
  if (merkl && !finite(merkl.apr)) return null;
  const total = quote.apr + (intrinsic?.apr ?? 0) + (merkl?.apr ?? 0);
  return finite(total) ? total : null;
}
export function borrowApr(quote?: InterestRate, merkl?: InterestRate): number | null {
  if (!finite(quote?.apr) || (merkl && !finite(merkl.apr))) return null;
  const total = quote.apr - (merkl?.apr ?? 0);
  return finite(total) ? total : null;
}
function monthly(amount: number, apr: number | null | undefined): number | null {
  if (!finite(amount) || amount < 0) return null;
  if (amount === 0) return 0;
  if (!finite(apr)) return null;
  const result = amount * apr / 12;
  return finite(result) ? result : null;
}
function usd(amount: number | null, price: number | null): number | null {
  if (amount === 0) return 0;
  if (!finite(amount) || !finite(price) || price < 0) return null;
  const value = amount * price;
  return finite(value) ? value : null;
}
function net(earnedUsd: number | null, paidUsd: number | null): MonthlyInterest {
  const difference = earnedUsd !== null && paidUsd !== null ? earnedUsd - paidUsd : null;
  return { earnedUsd, paidUsd, nplUsd: finite(difference) ? difference : null };
}
export function assetMonthlyInterest(asset: Asset) {
  const earnedTokens = monthly(asset.supplied, supplyApr(asset.supplyRate, asset.intrinsicSupplyRate, asset.merklSupplyRate));
  const paidTokens = monthly(asset.borrowed, borrowApr(asset.borrowRate, asset.merklBorrowRate));
  return { earnedTokens, paidTokens, ...net(usd(earnedTokens, asset.priceUsd), usd(paidTokens, asset.priceUsd)) };
}
function sum(values: (number | null)[]): number | null {
  if (!values.every(finite)) return null;
  const total = values.reduce((a, b) => a + b, 0);
  return finite(total) ? total : null;
}
export function positionMonthlyInterest(position: Position): MonthlyInterest {
  // An unreadable position has no asset rows; it must never become a zero-interest loan.
  if (!position.assets.length) return net(position.suppliedUsd === 0 ? 0 : null, position.debtUsd === 0 ? 0 : null);
  const rows = position.assets.map(assetMonthlyInterest);
  return net(sum(rows.map(r => r.earnedUsd)), sum(rows.map(r => r.paidUsd)));
}
export function protocolMonthlyInterest(protocol: ProtocolResult): MonthlyInterest & { netValueUsd: number | null } {
  if (!['ok', 'partial'].includes(protocol.status) || (!protocol.positions.length && protocol.status !== 'ok')) return { ...net(null, null), netValueUsd: null };
  const positions = protocol.positions.map(positionMonthlyInterest);
  const netValueUsd = sum(protocol.positions.map(p => p.suppliedUsd !== null && p.debtUsd !== null ? p.suppliedUsd - p.debtUsd : null));
  return { ...net(sum(positions.map(p => p.earnedUsd)), sum(positions.map(p => p.paidUsd))), netValueUsd };
}
/** Sum each protocol/network once; Fluid's vault rows are already inside its protocol total. */
export function totalMonthlyInterest(protocols: ProtocolResult[]): MonthlyInterest & { partial: boolean } {
  const totals = protocols.map(protocolMonthlyInterest);
  return { ...net(sum(totals.map(p => p.earnedUsd)), sum(totals.map(p => p.paidUsd))), partial: protocols.some(p => p.status !== 'ok') };
}
/** Annualized NPL as a fraction of net value. Negative equity retains the user's signed formula. */
export function annualizedNplApr(monthlyNplUsd: number | null, netValueUsd: number | null): number | null {
  if (!finite(monthlyNplUsd) || !finite(netValueUsd) || netValueUsd === 0) return null;
  const apr = monthlyNplUsd * 12 / netValueUsd;
  return finite(apr) ? apr : null;
}
