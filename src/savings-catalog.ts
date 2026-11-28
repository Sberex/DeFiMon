import config from '../config/token-matches.json' with { type: 'json' };
import { networkNames, networkExplorers } from './networks';
import type { IntrinsicRate, NetworkId } from './types';
export interface SavingsCatalogAsset { id: string; name: string; safetyUrl: string | null; pharosId: string | null; sources: { network: NetworkId; address: string; label: string }[] }
export interface SavingsCatalogRate { group: string; checkedAt: string; quote: IntrinsicRate | null; reason?: string }
export const savingsCatalogAssets: SavingsCatalogAsset[] = Object.entries(config).filter(([, value]) => value._category === 'Savings stablecoin').map(([id, value]) => {
  const entry = value as Record<string, unknown>, url = typeof entry['Safety Score'] === 'string' ? entry['Safety Score'] : null;
  const match = url?.match(/^https:\/\/pharos\.watch\/stablecoin\/([a-z0-9-]+)\/$/);
  const sources = Array.isArray(entry._intrinsicOracles) ? entry._intrinsicOracles.map((s: { network: NetworkId; address: string; label: string }) => ({ network: s.network, address: s.address, label: s.label })) : [];
  return { id, name: id.split('#')[0], safetyUrl: match ? url : null, pharosId: match?.[1] ?? null, sources };
}).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
export function savingsRateLink(asset: SavingsCatalogAsset, quote?: IntrinsicRate | null) {
  if (quote?.source) {
    const source = quote.source, explorer = networkExplorers[source.chain];
    if (explorer && /^0x[\da-f]{40}$/i.test(source.oracle) && !/^0x0{40}$/i.test(source.oracle)) return { url: `${explorer}/address/${source.oracle}#readContract`, label: source.label ?? `${source.chain} rate oracle` };
    if (source.url) try { const url = new URL(source.url); if (url.protocol === 'https:' && !url.username && !url.password) return { url: url.href, label: source.label ?? 'Intrinsic APR source' }; } catch { /* Never make an unsafe source link. */ }
  }
  const source = asset.sources[0];
  return source ? { url: `${networkExplorers[networkNames[source.network]]}/address/${source.address}#readContract`, label: source.label } : null;
}
