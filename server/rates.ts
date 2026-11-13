import type { InterestRate } from '../src/types.js';
export const YEAR_SECONDS = 365 * 24 * 60 * 60;
export function rate(apr: number | null, note: string, estimated = false): InterestRate {
  return { apr: apr !== null && Number.isFinite(apr) ? apr : null, note, ...(estimated ? { estimated: true } : {}) };
}
export const unavailableRate = (note = 'Current interest rate could not be read. This is unknown, not zero.') => rate(null, note);
export const rayApr = (value: bigint) => Number(value) / 1e27;
export const perSecondApr = (value: bigint, scale = 1e18) => Number(value) / scale * YEAR_SECONDS;
export function weightedRate(a: InterestRate | undefined, amountA: number, b: InterestRate | undefined, amountB: number): InterestRate | undefined {
  if (amountA <= 0) return b;
  if (amountB <= 0) return a;
  if (a?.apr == null || b?.apr == null) return unavailableRate('A rate for one component of this asset is unavailable.');
  return rate((a.apr * amountA + b.apr * amountB) / (amountA + amountB), 'Balance-weighted current APR across this asset’s reserves or lending/collateral components.', a.estimated || b.estimated);
}
