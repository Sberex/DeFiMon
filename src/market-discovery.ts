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
export interface BorrowingMode {
  id: number;
  label: string;
  ltv: number;
  lltv: number;
}
export interface DiscoveryMarket extends MarketAlternative {
  borrowingModes?: BorrowingMode[];
  borrowingMode?: BorrowingMode;
  modelledHealthFactor?: number;
  modelledEntryLtv?: number;
  modelledMode?: BorrowingMode;
  modelledLtvLimited?: boolean;
  protocolBorrowApr?: number | null;
  protocolBorrowApy?: number;
  merklSupplyApr?: number;
  merklBorrowApr?: number;
  merklPrograms?: {
    id: string;
    name: string;
    side: 'supply' | 'borrow';
    apr: number;
    apy?: number;
    url: string;
    note: string;
    endAt: string;
  }[];
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
/** Separate verified Aave risk configurations; their underlying pool liquidity is shared. */
export function expandDiscoveryModes(
  markets: DiscoveryMarket[],
): DiscoveryMarket[] {
  return markets.flatMap((m) => {
    if (
      !['Aave v3', 'Aave Horizon'].includes(m.protocol) ||
      !m.borrowAsset ||
      m.borrowingMode ||
      m.borrowingModes === undefined
    )
      return [m];
    const seen = new Set<number>();
    return [...m.borrowingModes]
      .sort((a, b) => a.id - b.id)
      .flatMap((mode) => {
        if (
          !Number.isInteger(mode.id) ||
          mode.id < 0 ||
          mode.id > 255 ||
          seen.has(mode.id) ||
          !Number.isFinite(mode.ltv) ||
          !Number.isFinite(mode.lltv) ||
          mode.ltv <= 0 ||
          mode.ltv > mode.lltv ||
          mode.lltv > 1
        )
          return [];
        seen.add(mode.id);
        return [
          {
            ...m,
            borrowingMode: mode,
            lltv: mode.lltv,
            collateralLtv: mode.ltv,
            route: `${m.route ? m.route + ':' : ''}aave-emode-${mode.id}`,
            note: `${mode.id ? `Requires eMode ${mode.id} (${mode.label}) to be enabled.` : 'Standard collateral configuration.'} ${m.note.replace('standard collateral configuration.', 'collateral limits shown for this row.')} Pool liquidity is shared across its mode variants.`,
          },
        ];
      });
  });
}
export function discoveryModeResult(result: DiscoveryResult): DiscoveryResult {
  return { ...result, markets: expandDiscoveryModes(result.markets) };
}
export function groupedDiscoveryMarkets(markets: DiscoveryMarket[]) {
  markets = expandDiscoveryModes(markets);
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
