import type { IntrinsicRate, NetworkId, ProtocolResult } from '../src/types.js';

// Lista's BSC slisBNB contract, also verified against this official Moolah market.
export const SLISBNB = '0xb0b84d294e0c75a6abe60171b70edeb2efd14a1b';
export const SLISBNB_MARKET = '0x95f93825819b67a64610e6adb9ac5f70d5108f5121b9df6551e23a4a7a801b5b';
export const SLISBNB_RATE_URL = `https://api.lista.org/api/moolah/market/${SLISBNB_MARKET}`;
const source: IntrinsicRate['source'] = { chain: 'Binance Smart Chain', oracle: '', kind: 'lista', url: 'https://lista.org/liquid-staking/BNB', label: 'Lista slisBNB collateral native yield APR' };
const unknown = (): IntrinsicRate => ({ apr: null, estimated: true, source: { ...source }, note: 'Lista’s current slisBNB native staking APR could not be verified. Collateral earnings are unknown, not zero. Check api.lista.org and refresh.' });
export function createSlisBnbRateService(fetcher: typeof fetch = fetch, now = Date.now) {
  let cache: { expires: number; promise: Promise<IntrinsicRate> } | undefined;
  async function load(): Promise<IntrinsicRate> {
    try {
      const response = await fetcher(SLISBNB_RATE_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Native yield unavailable');
      const j = await response.json() as { code?: string; timestamp?: number; data?: { marketId?: string; chain?: string; collateralToken?: string; collateralNativeApy?: string } };
      const d = j.data;
      if (j.code !== '000000000' || d?.marketId?.toLowerCase() !== SLISBNB_MARKET || d.chain !== 'bsc' || d.collateralToken?.toLowerCase() !== SLISBNB || typeof d.collateralNativeApy !== 'string' || !/^\d+(\.\d+)?$/.test(d.collateralNativeApy)) throw new Error('Unverified native yield');
      if (!Number.isSafeInteger(j.timestamp) || j.timestamp! > now() + 300000 || now() - j.timestamp! > 3600000) throw new Error('Stale native yield response');
      const apr = Number(d.collateralNativeApy);
      if (!Number.isFinite(apr) || apr < 0 || apr > 1) throw new Error('Invalid native yield');
      // Despite the API field name, Lista's lending UI labels this as
      // "Collateral Native Yield (APR)". It is already a fraction: .01519 = 1.519%.
      return { apr, estimated: true, source: { ...source, endTimestamp: Math.floor(j.timestamp! / 1000) }, note: 'Lista’s published slisBNB Collateral Native Yield (APR), from its official Moolah market API (collateralNativeApy, already a rate fraction). Staking yield accrues through slisBNB’s BNB redemption value. Added once to protocol Supply APR and used in monthly interest earned, NPL and position/portfolio APR; rewards remain separate. This is a variable estimate, not an additional token payment or guaranteed return.' };
    } catch { return unknown(); }
  }
  return () => {
    if (cache && cache.expires > now()) return cache.promise;
    const entry = { expires: now() + 300000, promise: Promise.resolve().then(load) }; cache = entry;
    entry.promise = entry.promise.then(quote => { entry.expires = now() + (quote.apr === null ? 60000 : 300000); return quote; });
    return entry.promise;
  };
}
export const slisBnbStakingApr = createSlisBnbRateService();
export async function applySlisBnbRates(protocols: ProtocolResult[], network: NetworkId, load = slisBnbStakingApr): Promise<ProtocolResult[]> {
  const matches = (a: ProtocolResult['positions'][number]['assets'][number]) => network === 'bsc' && a.collateral && a.supplied > 0 && a.address.toLowerCase() === SLISBNB;
  if (!protocols.some(p => p.positions.some(p => p.assets.some(matches)))) return protocols;
  const quote = await load().catch(unknown);
  return protocols.map(p => ({ ...p, positions: p.positions.map(p => ({ ...p, assets: p.assets.map(a => matches(a) ? { ...a, intrinsicSupplyRate: quote } : a) })) }));
}
