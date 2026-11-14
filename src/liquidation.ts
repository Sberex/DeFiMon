import type { Asset, Position } from './types';
export const collateralAssets = (p: Position) => p.assets.filter(a => a.collateral && a.supplied > 0);
const validFactor = (a: Asset) => a.liquidationThreshold !== null && Number.isFinite(a.liquidationThreshold) && a.liquidationThreshold > 0 && a.liquidationThreshold <= 1;
export function liquidationScenario(p: Position): { target: Asset | null; others: Asset[]; reason?: string } {
  const collateral = collateralAssets(p);
  const blocked = (reason: string) => ({ target: null, others: [], reason });
  if (collateral.length < 2 || p.debtUsd === 0) return blocked('No multi-collateral loan to calculate.');
  if (p.liquidationModel === 'oracle-ratio') return blocked('This vault uses pool shares and an oracle ratio. Independent token liquidation prices are unavailable; use the oracle boundary below.');
  if (p.liquidationModel === 'unavailable') return blocked('The effective liquidation rules could not be verified for this position.');
  if (p.debtUsd === null || !Number.isFinite(p.debtUsd) || p.debtUsd < 0) return blocked('The borrowed USD value is unavailable.');
  if (collateral.some(a => a.priceUsd === null || !Number.isFinite(a.priceUsd) || a.priceUsd < 0 || !Number.isFinite(a.supplied))) return blocked('Current collateral prices are needed to identify the largest holding.');
  if (collateral.some(a => !validFactor(a))) return blocked('An effective collateral LLTV is unavailable.');
  const sorted = [...collateral].sort((a, b) => b.supplied * b.priceUsd! - a.supplied * a.priceUsd!);
  return { target: sorted[0], others: sorted.slice(1) };
}
export function calculateLiquidation(p: Position, prices: Record<string, string>): { price: number | null; message?: string } {
  const scenario = liquidationScenario(p);
  if (!scenario.target) return { price: null, message: scenario.reason };
  let otherCapacity = 0;
  for (const asset of scenario.others) {
    const input = prices[asset.address]?.trim();
    if (!input || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(input) || !Number.isFinite(Number(input))) return { price: null, message: `Enter a valid USD liquidation price of zero or more for ${asset.symbol}.` };
    otherCapacity += Number(input) * asset.liquidationThreshold! * asset.supplied;
  }
  // The user's scenario holds total borrowed USD fixed, including debt denominated
  // in a collateral token. This differs from the single-asset moving-debt estimate.
  const price = (p.debtUsd! - otherCapacity) / (scenario.target.liquidationThreshold! * scenario.target.supplied);
  if (!Number.isFinite(price)) return { price: null, message: 'These values are too large to calculate.' };
  if (price < 0) return { price: null, message: 'No non-negative liquidation price: the other collateral alone covers the fixed debt at the entered prices.' };
  return { price };
}
