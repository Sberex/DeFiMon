import type { NetworkId } from './types';
export interface ComparisonTarget { id: string; network: NetworkId; supplied: string; borrowed?: string; supplyBasket?: string[]; borrowBasket?: string[] }
export interface MarketLiquidity { amount: number; symbol: string; token: string; note: string }
export interface MarketAlternative {
  targetId: string; protocol: string; network: NetworkId; market: string; route?: string; label: string;
  collateralVault?: { address: string; label: string; url: string };
  liquidity?: MarketLiquidity | null; supplyApr: number; borrowApr: number | null; lltv: number | null; block: string; url: string; note: string;
}
export interface TokenDiscoveryReport {
  network: NetworkId; token: string; label?: string;
  status: 'manual' | 'found' | 'not-found' | 'unavailable' | 'conflict';
  matches: Partial<Record<NetworkId, string>>;
  sources: { provider: 'CoinGecko' | 'CoinMarketCap'; assetId: string; url: string }[];
  warnings: string[];
}
export interface MarketSearch { tokenDiscovery?: TokenDiscoveryReport[]; targetIds?: string[]; checkedAt: string; alternatives: MarketAlternative[]; coverage: { protocol: string; network: NetworkId; status: 'ok' | 'partial' | 'error'; message?: string }[] }

import type { RecommendationPosition } from './recommendations';
import { supplyApr, borrowApr } from './monthly-interest';
export const comparisonId = (position: RecommendationPosition, row: number) => `${position.key}:${row}`;
export function comparisonTargets(positions: RecommendationPosition[]): ComparisonTarget[] {
  return positions.flatMap(position => position.rows.flatMap((row, index) => {
    if (!row.supplied || !/^0x[0-9a-f]{40}$/i.test(row.supplied.address) || (row.borrowed && !/^0x[0-9a-f]{40}$/i.test(row.borrowed.address))) return [];
    return [{ id: comparisonId(position, index), network: position.chain === 'Ethereum' ? 'ethereum' : position.chain === 'Plasma' ? 'plasma' : 'arbitrum', supplied: row.supplied.address, supplyBasket: [...new Set(position.rows.flatMap(r => r.supplied ? [r.supplied.address] : []))], borrowBasket: [...new Set(position.rows.flatMap(r => r.borrowed ? [r.borrowed.address] : []))], ...(row.borrowed ? { borrowed: row.borrowed.address } : {}) } as ComparisonTarget];
  }));
}
export function betterAlternatives(position: RecommendationPosition, index: number, search: MarketSearch | null) {
  const row = position.rows[index];
  const baseline = row.borrowed ? borrowApr(row.borrowed.borrowRate, row.borrowed.merklBorrowRate) : supplyApr(row.supplied?.supplyRate, row.supplied?.intrinsicSupplyRate, row.supplied?.merklSupplyRate);
  if (baseline === null || (row.supplied?.intrinsicSupplyRate && row.supplied.intrinsicSupplyRate.apr === null && !row.borrowed)) return [];
  const seen = new Set<string>();
  return (search?.alternatives ?? []).flatMap(candidate => {
    if (candidate.targetId !== comparisonId(position, index)) return [];
    const heldRoutes = row.supplied?.v4Reserves ? new Set(row.supplied.v4Reserves.filter(s => s.supplied > 0).flatMap(s => row.borrowed ? (row.borrowed.v4Reserves ?? []).filter(b => b.borrowed > 0).map(b => `${s.hub.toLowerCase()}/${s.assetId}:${b.hub.toLowerCase()}/${b.assetId}`) : [`${s.hub.toLowerCase()}/${s.assetId}`])) : null;
    const sameCurrentRoute = !candidate.route || !heldRoutes || heldRoutes.has(candidate.route);
    if (sameCurrentRoute && candidate.protocol === position.protocol && candidate.network === (position.chain === 'Ethereum' ? 'ethereum' : position.chain === 'Plasma' ? 'plasma' : 'arbitrum') && (position.market ? position.market.toLowerCase() === candidate.market.toLowerCase() : position.protocolId === 'aave-v3')) return [];
    const apr = row.borrowed ? candidate.borrowApr : candidate.supplyApr + (row.supplied?.intrinsicSupplyRate?.apr ?? 0);
    if (apr === null || !Number.isFinite(apr) || !(row.borrowed ? apr < baseline - 1e-10 : apr > baseline + 1e-10)) return [];
    const key = `${candidate.protocol}:${candidate.network}:${candidate.market.toLowerCase()}:${candidate.route ?? ''}`;
    if (seen.has(key)) return []; seen.add(key);
    return [{ ...candidate, comparedApr: apr, difference: row.borrowed ? baseline - apr : apr - baseline }];
  }).sort((a, b) => {
    if (row.borrowed) {
      const liquidity = (value: MarketAlternative) => value.liquidity && Number.isFinite(value.liquidity.amount) && value.liquidity.amount >= 0 ? value.liquidity.amount : -1;
      const byLiquidity = liquidity(b) - liquidity(a);
      if (byLiquidity !== 0) return byLiquidity;
      return a.comparedApr - b.comparedApr;
    }
    return b.comparedApr - a.comparedApr;
  });
}
