import type { NetworkId } from './types';
export interface PendleBaseAsset { chainId: number; address: string; symbol: string }
export interface PendleSafetyMarket { address: string; chainId: number; pt: string; yt: string; base: PendleBaseAsset }
export type PendleSafetyMap = Map<string, PendleBaseAsset>;
export const pendleChainIds: Record<NetworkId, number> = { ethereum: 1, plasma: 9745, arbitrum: 42161, base: 8453, bsc: 56, arc: 5042 };
const address = (v: unknown): v is string => typeof v === 'string' && /^0x[\da-f]{40}$/i.test(v) && !/^0x(?:0{40}|e{40})$/i.test(v);
export function pendleSafetyMarket(value: unknown, chainId: number): PendleSafetyMarket | null {
  const m = value as Record<string, any>;
  if (!m || m.chainId !== chainId || !address(m.address) || !address(m.pt?.address) || !address(m.yt?.address) || m.pt.chainId !== chainId || m.yt.chainId !== chainId) throw Error('Unverified Pendle market identity');
  const base = m.underlyingAsset;
  // An accounting/pricing currency does not establish the PT/YT's underlying risk.
  if (!base || !address(base.address) || !Number.isSafeInteger(base.chainId) || base.chainId <= 0 || typeof base.symbol !== 'string' || !base.symbol.trim() || base.symbol.length > 160) return null;
  return { address: m.address.toLowerCase(), chainId, pt: m.pt.address.toLowerCase(), yt: m.yt.address.toLowerCase(), base: { chainId: base.chainId, address: base.address.toLowerCase(), symbol: base.symbol } };
}
export function pendleSafetyMap(markets: PendleSafetyMarket[]): PendleSafetyMap {
  const result: PendleSafetyMap = new Map(), conflicts = new Set<string>();
  for (const market of markets) for (const token of [market.pt, market.yt]) {
    const old = result.get(token);
    if (old && (old.chainId !== market.base.chainId || old.address !== market.base.address)) conflicts.add(token);
    result.set(token, market.base);
  }
  for (const token of conflicts) result.delete(token);
  return result;
}
export async function loadPendleSafetyAssets(network: NetworkId, endpoint: string | null, fetcher: typeof fetch = fetch): Promise<PendleSafetyMap> {
  const chainId = pendleChainIds[network];
  if (network === 'arc') return new Map();
  const read = async (url: string) => {
    const response = await fetcher(url, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('Pendle base-asset lookup unavailable');
    return response.json();
  };
  if (endpoint) try {
    const data = await read(endpoint);
    if (data.chainId !== chainId || !Array.isArray(data.markets) || data.markets.length > 4000) throw Error();
    const markets = data.markets.map((m: PendleSafetyMarket) => pendleSafetyMarket({ ...m, pt: { address: m.pt, chainId }, yt: { address: m.yt, chainId }, underlyingAsset: m.base }, chainId));
    if (markets.some((m: PendleSafetyMarket | null) => !m)) throw Error();
    return pendleSafetyMap(markets);
  } catch { /* A static/newer frontend can use Pendle's public CORS-enabled catalog. */ }
  const markets: PendleSafetyMarket[] = [], seen = new Set<string>();
  let total = -1;
  for (let skip = 0; skip < 4000; skip += 100) {
    const data = await read(`https://api-v2.pendle.finance/core/v1/${chainId}/markets?limit=100&skip=${skip}`);
    if (!Number.isInteger(data.total) || data.total < 0 || data.total > 4000 || !Array.isArray(data.results) || data.results.length !== Math.min(100, data.total - skip) || total !== -1 && data.total !== total) throw Error('Incomplete Pendle catalog');
    total = data.total;
    for (const row of data.results) {
      if (seen.has(row.address?.toLowerCase())) throw Error('Duplicate Pendle market');
      const market = pendleSafetyMarket(row, chainId); seen.add(row.address.toLowerCase()); if (market) markets.push(market);
    }
    if (seen.size === total) return pendleSafetyMap(markets);
  }
  throw Error('Pendle catalog exceeds lookup limit');
}
