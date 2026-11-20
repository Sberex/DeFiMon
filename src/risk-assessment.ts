import type { Position, ProtocolResult } from './types';
const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
/** User-defined Bad Debt rules, independent of liquidation LTV or display APR. */
export function badDebtReasons(protocol: string, position: Position): string[] {
  const reasons: string[] = [];
  if (protocol === 'morpho' || protocol === 'lista' || protocol === 'euler' || protocol === 'spark' && !!position.morphoMarket) for (const check of position.collateralOracleChecks ?? []) {
    if (check.status !== 'ok') reasons.push(`${check.asset} collateral oracle ${check.status === 'zero' ? 'returned zero' : 'could not return a price'}.`);
  }
  const debtAssets = position.assets.filter(a => a.borrowed > 0);
  const collateral = position.assets.filter(a => a.collateral && a.supplied !== 0);
  if (position.collateralValueUsd !== undefined) {
    if (finite(position.collateralValueUsd) && position.collateralValueUsd >= 0 && finite(position.debtUsd) && position.debtUsd > position.collateralValueUsd) reasons.push('Wallet borrowing value exceeds the value of its supplied collateral.');
  } else if (debtAssets.length && position.assets.every(a => finite(a.borrowed) && a.borrowed >= 0 && finite(a.supplied) && a.supplied >= 0) && debtAssets.every(a => finite(a.priceUsd) && a.priceUsd >= 0) && collateral.every(a => finite(a.collateralSupplied ?? a.supplied) && (a.collateralSupplied ?? a.supplied) >= 0 && finite(a.priceUsd) && a.priceUsd >= 0)) {
    const debt = debtAssets.reduce((s, a) => s + a.borrowed * a.priceUsd!, 0);
    const value = collateral.reduce((s, a) => s + (a.collateralSupplied ?? a.supplied) * a.priceUsd!, 0);
    if (finite(debt) && finite(value) && debt > value) reasons.push('Wallet borrowing value exceeds the value of its supplied collateral.');
  }
  return [...new Set(reasons)];
}
export const isBadDebtPosition = (protocol: string, position: Position) => badDebtReasons(protocol, position).length > 0;
export function overviewProtocols(protocols: ProtocolResult[]): ProtocolResult[] {
  return protocols.map(protocol => {
    const positions = protocol.positions.filter(p => !isBadDebtPosition(protocol.id, p));
    // Excluded positions contribute zero, but incomplete discovery stays unknown.
    return positions.length === protocol.positions.length ? protocol : { ...protocol, positions, balanceDiscoveryComplete: protocol.balanceDiscoveryComplete ?? true };
  });
}
