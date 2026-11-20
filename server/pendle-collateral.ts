import { parseAbi } from 'viem';
import type { Asset, InterestRate, NetworkId, ProtocolResult } from '../src/types.js';
import type { ChainClient } from './rpc.js';
import { ensurePendleMarketMetrics, pendleCatalog, type PendleMarket } from './pendle.js';
const abi = parseAbi(['function readTokens() view returns(address,address,address)', 'function expiry() view returns(uint256)']);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const hint = (a: Asset) => /^PT(?:[-\s]|$)/i.test(a.symbol);
/** Active PT collateral uses Implied APY; every supplied expired PT uses 0% per the user's rule. */
export async function applyPtCollateralRates(protocols: ProtocolResult[], client: ChainClient, network: NetworkId, blockNumber: bigint, catalog = pendleCatalog, refresh?: (network: NetworkId, address: `0x${string}`) => Promise<PendleMarket | null>): Promise<ProtocolResult[]> {
  const assets = protocols.flatMap(p => p.positions.flatMap(p => p.assets)).filter(a => a.supplied > 0);
  if (!assets.length) return protocols;
  let markets: PendleMarket[] | null = null;
  try { markets = await catalog(network); } catch { /* Token expiry can still be checked directly when catalog discovery fails. */ }
  const selected = new Map<string, PendleMarket>();
  for (const m of markets ?? []) {
    const key = m.pt.address.toLowerCase(), previous = selected.get(key);
    if (!previous || (m.liquidity?.usd ?? 0) > (previous.liquidity?.usd ?? 0)) selected.set(key, m);
  }
  const candidates = assets.filter(a => selected.has(a.address.toLowerCase()) || hint(a));
  if (!candidates.length) return protocols;
  let timestamp: number | null = null;
  try { const t = Number((await client.getBlock({ blockNumber })).timestamp); if (Number.isSafeInteger(t) && t > 0) timestamp = t; } catch { /* No expiry/freshness assumption without a verified block. */ }
  const quotes = new Map<string, InterestRate>(), expiredTokens = new Set<string>();
  await Promise.all([...new Map(candidates.map(a => [a.address.toLowerCase(), a])).values()].map(async a => {
    const listedMarket = selected.get(a.address.toLowerCase());
    const quote: InterestRate = { apr: null, estimated: true, pendlePt: { network, marketAddress: null, expiry: null, updatedAt: null }, note: 'Pendle PT collateral yield is unavailable. A current, verified Implied APY is needed for Supply APR and monthly earnings; it is unknown, not zero.' };
    let ptExpiry: bigint | null = null;
    if (timestamp !== null) {
      try {
        const expiry = await client.readContract({ address: a.address as `0x${string}`, abi, functionName: 'expiry', blockNumber });
        // Reject missing/sentinel maturities; never infer expiry from a ticker or API failure.
        if (expiry > 0n && expiry <= 253402300799n) ptExpiry = expiry;
      } catch { /* An unreadable expiry cannot manufacture a matured token. */ }
    }
    if (ptExpiry !== null && timestamp !== null && ptExpiry <= BigInt(timestamp)) {
      quote.apr = 0; quote.estimated = false; expiredTokens.add(a.address.toLowerCase());
      quote.pendlePt!.expiry = Number(ptExpiry);
      quote.note = `This PT token's own contract confirms expiry at ${new Date(Number(ptExpiry) * 1000).toISOString()}. Its future price-accretion Supply APR is 0%, including bridged or retired PTs absent from the local Pendle catalog. Borrowing costs and token valuation remain separate.`;
    } else if (listedMarket && timestamp !== null && ptExpiry !== null) {
      const market = Date.parse(listedMarket.expiry) / 1000 > timestamp ? await ensurePendleMarketMetrics(listedMarket, network, timestamp, 'pt', refresh) : listedMarket;
      try {
        const [tokens, expiry] = await Promise.all([
          client.readContract({ address: market.address, abi, functionName: 'readTokens', blockNumber }),
          client.readContract({ address: market.address, abi, functionName: 'expiry', blockNumber }),
        ]);
        if (!same(tokens[0], market.sy.address) || !same(tokens[1], a.address) || !same(tokens[2], market.yt.address) || expiry !== ptExpiry || expiry !== BigInt(Date.parse(market.expiry) / 1000)) throw new Error('Unverified PT identity or maturity');
        const updated = Date.parse(market.dataUpdatedAt ?? '') / 1000;
        if (!Number.isFinite(updated) || updated > timestamp + 300 || timestamp - updated > 1800 || typeof market.impliedApy !== 'number' || !Number.isFinite(market.impliedApy) || market.impliedApy <= -1) throw new Error('Current PT Implied APY unavailable');
        quote.apr = market.impliedApy;
        quote.pendlePt!.marketAddress = market.address;
        quote.pendlePt!.expiry = Number(expiry);
        quote.pendlePt!.updatedAt = market.dataUpdatedAt!;
        quote.note = `Pendle Implied APY is used directly as Supply APR for this PT collateral, as requested, without converting APY to APR. Monthly earnings = supplied value × this rate ÷ 12. This estimates PT price appreciation toward expiry rather than an interest payment. Rate observed ${market.dataUpdatedAt}; expiry ${new Date(Number(expiry) * 1000).toISOString()}.`;
      } catch { /* Preserve balances and prices, but do not invent a PT yield. */ }
    }
    quotes.set(a.address.toLowerCase(), quote);
  }));
  return protocols.map(p => ({ ...p, positions: p.positions.map(position => ({ ...position, assets: position.assets.map(a => {
    const quote = a.supplied > 0 ? quotes.get(a.address.toLowerCase()) : undefined;
    if (!quote || (!a.collateral && !expiredTokens.has(a.address.toLowerCase()))) return a;
    // PT yield replaces the base supply rate; it is not an additional savings rate.
    const { intrinsicSupplyRate: _intrinsic, ...rest } = a;
    return { ...rest, supplyRate: quote };
  }) })) }));
}
