import config from '../config/token-matches.json';
import { networkOrder } from './networks';
import type {
  DiscoveryMarket,
  DiscoveryQuery,
  DiscoveryResult,
} from './market-discovery';
export const STRATEGY_HEALTH_FACTOR = 1.02;
const tokens = Object.entries(config) as [string, Record<string, unknown>][];
export const strategySupplyChoices = tokens
  .filter(
    ([, token]) =>
      token._category === 'Savings stablecoin' &&
      Array.isArray(token._intrinsicOracles) &&
      token._intrinsicOracles.length > 0,
  )
  .map(([id]) => ({ id, category: 'Savings stablecoin' }))
  .sort((a, b) => a.id.localeCompare(b.id));
export const strategyBorrowChoices = tokens
  .filter(([, token]) => token._category === 'Stablecoin')
  .map(([id]) => ({ id, category: 'Stablecoin' }))
  .sort((a, b) => a.id.localeCompare(b.id));
const supplyIds = new Set(strategySupplyChoices.map((t) => t.id));
const borrowIds = new Set(strategyBorrowChoices.map((t) => t.id));
export function validateStrategyQuery(query: DiscoveryQuery): DiscoveryQuery {
  if (
    (query.supply !== null && !supplyIds.has(query.supply)) ||
    (query.borrow !== null && !borrowIds.has(query.borrow))
  )
    throw Error(
      'Choose a Savings stablecoin with a configured intrinsic oracle for Supply asset and a Stablecoin for Borrow asset, or Any asset.',
    );
  return query;
}
const supplyContracts = new Set(
  tokens
    .filter(([id]) => supplyIds.has(id))
    .flatMap(([, t]) =>
      networkOrder.flatMap((n) =>
        typeof t[n] === 'string'
          ? [`${n}:${(t[n] as string).toLowerCase()}`]
          : [],
      ),
    ),
);
const borrowContracts = new Set(
  tokens
    .filter(([id]) => borrowIds.has(id))
    .flatMap(([, t]) =>
      networkOrder.flatMap((n) =>
        typeof t[n] === 'string'
          ? [`${n}:${(t[n] as string).toLowerCase()}`]
          : [],
      ),
    ),
);
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
export function leveragedMarkets(markets: DiscoveryMarket[]) {
  return markets.flatMap((m) => {
    const intrinsic = m.supplyAsset.intrinsicApr;
    if (
      !m.borrowAsset ||
      !supplyContracts.has(
        `${m.network}:${m.supplyAsset.address.toLowerCase()}`,
      ) ||
      !borrowContracts.has(
        `${m.network}:${m.borrowAsset.address.toLowerCase()}`,
      ) ||
      !finite(intrinsic) ||
      !finite(m.borrowApr) ||
      (m.borrowApr < 0 &&
        !(
          finite(m.merklBorrowApr) &&
          m.merklBorrowApr > 0 &&
          finite(m.protocolBorrowApr) &&
          m.protocolBorrowApr >= 0 &&
          Math.abs(m.borrowApr - (m.protocolBorrowApr - m.merklBorrowApr)) <
            1e-10
        )) ||
      intrinsic <= m.borrowApr ||
      !finite(m.totalSupplyApr) ||
      !finite(m.lltv) ||
      m.lltv <= 0 ||
      m.lltv > 1
    )
      return [];
    // A single collateral/debt model cannot account for compulsory additional assets.
    if (
      m.requiredSupplyAssets?.some(
        (a) => a.address.toLowerCase() !== m.supplyAsset.address.toLowerCase(),
      ) ||
      m.requiredBorrowAssets?.some(
        (a) => a.address.toLowerCase() !== m.borrowAsset!.address.toLowerCase(),
      )
    )
      return [];
    const debtRatio = m.lltv / STRATEGY_HEALTH_FACTOR;
    const modelledApr =
      (m.totalSupplyApr - m.borrowApr * debtRatio) / (1 - debtRatio);
    if (!finite(modelledApr)) return [];
    return [{ ...m, modelledApr, modelledDebtRatio: debtRatio }];
  });
}
export function strategyDiscovery(result: DiscoveryResult): DiscoveryResult {
  return {
    ...result,
    markets: leveragedMarkets(result.markets),
    messages: [
      ...result.messages,
      'Only configured Savings stablecoin / Stablecoin pairs with verified intrinsic APR above borrow APR and a usable LLTV are included. Deposit-only markets and pools requiring additional assets are excluded.',
    ],
  };
}
export function groupedStrategyMarkets(markets: DiscoveryMarket[]) {
  const eligible = leveragedMarkets(markets);
  return networkOrder
    .map((network) => ({
      network,
      markets: eligible
        .filter((m) => m.network === network)
        .sort(
          (a, b) =>
            b.modelledApr - a.modelledApr ||
            (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1) ||
            a.market.localeCompare(b.market),
        ),
    }))
    .filter((g) => g.markets.length);
}
