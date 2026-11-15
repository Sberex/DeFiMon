import { toMorphoFailure, type MorphoFailure } from './morpho-errors.js';
import type { NetworkId } from '../src/types.js';
import { networks } from './networks.js';
import { getAddress, isAddress, type Address, type Hex } from 'viem';
// Deployment/reference schema: morpho-org/sdks@56f1ed62827a7aab39d979c0143d1fbf970c37ca.
// Current Asset.price { usd timestamp } and userByAddress confirmed by public API
// introspection supplied from the user's local diagnostic (2026-11-13).
export { MORPHO_API } from './morpho-api.js';
import { createMorphoQuery } from './morpho-api.js';
export const MORPHO_BLUE = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';
export interface MorphoToken { address: Address; symbol: string; decimals: number; priceUsd: number | null }
export interface MorphoMarketRef { id: Hex; loan: MorphoToken; collateral: MorphoToken | null }
export interface MorphoVaultRef { address: Address; name: string; asset: MorphoToken; factory: Address; version: 1 | 2; roles?: ('creator' | 'curator' | 'owner')[] }
export interface MorphoDiscovery { markets: MorphoMarketRef[]; vaults: MorphoVaultRef[]; warnings: string[]; successfulFamilies: number; holdingsComplete?: boolean; failures?: MorphoFailure[] }
const currentPriceFields = 'price { usd timestamp }';
const tokenFields = `address symbol decimals ${currentPriceFields}`;
const userFields = 'address chain { id }';
export const MORPHO_MARKETS_QUERY = `query WalletMarkets($wallet: String!, $first: Int!, $skip: Int!) {
 marketPositions(first: $first, skip: $skip, orderBy: SupplyShares, orderDirection: Desc, where: {chainId_in: [1], userAddress_in: [$wallet]}) {
  items { user { ${userFields} } market { uniqueKey: marketId morphoBlue { address chain { id } } loanAsset { ${tokenFields} } collateralAsset { ${tokenFields} } } }
  pageInfo { count countTotal skip limit }
 }
}`;
export const MORPHO_VAULTS_QUERY = `query WalletVaults($wallet: String!, $first: Int!, $skip: Int!) {
 vaultPositions(first: $first, skip: $skip, orderBy: Shares, orderDirection: Desc, where: {chainId_in: [1], userAddress_in: [$wallet]}) {
  items { user { ${userFields} } vault { address name chain { id } factory { address } asset { ${tokenFields} } } }
  pageInfo { count countTotal skip limit }
 }
}`;
export const MORPHO_V2_QUERY = `query WalletVaultsV2($wallet: String!) {
 userByAddress(address: $wallet, chainId: 1) {
  ${userFields} vaultV2Positions { user { ${userFields} } vault { address name chain { id } factory { address } asset { ${tokenFields} } } }
 }
}`;
type Obj = Record<string, unknown>;
function object(value: unknown): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Morpho response');
  return value as Obj;
}
function address(value: unknown): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) throw new Error('Invalid Morpho address');
  return getAddress(value.toLowerCase());
}
function same(a: Address, b: Address) { return a.toLowerCase() === b.toLowerCase(); }
function user(value: unknown, wallet: Address, chainId: number) {
  const u = object(value);
  if (!same(address(u.address), wallet) || object(u.chain).id !== chainId) throw new Error('Morpho returned another wallet or network');
}
function token(value: unknown): MorphoToken {
  const t = object(value);
  if (!Number.isInteger(t.decimals) || Number(t.decimals) < 0 || Number(t.decimals) > 36 || typeof t.symbol !== 'string' || t.symbol.length > 128) throw new Error('Invalid Morpho token metadata');
  // A present but null/invalid current price must stay unknown, even if an older
  // price field also appears. USD display prices never determine liquidation health.
  const price = t.price === undefined ? t.priceUsd : t.price && typeof t.price === 'object' && !Array.isArray(t.price) ? (t.price as Obj).usd : null;
  return { address: address(t.address), symbol: t.symbol, decimals: Number(t.decimals), priceUsd: typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null };
}
function marketRow(value: unknown, wallet: Address, chainId: number, morphoBlue: Address): MorphoMarketRef {
  const row = object(value); user(row.user, wallet, chainId);
  const m = object(row.market); const core = object(m.morphoBlue);
  if (!same(address(core.address), morphoBlue) || object(core.chain).id !== chainId || typeof m.uniqueKey !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(m.uniqueKey)) throw new Error('Invalid Morpho market');
  return { id: m.uniqueKey as Hex, loan: token(m.loanAsset), collateral: m.collateralAsset === null ? null : token(m.collateralAsset) };
}
function vaultRow(value: unknown, wallet: Address, version: 1 | 2, chainId: number): MorphoVaultRef {
  const row = object(value); user(row.user, wallet, chainId); const v = object(row.vault);
  if (object(v.chain).id !== chainId || typeof v.name !== 'string' || v.name.length > 256) throw new Error('Invalid Morpho vault');
  return { address: address(v.address), name: v.name, asset: token(v.asset), factory: address(object(v.factory).address), version };
}
function pageInfo(value: unknown, items: unknown[], skip: number) {
  const p = object(value);
  if (![p.count, p.countTotal, p.skip, p.limit].every(n => Number.isSafeInteger(n) && Number(n) >= 0) || p.skip !== skip || p.count !== items.length || Number(p.countTotal) < items.length + skip) throw new Error('Incomplete Morpho pagination');
  return Number(p.countTotal);
}
export async function fetchMorphoDiscovery(wallet: Address, fetcher: typeof fetch = fetch, network: NetworkId = 'ethereum'): Promise<MorphoDiscovery> {
  const chainId = networks[network].id;
  const morphoBlue = networks[network].morphoBlue;
  if (!morphoBlue) throw new Error('Morpho is not supported on this network.');
  const warnings = new Set<string>();
  const query = createMorphoQuery(fetcher, network, warnings);
  async function pages<T>(field: string, document: string, parse: (value: unknown) => T, key: (value: T) => string): Promise<T[]> {
    const items = new Map<string, T>(); let skip = 0; let previousTotal: number | undefined;
    for (let page = 0; page < 20; page++) {
      try {
        const data = await query(document, { wallet, first: 100, skip });
        const container = object(data[field]);
        if (!Array.isArray(container.items)) throw new Error('Missing Morpho results');
        const total = pageInfo(container.pageInfo, container.items, skip);
        if (previousTotal !== undefined && total !== previousTotal) warnings.add('Morpho lookup changed during pagination. Refresh to recheck complete coverage.');
        previousTotal = total;
        let duplicates = false;
        for (const row of container.items) {
          try { const parsed = parse(row); const id = key(parsed).toLowerCase(); duplicates ||= items.has(id); items.set(id, parsed); }
          catch { warnings.add('Some Morpho lookup results could not be verified and were excluded. Coverage is incomplete.'); }
        }
        if (duplicates) warnings.add('Morpho returned duplicate lookup rows. They were counted once; complete discovery could not be confirmed.');
        skip += container.items.length;
        if (skip >= total) return [...items.values()];
        if (!container.items.length) throw new Error('Morpho pagination made no progress');
      } catch (error) {
        if (page === 0) throw error;
        warnings.add('Morpho lookup stopped before all pages were read. Earlier verified entries are retained; additional positions may be missing.');
        return [...items.values()];
      }
    }
    warnings.add('Morpho lookup exceeded the per-request pagination limit. Additional positions may be missing.');
    return [...items.values()];
  }
  const results = await Promise.allSettled([
    pages('marketPositions', MORPHO_MARKETS_QUERY, row => marketRow(row, wallet, chainId, morphoBlue), m => m.id),
    pages('vaultPositions', MORPHO_VAULTS_QUERY, row => vaultRow(row, wallet, 1, chainId), v => v.address),
    (async () => {
      const data = await query(MORPHO_V2_QUERY, { wallet });
      // A missing/null entity is not proof that all V2 holdings have been checked.
      const u = object(data.userByAddress); user(u, wallet, chainId);
      if (!Array.isArray(u.vaultV2Positions)) throw new Error('Missing vault V2 positions');
      const vaults = new Map<string, MorphoVaultRef>();
      for (const row of u.vaultV2Positions) {
        try { const v = vaultRow(row, wallet, 2, chainId); vaults.set(v.address.toLowerCase(), v); }
        catch { warnings.add('Some Morpho vault V2 lookup results were invalid; coverage is incomplete.'); }
      }
      return [...vaults.values()];
    })(),
  ]);
  const names = ['market', 'vault V1', 'vault V2'];
  results.forEach((r, i) => { if (r.status === 'rejected') warnings.add(`Morpho ${names[i]} lookup is unavailable. Those positions and balances have not been checked.`); });
  return { markets: results[0].status === 'fulfilled' ? results[0].value : [], vaults: [...(results[1].status === 'fulfilled' ? results[1].value : []), ...(results[2].status === 'fulfilled' ? results[2].value : [])], warnings: [...warnings], successfulFamilies: results.filter(r => r.status === 'fulfilled').length, failures: results.flatMap((r, i) => r.status === 'rejected' ? [toMorphoFailure(names[i], r.reason)] : []) };
}

export { token as parseMorphoToken };
