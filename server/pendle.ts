import { formatUnits, isAddress, parseAbi, type Address } from 'viem';
import type { NetworkId, PendleCoverage, PendleTokenInfo, WalletBalances, WalletToken } from '../src/types.js';
import { networks } from './networks.js';
import type { ChainClient } from './rpc.js';
// pendle-finance/pendle-core-v2-public@82e69f0b2279c85f250a87cb0fe16a2b432ebb72
// deployments/{1,9745,42161,8453}-core.json: pyYtLpOracle. See IPPYLpOracle,
// IPMarket, IStandardizedYield and PendlePYOracleLib at the same revision.
export const PENDLE_ORACLE = '0x5542be50420E88dd7D5B4a3D488FA6ED82F6DAc2' as Address;
export const PENDLE_COVERAGE = 'Pendle V2 PT/YT tokens held directly in this wallet, including expired markets returned by Pendle’s catalog. Excludes LP/staked positions, claimable interest and rewards, and tokens held inside other protocols. Values enter Wallet tokens once. Direct wallet APYs are market metrics; PT collateral yield is included separately in lending estimates.';
const abi = parseAbi([
  'function balanceOf(address) view returns(uint256)', 'function decimals() view returns(uint8)',
  'function readTokens() view returns(address,address,address)', 'function expiry() view returns(uint256)',
  'function assetInfo() view returns(uint8,address,uint8)',
  'function getPtToAssetRate(address,uint32) view returns(uint256)', 'function getYtToAssetRate(address,uint32) view returns(uint256)',
]);
type ApiToken = { address: Address; symbol: string; decimals: number; chainId: number; price?: { usd?: number }; priceUpdatedAt?: string; proName?: string };
export type PendleMarket = { address: Address; chainId: number; pt: ApiToken; yt: ApiToken; sy: ApiToken; accountingAsset: ApiToken; expiry: string; impliedApy?: number; underlyingApy?: number; liquidity?: { usd?: number }; dataUpdatedAt?: string };
export interface PendleRead { tokens: WalletToken[]; coverage: PendleCoverage }
const addr = (a: unknown): a is Address => typeof a === 'string' && isAddress(a, { strict: false }) && !/^0x0{40}$/i.test(a);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const positive = (v: unknown) => { const n = num(v); return n !== null && n > 0 ? n : null; };
function fresh(date: unknown, timestamp: number) { const t = typeof date === 'string' ? Date.parse(date) / 1000 : NaN; return Number.isFinite(t) && t <= timestamp + 300 && timestamp - t <= 1800; }
export function unavailablePendle(network: NetworkId, block?: bigint): PendleRead {
  return { tokens: [], coverage: { status: 'error', coverage: PENDLE_COVERAGE, balanceDiscoveryComplete: false, marketCount: 0, blockNumber: block === undefined ? null : String(block), message: `Pendle token discovery is unavailable on ${networks[network].name}. Check api-v2.pendle.finance and this network’s provider. PT/YT holdings have not been fully checked.` } };
}
export function createPendleCatalog(fetcher: typeof fetch = fetch, now = Date.now) {
  const cache = new Map<NetworkId, { expires: number; promise: Promise<PendleMarket[]> }>();
  async function load(network: NetworkId) {
    const markets: PendleMarket[] = [], seen = new Set<string>();
    let total = 0;
    for (let skip = 0; skip < 4000; skip += 100) {
      const response = await fetcher(`https://api-v2.pendle.finance/core/v1/${networks[network].id}/markets?limit=100&skip=${skip}`, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; DeFiMon/0.1)' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Pendle catalog unavailable');
      const data = await response.json() as { total?: number; results?: PendleMarket[] };
      if (!Number.isInteger(data.total) || data.total! < 0 || data.total! > 4000 || !Array.isArray(data.results) || data.results.length > 100) throw new Error('Invalid Pendle catalog');
      if (skip === 0) total = data.total!;
      if (data.total !== total || data.results.length !== Math.min(100, total - skip)) throw new Error('Incomplete Pendle catalog');
      for (const m of data.results) {
        const validToken = (t: ApiToken, accounting = false) => t && (addr(t.address) || (accounting && /^0x0{40}$/i.test(t.address) && t.symbol === networks[network].nativeSymbol && t.decimals === 18)) && (accounting ? Number.isInteger(t.chainId) && t.chainId > 0 : t.chainId === networks[network].id) && typeof t.symbol === 'string' && t.symbol.length <= 160 && Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 36;
        if (!addr(m.address) || m.chainId !== networks[network].id || !([m.pt, m.yt, m.sy].every(t => validToken(t)) && validToken(m.accountingAsset, true)) || !Number.isFinite(Date.parse(m.expiry)) || seen.has(m.address.toLowerCase())) throw new Error('Unverified Pendle market identity');
        seen.add(m.address.toLowerCase()); markets.push(m);
      }
      if (markets.length === total) return markets;
    }
    throw new Error('Pendle catalog exceeds discovery limit');
  }
  return async (network: NetworkId) => {
    const entry = cache.get(network); if (entry && entry.expires > now()) return entry.promise;
    const next = { expires: now() + 300000, promise: load(network) }; cache.set(network, next);
    next.promise.catch(() => { if (cache.get(network) === next) cache.delete(network); });
    return next.promise;
  };
}
export const pendleCatalog = createPendleCatalog();
export async function readPendle(client: ChainClient, wallet: Address, blockNumber: bigint, network: NetworkId, catalog = pendleCatalog): Promise<PendleRead> {
  try {
    const markets = await catalog(network);
    const selected = new Map<string, { token: ApiToken; market: PendleMarket; kind: 'PT' | 'YT' }>();
    for (const market of markets) for (const kind of ['PT', 'YT'] as const) {
      const token = kind === 'PT' ? market.pt : market.yt, key = token.address.toLowerCase(), old = selected.get(key);
      if (!old || (num(market.liquidity?.usd) ?? 0) > (num(old.market.liquidity?.usd) ?? 0)) selected.set(key, { token, market, kind });
    }
    const entries = [...selected.values()], warnings = new Set<string>();
    if (!entries.length) return { tokens: [], coverage: { status: 'ok', coverage: PENDLE_COVERAGE, balanceDiscoveryComplete: true, marketCount: 0, blockNumber: String(blockNumber) } };
    const [balances, block] = await Promise.all([
      client.multicall({ contracts: entries.map(e => ({ address: e.token.address, abi, functionName: 'balanceOf' as const, args: [wallet] as const })), blockNumber, allowFailure: true, batchSize: 8192 }),
      client.getBlock({ blockNumber }),
    ]);
    if (balances.length !== entries.length) throw new Error('Incomplete token balances');
    const timestamp = Number(block.timestamp), tokens: WalletToken[] = [];
    // Small worker pool bounds held-market RPCs without dropping any held token.
    const held = entries.flatMap((entry, i) => {
      const b = balances[i];
      if (b.status !== 'success') { warnings.add('Some PT/YT balances could not be checked. Those holdings are unknown.'); return []; }
      return b.result > 0n ? [{ ...entry, raw: b.result }] : [];
    });
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, held.length) }, async () => {
      while (next < held.length) {
        const { token, market, kind, raw } = held[next++];
        const notes = ['The oracle price uses Pendle’s current pool price at the displayed block. It is not time-averaged and can differ from the price received in a swap.'];
        let balance: number | null = null, oraclePrice: number | null = null, expiry: number | null = null;
        try {
          const [onchainTokens, onchainExpiry, decimals, asset] = await Promise.all([
            client.readContract({ address: market.address, abi, functionName: 'readTokens', blockNumber }),
            client.readContract({ address: market.address, abi, functionName: 'expiry', blockNumber }),
            client.readContract({ address: token.address, abi, functionName: 'decimals', blockNumber }),
            client.readContract({ address: market.sy.address, abi, functionName: 'assetInfo', blockNumber }),
          ]);
          if (!same(onchainTokens[0], market.sy.address) || !same(onchainTokens[1], market.pt.address) || !same(onchainTokens[2], market.yt.address) || onchainExpiry !== BigInt(Date.parse(market.expiry) / 1000) || !same(asset[1], market.accountingAsset.address) || asset[2] !== market.accountingAsset.decimals || decimals !== token.decimals || decimals !== asset[2]) throw new Error('Pendle on-chain identity or units mismatch');
          balance = Number(formatUnits(raw, decimals)); expiry = Number(onchainExpiry);
          try {
            const quote = await client.readContract({ address: PENDLE_ORACLE, abi, functionName: kind === 'PT' ? 'getPtToAssetRate' : 'getYtToAssetRate', args: [market.address, 0], blockNumber });
            oraclePrice = num(Number(formatUnits(quote, 18)));
          } catch { notes.push('Current oracle price is unavailable; token value is unknown, not zero.'); }
        } catch { warnings.add('Some held PT/YT token identities, units or expiry could not be verified on chain. Their values are unknown.'); notes.push('Contract identity, token units or expiry could not be verified. No API-only balance or price is substituted.'); }
        const matured = expiry === null ? null : expiry <= timestamp;
        const currentData = fresh(market.dataUpdatedAt, timestamp);
        const quoteUsd = fresh(market.accountingAsset.priceUpdatedAt, timestamp) ? positive(market.accountingAsset.price?.usd) : null;
        const priceUsd = oraclePrice === 0 ? 0 : oraclePrice !== null && quoteUsd !== null ? num(oraclePrice * quoteUsd) : null;
        const quoteValue = balance !== null && oraclePrice !== null ? num(balance * oraclePrice) : null;
        const valueUsd = balance !== null && priceUsd !== null ? num(balance * priceUsd) : null;
        if (market.accountingAsset.chainId !== networks[network].id) notes.push(`The accounting unit references ${market.accountingAsset.symbol} on ${Object.values(networks).find(n => n.id === market.accountingAsset.chainId)?.name ?? `chain ${market.accountingAsset.chainId}`}. The market contract confirms this accounting unit for its prices.`);
        const details: PendleTokenInfo = { kind, name: typeof token.proName === 'string' ? token.proName : token.symbol, marketAddress: market.address, syAddress: market.sy.address, quoteAsset: { address: market.accountingAsset.address, symbol: market.accountingAsset.symbol }, oraclePrice, quoteValue, impliedApy: currentData && matured === false ? num(market.impliedApy) : null, underlyingApy: currentData && matured === false ? num(market.underlyingApy) : null, tvlUsd: currentData && num(market.liquidity?.usd) !== null && market.liquidity!.usd! >= 0 ? market.liquidity!.usd! : null, expiry, matured, oracleAddress: PENDLE_ORACLE, blockNumber: String(blockNumber), marketUpdatedAt: currentData ? market.dataUpdatedAt! : null, notes };
        if (priceUsd === null || valueUsd === null) warnings.add('Some held PT/YT values are unavailable. Wallet totals include only priced amounts.');
        if (!currentData) notes.push('Pendle APY/TVL metadata is missing or older than 30 minutes; those metrics are unknown.');
        if (matured) notes.push(kind === 'YT' ? 'Expired YT has no future yield value. Any unclaimed accrued interest or rewards are separate and excluded.' : 'Expired PT uses the current oracle redemption rate, including any underlying loss adjustment. No $1 peg is assumed.');
        tokens.push({ address: token.address, symbol: token.symbol, balance, priceUsd, valueUsd, pendle: details });
      }
    }));
    tokens.sort((a, b) => a.address.localeCompare(b.address));
    return { tokens, coverage: { status: warnings.size ? 'partial' : 'ok', coverage: PENDLE_COVERAGE, message: warnings.size ? [...warnings].join(' ') : undefined, balanceDiscoveryComplete: balances.every(b => b.status === 'success'), marketCount: markets.length, blockNumber: String(blockNumber) } };
  } catch { return unavailablePendle(network, blockNumber); }
}
/** Pendle is wallet-held token value, separate from lending balances and NPL. */
export function mergePendleWallet(wallet: WalletBalances, pendle: PendleRead): WalletBalances {
  const replacements = new Set(pendle.tokens.map(t => t.address.toLowerCase()));
  const previousUnknown = wallet.tokens.filter(t => !t.excludedReason && t.valueUsd === null).length;
  const missingDiscovery = Math.max(0, wallet.unpricedCount - previousUnknown);
  const tokens = [...wallet.tokens.filter(t => !replacements.has(t.address.toLowerCase())), ...pendle.tokens];
  const known = tokens.filter(t => !t.excludedReason && t.valueUsd !== null);
  const total = known.reduce((sum, t) => sum + t.valueUsd!, 0);
  return { ...wallet, tokens, pendle: pendle.coverage, status: wallet.status === 'error' && !pendle.tokens.length ? 'error' : wallet.status === 'ok' && pendle.coverage.status === 'ok' ? 'ok' : 'partial', pricedValueUsd: known.length && Number.isFinite(total) ? total : wallet.pricedValueUsd === 0 ? 0 : null, unpricedCount: missingDiscovery + tokens.filter(t => !t.excludedReason && t.valueUsd === null).length, message: [wallet.message, pendle.coverage.message].filter(Boolean).join(' ') || undefined };
}
