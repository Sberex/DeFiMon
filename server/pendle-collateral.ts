import { parseAbi } from 'viem';
import type { Asset, InterestRate, NetworkId, ProtocolResult } from '../src/types.js';
import type { ChainClient } from './rpc.js';
import { ensurePendleMarketMetrics, pendleCatalog, type PendleMarket } from './pendle.js';
const abi = parseAbi(['function readTokens() view returns(address,address,address)', 'function expiry() view returns(uint256)']);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const hint = (a: Asset) => /^PT(?:[-\s]|$)/i.test(a.symbol);
/** Pendle APY is deliberately used directly as APR in the user's monthly model. */
export async function applyPtCollateralRates(protocols: ProtocolResult[], client: ChainClient, network: NetworkId, blockNumber: bigint, catalog = pendleCatalog, refresh?: (network: NetworkId, address: `0x${string}`) => Promise<PendleMarket | null>): Promise<ProtocolResult[]> {
  const assets = protocols.flatMap(p => p.positions.flatMap(p => p.assets)).filter(a => a.collateral && a.supplied > 0);
  if (!assets.length) return protocols;
  let markets: PendleMarket[] | null = null;
  try { markets = await catalog(network); } catch { /* Known/hinted PT rates stay unknown, never zero. */ }
  const selected = new Map<string, PendleMarket>();
  for (const m of markets ?? []) {
    const key = m.pt.address.toLowerCase(), previous = selected.get(key);
    if (!previous || (m.liquidity?.usd ?? 0) > (previous.liquidity?.usd ?? 0)) selected.set(key, m);
  }
  const candidates = assets.filter(a => selected.has(a.address.toLowerCase()) || hint(a));
  if (!candidates.length) return protocols;
  let timestamp: number | null = null;
  try { timestamp = Number((await client.getBlock({ blockNumber })).timestamp); } catch { /* No expiry/freshness assumption without a verified block. */ }
  const quotes = new Map<string, InterestRate>();
  await Promise.all([...new Map(candidates.map(a => [a.address.toLowerCase(), a])).values()].map(async a => {
    const listedMarket = selected.get(a.address.toLowerCase());
    const market = listedMarket && timestamp !== null && Date.parse(listedMarket.expiry) / 1000 > timestamp ? await ensurePendleMarketMetrics(listedMarket, network, timestamp, 'pt', refresh) : listedMarket;
    const quote: InterestRate = { apr: null, estimated: true, pendlePt: { network, marketAddress: market?.address ?? null, expiry: null, updatedAt: null }, note: 'Pendle PT collateral yield is unavailable. A current, verified Implied APY is needed for Supply APR and monthly earnings; it is unknown, not zero.' };
    if (market && timestamp !== null) {
      try {
        const [tokens, expiry, ptExpiry] = await Promise.all([
          client.readContract({ address: market.address, abi, functionName: 'readTokens', blockNumber }),
          client.readContract({ address: market.address, abi, functionName: 'expiry', blockNumber }),
          client.readContract({ address: market.pt.address, abi, functionName: 'expiry', blockNumber }),
        ]);
        if (!same(tokens[0], market.sy.address) || !same(tokens[1], a.address) || !same(tokens[2], market.yt.address) || expiry !== ptExpiry || expiry !== BigInt(Date.parse(market.expiry) / 1000)) throw new Error('Unverified PT identity or maturity');
        quote.pendlePt!.expiry = Number(expiry);
        if (Number(expiry) <= timestamp) {
          quote.apr = 0;
          quote.note = 'This Pendle PT has expired. Its future price-accretion Supply APR is 0%; borrowing costs still use the loan’s Borrow APR.';
        } else {
          const updated = Date.parse(market.dataUpdatedAt ?? '') / 1000;
          if (!Number.isFinite(updated) || updated > timestamp + 300 || timestamp - updated > 1800 || typeof market.impliedApy !== 'number' || !Number.isFinite(market.impliedApy) || market.impliedApy <= -1) throw new Error('Current PT Implied APY unavailable');
          quote.apr = market.impliedApy;
          quote.pendlePt!.updatedAt = market.dataUpdatedAt!;
          quote.note = `Pendle Implied APY is used directly as Supply APR for this PT collateral, as requested, without converting APY to APR. Monthly earnings = supplied value × this rate ÷ 12. This estimates PT price appreciation toward expiry rather than an interest payment. Rate observed ${market.dataUpdatedAt}; expiry ${new Date(Number(expiry) * 1000).toISOString()}.`;
        }
      } catch { /* Preserve balances and prices, but do not invent a PT yield. */ }
    }
    quotes.set(a.address.toLowerCase(), quote);
  }));
  return protocols.map(p => ({ ...p, positions: p.positions.map(position => ({ ...position, assets: position.assets.map(a => {
    const quote = a.collateral && a.supplied > 0 ? quotes.get(a.address.toLowerCase()) : undefined;
    if (!quote) return a;
    // PT yield replaces the base supply rate; it is not an additional savings rate.
    const { intrinsicSupplyRate: _intrinsic, ...rest } = a;
    return { ...rest, supplyRate: quote };
  }) })) }));
}
