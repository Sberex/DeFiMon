import { getAddress, isAddress, type Address, type Hex } from 'viem';
// Schema/endpoint: morpho-org/sdks@56f1ed62827a7aab39d979c0143d1fbf970c37ca,
// packages/liquidity-sdk-viem/src/api/types.ts and morpho-ts/src/urls.ts.
export const MORPHO_API = 'https://api.morpho.org/graphql';
export const MORPHO_BLUE = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';
export interface MorphoToken { address: Address; symbol: string; decimals: number; priceUsd: number | null }
export interface MorphoMarketRef { id: Hex; loan: MorphoToken; collateral: MorphoToken | null }
export interface MorphoVaultRef { address: Address; name: string; asset: MorphoToken; factory: Address; version: 1 | 2 }
export interface MorphoDiscovery { markets: MorphoMarketRef[]; vaults: MorphoVaultRef[]; warnings: string[]; successfulFamilies: number }
const tokenFields = 'address symbol decimals priceUsd';
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
 users(first: 2, where: {chainId_in: [1], address_in: [$wallet]}) {
  items { ${userFields} vaultV2Positions { user { ${userFields} } vault { address name chain { id } factory { address } asset { ${tokenFields} } } }
  }
  pageInfo { count countTotal skip limit }
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
function user(value: unknown, wallet: Address) {
  const u = object(value);
  if (!same(address(u.address), wallet) || object(u.chain).id !== 1) throw new Error('Morpho returned another wallet or network');
}
function token(value: unknown): MorphoToken {
  const t = object(value);
  if (!Number.isInteger(t.decimals) || Number(t.decimals) < 0 || Number(t.decimals) > 36 || typeof t.symbol !== 'string' || t.symbol.length > 128) throw new Error('Invalid Morpho token metadata');
  return { address: address(t.address), symbol: t.symbol, decimals: Number(t.decimals), priceUsd: typeof t.priceUsd === 'number' && Number.isFinite(t.priceUsd) && t.priceUsd > 0 ? t.priceUsd : null };
}
function marketRow(value: unknown, wallet: Address): MorphoMarketRef {
  const row = object(value); user(row.user, wallet);
  const m = object(row.market); const core = object(m.morphoBlue);
  if (!same(address(core.address), MORPHO_BLUE) || object(core.chain).id !== 1 || typeof m.uniqueKey !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(m.uniqueKey)) throw new Error('Invalid Morpho market');
  return { id: m.uniqueKey as Hex, loan: token(m.loanAsset), collateral: m.collateralAsset === null ? null : token(m.collateralAsset) };
}
function vaultRow(value: unknown, wallet: Address, version: 1 | 2): MorphoVaultRef {
  const row = object(value); user(row.user, wallet); const v = object(row.vault);
  if (object(v.chain).id !== 1 || typeof v.name !== 'string' || v.name.length > 256) throw new Error('Invalid Morpho vault');
  return { address: address(v.address), name: v.name, asset: token(v.asset), factory: address(object(v.factory).address), version };
}
function pageInfo(value: unknown, items: unknown[], skip: number) {
  const p = object(value);
  if (![p.count, p.countTotal, p.skip, p.limit].every(n => Number.isSafeInteger(n) && Number(n) >= 0) || p.skip !== skip || p.count !== items.length || Number(p.countTotal) < items.length + skip) throw new Error('Incomplete Morpho pagination');
  return Number(p.countTotal);
}
export async function fetchMorphoDiscovery(wallet: Address, fetcher: typeof fetch = fetch): Promise<MorphoDiscovery> {
  const warnings = new Set<string>();
  async function query(document: string, variables: Record<string, unknown>): Promise<Obj> {
    const response = await fetcher(MORPHO_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: document, variables }), signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!response.ok) throw new Error('Morpho lookup unavailable');
    const text = await response.text();
    if (text.length > 4_000_000) throw new Error('Morpho response too large');
    const envelope = object(JSON.parse(text));
    if (envelope.errors !== undefined && (!Array.isArray(envelope.errors) || envelope.errors.length > 0)) {
      // Current SDK queries use marketId; older API schema snapshots expose uniqueKey.
      const oldSchema = Array.isArray(envelope.errors) && envelope.errors.some(e => e && typeof e === 'object' && typeof e.message === 'string' && /Cannot query field ["']marketId["']/.test(e.message));
      if (oldSchema && document.includes('uniqueKey: marketId')) return query(document.replace('uniqueKey: marketId', 'uniqueKey'), variables);
      throw new Error('Morpho GraphQL query failed');
    }
    return object(envelope.data);
  }
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
    pages('marketPositions', MORPHO_MARKETS_QUERY, row => marketRow(row, wallet), m => m.id),
    pages('vaultPositions', MORPHO_VAULTS_QUERY, row => vaultRow(row, wallet, 1), v => v.address),
    (async () => {
      const data = await query(MORPHO_V2_QUERY, { wallet }); const container = object(data.users);
      if (!Array.isArray(container.items)) throw new Error('Missing Morpho users');
      const total = pageInfo(container.pageInfo, container.items, 0);
      if (total > 1 || total !== container.items.length) throw new Error('Ambiguous Morpho user');
      if (!total) return [] as MorphoVaultRef[];
      const u = object(container.items[0]); user(u, wallet);
      if (!Array.isArray(u.vaultV2Positions)) throw new Error('Missing vault V2 positions');
      const vaults = new Map<string, MorphoVaultRef>();
      for (const row of u.vaultV2Positions) {
        try { const v = vaultRow(row, wallet, 2); vaults.set(v.address.toLowerCase(), v); }
        catch { warnings.add('Some Morpho vault V2 lookup results were invalid; coverage is incomplete.'); }
      }
      return [...vaults.values()];
    })(),
  ]);
  const names = ['market', 'vault V1', 'vault V2'];
  results.forEach((r, i) => { if (r.status === 'rejected') warnings.add(`Morpho ${names[i]} lookup is unavailable. Those positions and balances have not been checked.`); });
  return { markets: results[0].status === 'fulfilled' ? results[0].value : [], vaults: [...(results[1].status === 'fulfilled' ? results[1].value : []), ...(results[2].status === 'fulfilled' ? results[2].value : [])], warnings: [...warnings], successfulFamilies: results.filter(r => r.status === 'fulfilled').length };
}
