import type { ChainName, Portfolio, Position } from './types';
import { annualizedNplApr, positionMonthlyInterest } from './monthly-interest';
import { isBadDebtPosition } from './risk-assessment';
import { networkNames, portfolioNetwork } from './networks';
import tokenMatches from '../config/token-matches.json' with { type: 'json' };

// Only explicit configured chain/contract pairs establish cross-network identity.
const configuredAssetGroups = new Map<string, string>();
for (const [group, contracts] of Object.entries(tokenMatches as Record<string, Record<string, unknown>>)) {
  for (const [network, chain] of Object.entries(networkNames)) {
    const contract = contracts[network];
    if (typeof contract === 'string' && /^0x[\da-f]{40}$/i.test(contract)) configuredAssetGroups.set(`${chain}:${contract.toLowerCase()}`, group);
  }
}
export const COOKBOOK_MIN_APR = .14;
export interface CookbookPosition {
  snapshotAt: string; blockNumber?: string | null; apr: number; netValueUsd: number; monthlyNplUsd: number;
  verification: 'verified' | 'unavailable'; position: Position;
}
export interface CookbookScope {
  protocolId: string; protocolName: string; chain: ChainName;
  checkedAt: string; blockNumber: string | null; complete: boolean; positions: CookbookPosition[];
}
export interface CookbookFile {
  schemaVersion: 1; minimumApr: number; updatedAt: string | null;
  wallets: { address: string; scopes: CookbookScope[] }[];
}
export interface CookbookResponse {
  data: CookbookFile; persistence: { mode: 'github' | 'local'; synced: boolean; message?: string };
}
export const emptyCookbook = (): CookbookFile => ({ schemaVersion: 1, minimumApr: COOKBOOK_MIN_APR, updatedAt: null, wallets: [] });
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const date = (s: unknown): s is string => typeof s === 'string' && Number.isFinite(Date.parse(s));
const address = (s: unknown): s is string => typeof s === 'string' && /^0x[\da-f]{40}$/i.test(s) && !/^0x0{40}$/i.test(s);
function newer(a: Pick<CookbookScope, 'checkedAt' | 'blockNumber'>, b: Pick<CookbookScope, 'checkedAt' | 'blockNumber'>) {
  if (a.blockNumber !== null && b.blockNumber !== null && BigInt(a.blockNumber) !== BigInt(b.blockNumber)) return BigInt(a.blockNumber) > BigInt(b.blockNumber);
  return Date.parse(a.checkedAt) > Date.parse(b.checkedAt);
}
const scopeKey = (s: CookbookScope) => `${s.chain}:${s.protocolId}`;
export function parseCookbook(value: unknown): CookbookFile {
  const f = value as CookbookFile;
  if (!f || f.schemaVersion !== 1 || f.minimumApr !== COOKBOOK_MIN_APR || !Array.isArray(f.wallets) || f.updatedAt !== null && !date(f.updatedAt)) throw new Error('Invalid Cookbook file');
  const wallets = new Set<string>();
  for (const w of f.wallets) {
    if (!address(w.address) || !Array.isArray(w.scopes) || wallets.has(w.address.toLowerCase())) throw new Error('Invalid Cookbook wallet');
    wallets.add(w.address.toLowerCase()); const scopes = new Set<string>();
    for (const s of w.scopes) {
      if (!Object.values(networkNames).includes(s.chain) || typeof s.protocolId !== 'string' || !s.protocolId || typeof s.protocolName !== 'string' || !date(s.checkedAt) || !Array.isArray(s.positions) || typeof s.complete !== 'boolean' || s.blockNumber !== null && !/^\d+$/.test(s.blockNumber) || scopes.has(scopeKey(s))) throw new Error('Invalid Cookbook scope');
      scopes.add(scopeKey(s)); const positions = new Set<string>();
      for (const p of s.positions) {
        if (!date(p.snapshotAt) || !finite(p.apr) || p.apr <= COOKBOOK_MIN_APR || !finite(p.netValueUsd) || p.netValueUsd <= 0 || !finite(p.monthlyNplUsd) || !['verified', 'unavailable'].includes(p.verification) || !p.position || typeof p.position.id !== 'string' || typeof p.position.label !== 'string' || !Array.isArray(p.position.assets) || !Array.isArray(p.position.notes) || positions.has(p.position.id.toLowerCase())) throw new Error('Invalid Cookbook position');
        positions.add(p.position.id.toLowerCase());
      }
    }
  }
  return structuredClone(f);
}
/** Replace only the scopes actually checked; unread data never proves a position disappeared. */
export function updateCookbook(file: CookbookFile, portfolio: Portfolio): CookbookFile {
  if (!address(portfolio.address)) throw new Error('Invalid snapshot wallet');
  const result = structuredClone(file), walletAddress = portfolio.address.toLowerCase();
  let wallet = result.wallets.find(w => w.address.toLowerCase() === walletAddress);
  const next = new Map((wallet?.scopes ?? []).map(s => [scopeKey(s), s]));
  for (const protocol of portfolio.protocols) {
    const chain = protocol.chain ?? networkNames[portfolioNetwork(portfolio.chain)];
    const snapshot = portfolio.networks?.find(n => n.chain === chain);
    const checkedAt = snapshot?.updatedAt ?? portfolio.updatedAt;
    if (!date(checkedAt)) continue;
    const key = `${chain}:${protocol.id}`, previous = next.get(key);
    const blockNumber = snapshot?.blockNumber ?? portfolio.blockNumber;
    if (previous && newer(previous, { checkedAt, blockNumber })) continue;
    const complete = protocol.status === 'ok' && protocol.balanceDiscoveryComplete !== false || protocol.balanceDiscoveryComplete === true;
    const positions = new Map((previous?.positions ?? []).map(p => [p.position.id.toLowerCase(), { ...p, blockNumber: p.blockNumber ?? previous?.blockNumber ?? null, verification: 'unavailable' as const } as CookbookPosition]));
    const seen = new Set<string>();
    for (const position of protocol.positions) {
      const id = position.id.toLowerCase(); seen.add(id);
      if (isBadDebtPosition(protocol.id, position)) { positions.delete(id); continue; }
      const net = finite(position.suppliedUsd) && finite(position.debtUsd) ? position.suppliedUsd - position.debtUsd : null;
      const monthly = positionMonthlyInterest(position).nplUsd;
      const apr = annualizedNplApr(monthly, net);
      if (position.assets.length && position.assets.every(a => a.supplied === 0 && a.borrowed === 0) || finite(net) && net <= 0) { positions.delete(id); continue; }
      if (!finite(apr) || !finite(monthly) || !finite(net)) continue;
      if (apr <= COOKBOOK_MIN_APR + 1e-12) { positions.delete(id); continue; }
      positions.set(id, { snapshotAt: checkedAt, blockNumber: snapshot?.blockNumber ?? portfolio.blockNumber, apr, netValueUsd: net, monthlyNplUsd: monthly, verification: 'verified', position: structuredClone(position) });
    }
    if (complete) for (const id of positions.keys()) if (!seen.has(id)) positions.delete(id);
    if (previous || positions.size) next.set(key, { protocolId: protocol.id, protocolName: protocol.name, chain, checkedAt, blockNumber: blockNumber ?? previous?.blockNumber ?? null, complete, positions: [...positions.values()] });
  }
  if (!next.size) return result;
  if (!wallet) { wallet = { address: walletAddress, scopes: [] }; result.wallets.push(wallet); }
  wallet.scopes = [...next.values()].sort((a, b) => scopeKey(a).localeCompare(scopeKey(b)));
  result.wallets.sort((a, b) => a.address.localeCompare(b.address));
  result.updatedAt = result.wallets.flatMap(w => w.scopes.map(s => s.checkedAt)).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null;
  return result;
}
/** Per-scope timestamps and empty scopes preserve deletions when servers race or restart. */
export function mergeCookbooks(a: CookbookFile, b: CookbookFile): CookbookFile {
  const out = structuredClone(a);
  for (const wallet of b.wallets) {
    let existing = out.wallets.find(w => w.address.toLowerCase() === wallet.address.toLowerCase());
    if (!existing) { out.wallets.push(structuredClone(wallet)); continue; }
    for (const scope of wallet.scopes) {
      const index = existing.scopes.findIndex(s => scopeKey(s) === scopeKey(scope));
      if (index < 0) existing.scopes.push(structuredClone(scope));
      else if (newer(scope, existing.scopes[index])) existing.scopes[index] = structuredClone(scope);
    }
    existing.scopes.sort((x, y) => scopeKey(x).localeCompare(scopeKey(y)));
  }
  out.wallets.sort((x, y) => x.address.localeCompare(y.address));
  out.updatedAt = out.wallets.flatMap(w => w.scopes.map(s => s.checkedAt)).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null;
  return out;
}
export function cookbookPositions(file: CookbookFile) {
  return file.wallets.flatMap(w => w.scopes.flatMap(s => s.positions.map(p => ({ ...p, address: w.address, protocolId: s.protocolId, protocolName: s.protocolName, chain: s.chain, checkedAt: s.checkedAt, blockNumber: p.blockNumber ?? s.blockNumber })))).sort((a, b) => b.apr - a.apr || b.netValueUsd - a.netValueUsd);
}

/** Configured cross-chain identities count once; unknown contracts stay separate. */
export function cookbookSuppliedAssets(entries: ReturnType<typeof cookbookPositions>) {
  type NetworkAsset = { address: string; symbol: string; chain: ChainName; intrinsicApr: number | null; snapshotAt: string };
  const assets = new Map<string, NetworkAsset>();
  for (const entry of entries) for (const asset of entry.position.assets) {
    if (!finite(asset.supplied) || asset.supplied <= 0 || typeof asset.address !== 'string' || !asset.address) continue;
    const key = `${entry.chain}:${asset.address.toLowerCase()}`;
    const previous = assets.get(key);
    if (previous && Date.parse(previous.snapshotAt) >= Date.parse(entry.snapshotAt)) continue;
    // PT appreciation is stored as the base supply rate. Ordinary lending
    // interest and rewards are not intrinsic yield and must not enter this list.
    const rate = asset.supplyRate?.pendlePt ? asset.supplyRate : asset.intrinsicSupplyRate;
    assets.set(key, { address: asset.address.toLowerCase(), symbol: asset.symbol, chain: entry.chain, intrinsicApr: rate ? finite(rate.apr) ? rate.apr : null : 0, snapshotAt: entry.snapshotAt });
  }
  const groups = new Map<string, NetworkAsset[]>();
  for (const asset of assets.values()) {
    const contract = `${asset.chain}:${asset.address}`, configured = configuredAssetGroups.get(contract);
    const key = configured === undefined ? `contract:${contract}` : `configured:${configured}`;
    groups.set(key, [...(groups.get(key) ?? []), asset]);
  }
  return [...groups].map(([id, networks]) => {
    networks.sort((a, b) => Date.parse(b.snapshotAt) - Date.parse(a.snapshotAt) || a.chain.localeCompare(b.chain));
    return { ...networks[0], id, additionalNetworks: networks.slice(1) };
  }).sort((a, b) => a.intrinsicApr === null && b.intrinsicApr !== null ? 1 : b.intrinsicApr === null && a.intrinsicApr !== null ? -1 : (b.intrinsicApr ?? 0) - (a.intrinsicApr ?? 0) || a.symbol.localeCompare(b.symbol) || a.id.localeCompare(b.id));
}
