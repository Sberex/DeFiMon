import type { IntrinsicRate, NetworkId, ProtocolResult } from '../src/types.js';
// Ethereum/Arbitrum/Base: lidofinance/docs@a7b0f5bd52d13e55a7cfcb6bf152bb695ddf304c,
// docs/deployed-contracts/index.md. Plasma: bgd-labs/aave-address-book@
// 266429eefae828d52c91ffcb3a75656ab18f7160/src/AaveV3Plasma.sol (wstETH_UNDERLYING).
export const LIDO_WSTETH: Record<NetworkId, string> = {
  ethereum: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0',
  arbitrum: '0x5979d7b546e38e414f7e9822514be443a4800529',
  plasma: '0xe48d935e6c9e735463cccf29a7f11e32bc09136e',
  base: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452',
};
export const LIDO_APR_URL = 'https://eth-api.lido.fi/v1/protocol/steth/apr/sma';
const STETH = '0xae7ab96520de3a18e5e111b5eaab095312d7fe84';
const source: IntrinsicRate['source'] = { chain: 'Ethereum', oracle: '', kind: 'lido', url: 'https://lido.fi/', label: 'Lido stETH/wstETH staking APR (7-day average)', windowDays: 7 };
const unknown = (): IntrinsicRate => ({ apr: null, estimated: true, source: { ...source }, note: 'Lido’s current staking APR could not be verified. wstETH collateral earnings are unknown, not zero. Check eth-api.lido.fi and refresh.' });
export function createLidoRateService(fetcher: typeof fetch = fetch, now = Date.now) {
  let cache: { expires: number; promise: Promise<IntrinsicRate> } | undefined;
  async function load(): Promise<IntrinsicRate> {
    try {
      const response = await fetcher(LIDO_APR_URL, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; DeFiMon/0.1)' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Lido APR unavailable');
      const j = await response.json() as { data?: { smaApr?: number; aprs?: { timeUnix: number; apr: number }[] }; meta?: { chainId?: number; address?: string; symbol?: string } };
      const observations = j.data?.aprs;
      const timestamp = Math.floor(now() / 1000);
      if (j.meta?.chainId !== 1 || j.meta.address?.toLowerCase() !== STETH || j.meta.symbol !== 'stETH' || typeof j.data?.smaApr !== 'number' || !Number.isFinite(j.data.smaApr) || !Array.isArray(observations) || observations.length !== 7) throw new Error('Unverified Lido APR source');
      if (observations.some(o => !Number.isSafeInteger(o.timeUnix) || o.timeUnix > timestamp + 300 || timestamp - o.timeUnix > 10 * 86400 || typeof o.apr !== 'number' || !Number.isFinite(o.apr)) || new Set(observations.map(o => o.timeUnix)).size !== 7) throw new Error('Invalid Lido observations');
      const end = Math.max(...observations.map(o => o.timeUnix)), start = Math.min(...observations.map(o => o.timeUnix));
      const average = observations.reduce((sum, o) => sum + o.apr, 0) / observations.length;
      if (timestamp - end > 3 * 86400 || Math.abs(average - j.data.smaApr) > 0.000001) throw new Error('Stale or inconsistent Lido APR');
      return { apr: j.data.smaApr / 100, estimated: true, source: { ...source, startTimestamp: start, endTimestamp: end }, note: 'Lido’s published seven-day average stETH staking APR, after its protocol fee. The same staking yield accrues through wstETH’s stETH exchange rate. It is added once to the protocol supply APR for wstETH collateral and used in monthly earnings and NPL. This is an APR, not compounded APY. It is an estimate; staking yield and bridged-token market prices can change.' };
    } catch { return unknown(); }
  }
  return () => {
    if (cache && cache.expires > now()) return cache.promise;
    const entry = { expires: now() + 300000, promise: Promise.resolve().then(load) }; cache = entry;
    entry.promise = entry.promise.then(quote => { entry.expires = now() + (quote.apr === null ? 60000 : 300000); return quote; });
    return entry.promise;
  };
}
export const lidoStakingApr = createLidoRateService();
export async function applyLidoRates(protocols: ProtocolResult[], network: NetworkId, load = lidoStakingApr): Promise<ProtocolResult[]> {
  const matches = (a: ProtocolResult['positions'][number]['assets'][number]) => a.collateral && a.supplied > 0 && a.address.toLowerCase() === LIDO_WSTETH[network];
  if (!protocols.some(p => p.positions.some(p => p.assets.some(matches)))) return protocols;
  const quote = await load().catch(unknown);
  return protocols.map(p => ({ ...p, positions: p.positions.map(p => ({ ...p, assets: p.assets.map(a => matches(a) ? { ...a, intrinsicSupplyRate: quote } : a) })) }));
}
