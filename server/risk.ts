import type { Asset, Risk } from '../src/types.js';
export function riskLevel(debt: number, health: number | null): Risk {
  if (debt === 0) return 'no-debt';
  if (health === null || !Number.isFinite(health)) return 'unknown';
  if (health <= 1) return 'liquidatable';
  if (health < 1.1) return 'high';
  if (health < 1.3) return 'watch';
  return 'lower';
}
/** One asset's price moves; every other price and balance is fixed.
 * Includes debt in that same asset, so correlated collateral/debt is not double counted.
 * Null means no positive downward price boundary, no debt, or unknown thresholds.
 */
export function liquidationPrices(assets: Asset[], debtUsd: number, weightedCollateralUsd: number): Asset[] {
  return assets.map(asset => {
    const threshold = asset.liquidationThreshold;
    if (!asset.collateral || threshold === null || debtUsd <= 0) return { ...asset, liquidationPriceUsd: null };
    const exposure = asset.supplied * threshold - asset.borrowed;
    const boundary = exposure > 0 ? asset.priceUsd + (debtUsd - weightedCollateralUsd) / exposure : null;
    return { ...asset, liquidationPriceUsd: boundary !== null && boundary > 0 && Number.isFinite(boundary) ? boundary : null };
  });
}
