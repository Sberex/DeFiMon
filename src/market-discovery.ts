import config from '../config/token-matches.json';
import type { NetworkId, TokenCategory } from './types';
import type { MarketAlternative, MarketSearch } from './market-comparison';
import { networkOrder } from './networks';
export interface DiscoveryQuery {
  supply: string | null;
  borrow: string | null;
}
export interface DiscoveryAsset {
  address: string;
  name: string;
  category: TokenCategory;
  intrinsicApr?: number | null;
}
export interface DiscoveryMarket extends MarketAlternative {
  modelledApr?: number;
  modelledDebtRatio?: number;
  requiredSupplyAssets?: DiscoveryAsset[];
  requiredBorrowAssets?: DiscoveryAsset[];
  supplyAsset: DiscoveryAsset;
  borrowAsset: DiscoveryAsset | null;
  supplyRateNote?: string;
  totalSupplyApr: number | null;
  liquidityUsd: number | null;
}
export interface DiscoveryResult {
  query: DiscoveryQuery;
  checkedAt: string;
  markets: DiscoveryMarket[];
  coverage: MarketSearch['coverage'];
  messages: string[];
}
export const discoveryTokenChoices = Object.entries(config)
  .map(([id, value]) => ({ id, category: value._category ?? 'Other' }))
  .sort((a, b) => a.id.localeCompare(b.id));
export function discoveryChoices(prefix: string) {
  const search = prefix.trim().toLocaleLowerCase();
  return discoveryTokenChoices.filter((t) =>
    t.id.toLocaleLowerCase().startsWith(search),
  );
}
export function groupedDiscoveryMarkets(markets: DiscoveryMarket[]) {
  return networkOrder
    .map((network) => ({
      network,
      markets: markets
        .filter((m) => m.network === network)
        .sort((a, b) => {
          if (a.liquidityUsd !== null || b.liquidityUsd !== null)
            return (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1);
          if (
            a.liquidity?.token &&
            a.liquidity.token.toLowerCase() ===
              b.liquidity?.token?.toLowerCase() &&
            a.liquidity?.amount !== b.liquidity?.amount
          )
            return (b.liquidity?.amount ?? -1) - (a.liquidity?.amount ?? -1);
          return (
            a.supplyAsset.name.localeCompare(b.supplyAsset.name) ||
            a.market.localeCompare(b.market)
          );
        }),
    }))
    .filter((g) => g.markets.length);
}
