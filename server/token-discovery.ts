import { isAddress } from 'viem';
import type { ComparisonTarget, TokenDiscoveryReport } from '../src/market-comparison.js';
import type { NetworkId } from '../src/types.js';
import { networkOrder } from '../src/networks.js';
import { manualTokenMatches, normalizeMarketToken, type TokenMatches } from './market-tokens.js';
import { networks } from './networks.js';
type Obj = Record<string, unknown>;
type Contracts = Partial<Record<NetworkId, string>>;
type Provider = 'CoinGecko' | 'CoinMarketCap';
interface Evidence { provider: Provider; assetId: string; url: string; contracts: Contracts }
interface Lookup { status: 'found' | 'not-found' | 'unavailable' | 'conflict'; evidence?: Evidence; warning?: string }
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const address = (v: unknown): string | undefined => typeof v === 'string' && isAddress(v, { strict: false }) && !/^0x0{40}$/i.test(v) ? v.toLowerCase() : undefined;
const safeId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{1,160}$/.test(v);
class LookupFailure extends Error { constructor(readonly kind: 'not-found' | 'unavailable') { super(kind); } }
export function createTokenDiscovery(options: { fetcher?: typeof fetch; env?: Record<string, string | undefined>; now?: () => number; manual?: TokenMatches } = {}) {
  const fetcher = options.fetcher ?? fetch, env = options.env ?? process.env, now = options.now ?? Date.now;
  const manual = options.manual ?? manualTokenMatches;
  const cache = new Map<string, { expires: number; report: TokenDiscoveryReport }>(), pending = new Map<string, Promise<TokenDiscoveryReport>>();
  const cooldown = new Map<Provider, number>();
  function remember(key: string, report: TokenDiscoveryReport, ttl: number) {
    if (!cache.has(key) && cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: now() + ttl, report: structuredClone(report) });
  }

  let platforms: { expires: number; value: Partial<Record<NetworkId, string>> } | undefined;
  let platformFailureUntil = 0;
  let platformsPending: Promise<Partial<Record<NetworkId, string>>> | undefined;
  async function request(url: string, provider: Provider): Promise<unknown> {
    if ((cooldown.get(provider) ?? 0) > now()) throw new LookupFailure('unavailable');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (provider === 'CoinMarketCap') headers['X-CMC_PRO_API_KEY'] = env.COINMARKETCAP_API_KEY!;
    else if (env.COINGECKO_PRO_API_KEY) headers['x-cg-pro-api-key'] = env.COINGECKO_PRO_API_KEY;
    else if (env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = env.COINGECKO_API_KEY;
    const response = await fetcher(url, { headers, redirect: 'error', signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (response.status === 404) throw new LookupFailure('not-found');
    if (response.status === 429) { const seconds = Number(response.headers.get('retry-after')); cooldown.set(provider, now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) : 60) * 1000); }
    if (!response.ok) throw new LookupFailure('unavailable');
    if (Number(response.headers.get('content-length')) > 2_000_000) throw new LookupFailure('unavailable');
    const text = await response.text();
    if (text.length > 2_000_000) throw new LookupFailure('unavailable');
    return JSON.parse(text);
  }
  const cgRoot = env.COINGECKO_PRO_API_KEY ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';
  async function platformIds() {
    if (platforms && platforms.expires > now()) return platforms.value;
    if (platformFailureUntil > now()) throw new LookupFailure('unavailable');
    if (!platformsPending) platformsPending = (async () => {
      const data = await request(`${cgRoot}/asset_platforms`, 'CoinGecko');
      if (!Array.isArray(data)) throw new LookupFailure('unavailable');
      const result: Partial<Record<NetworkId, string>> = {};
      for (const network of networkOrder) {
        const entries = data.filter(row => object(row) && Number(row.chain_identifier) === networks[network].id && safeId(row.id));
        if (entries.length === 1) result[network] = entries[0].id;
      }
      platforms = { expires: now() + 6 * 3600_000, value: result }; return result;
    })().catch(error => { platformFailureUntil = now() + 60_000; throw error; }).finally(() => { platformsPending = undefined; });
    return platformsPending;
  }
  async function coingecko(network: NetworkId, token: string): Promise<Lookup> {
    try {
      const ids = await platformIds(), sourceId = ids[network];
      if (!sourceId) return { status: 'not-found', warning: 'CoinGecko does not expose a unique platform identifier for the source network.' };
      const data = await request(`${cgRoot}/coins/${encodeURIComponent(sourceId)}/contract/${token}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`, 'CoinGecko');
      if (!object(data) || !safeId(data.id) || !object(data.platforms) || address(data.platforms[sourceId]) !== token) return { status: 'conflict', warning: 'CoinGecko did not confirm the exact source network and contract; its record was excluded.' };
      const contracts: Contracts = {};
      for (const chain of networkOrder) { const id = ids[chain]; if (id) { const value = address(data.platforms[id]); if (value) contracts[chain] = value; } }
      return { status: 'found', evidence: { provider: 'CoinGecko', assetId: data.id, url: `https://www.coingecko.com/en/coins/${data.id}`, contracts } };
    } catch (error) { return { status: error instanceof LookupFailure ? error.kind : 'unavailable', warning: 'CoinGecko contract lookup could not be completed. No token-name guess was used.' }; }
  }
  function cmcNetwork(value: unknown): NetworkId | undefined {
    if (!object(value)) return;
    const coin = object(value.coin) ? value.coin : value;
    const identifiers = [value.name, coin.slug, coin.name].filter((v): v is string => typeof v === 'string').map(v => v.toLowerCase().replace(/[ _-]/g, ''));
    const names: Record<string, NetworkId> = { ethereum: 'ethereum', arbitrum: 'arbitrum', arbitrumone: 'arbitrum', plasma: 'plasma', base: 'base' };
    const recognized = new Set(identifiers.flatMap(id => names[id] ? [names[id]] : []));
    return recognized.size === 1 ? [...recognized][0] : undefined;
  }
  async function coinmarketcap(network: NetworkId, token: string): Promise<Lookup> {
    if (!env.COINMARKETCAP_API_KEY) return { status: 'unavailable', warning: 'CoinMarketCap lookup is not configured. Add COINMARKETCAP_API_KEY on the server to enable it.' };
    try {
      const data = await request(`https://pro-api.coinmarketcap.com/v2/cryptocurrency/info?address=${token}`, 'CoinMarketCap');
      if (!object(data) || !object(data.data) || (object(data.status) && data.status.error_code !== undefined && data.status.error_code !== 0)) throw new LookupFailure('unavailable');
      const records = Object.values(data.data).flatMap(v => Array.isArray(v) ? v : [v]).filter(object);
      const found: Evidence[] = [];
      for (const record of records) {
        const contracts: Contracts = {}, conflicts = new Set<NetworkId>();
        const rows = Array.isArray(record.contract_address) ? [...record.contract_address] : [];
        if (object(record.platform)) rows.push({ platform: record.platform, contract_address: record.platform.token_address });
        for (const row of rows) {
          if (!object(row)) continue;
          const chain = cmcNetwork(row.platform), value = address(row.contract_address);
          if (!chain || !value) continue;
          if (contracts[chain] && contracts[chain] !== value) conflicts.add(chain);
          else contracts[chain] = value;
        }
        conflicts.forEach(chain => { delete contracts[chain]; });
        if (contracts[network] !== token || (typeof record.id !== 'number' && typeof record.id !== 'string') || !/^\d{1,20}$/.test(String(record.id))) continue;
        found.push({ provider: 'CoinMarketCap', assetId: String(record.id), url: safeId(record.slug) ? `https://coinmarketcap.com/currencies/${record.slug}/` : 'https://coinmarketcap.com/', contracts });
      }
      const unique = [...new Map(found.map(e => [e.assetId, e])).values()];
      if (unique.length > 1) return { status: 'conflict', warning: 'CoinMarketCap returned multiple assets for this source contract; ambiguous records were excluded.' };
      return unique.length ? { status: 'found', evidence: unique[0] } : { status: 'not-found', warning: 'CoinMarketCap did not confirm a token record for this exact source network and contract.' };
    } catch (error) { return { status: error instanceof LookupFailure ? error.kind : 'unavailable', warning: 'CoinMarketCap contract lookup could not be completed. Check its API access and server key.' }; }
  }
  async function discover(network: NetworkId, token: string): Promise<TokenDiscoveryReport> {
    const key = `${network}:${token}`;
    const explicit = Object.entries(manual).find(([, group]) => group[network] === token);
    if (explicit) return { network, token, label: explicit[0], status: 'manual', matches: Object.fromEntries(networkOrder.flatMap(chain => explicit[1][chain] ? [[chain, explicit[1][chain]]] : [])), sources: [], warnings: [] };
    const existing = cache.get(key); if (existing && existing.expires > now()) return structuredClone(existing.report);
    if (pending.has(key)) return structuredClone(await pending.get(key)!);
    const work = (async () => {
      const lookups = await Promise.all([coingecko(network, token), coinmarketcap(network, token)]);
      const evidence = lookups.flatMap(r => r.evidence ? [r.evidence] : []), warnings = lookups.flatMap(r => r.warning ? [r.warning] : []);
      const matches: Contracts = { [network]: token }; let conflict = false;
      for (const chain of networkOrder) {
        const contracts = [...new Set(evidence.flatMap(e => e.contracts[chain] ? [e.contracts[chain]!] : []))];
        if (contracts.length === 1) matches[chain] = contracts[0];
        else if (contracts.length > 1) { conflict = true; warnings.push(`Automatic sources disagree on the ${networks[chain].name} contract. That destination was excluded.`); }
      }
      // Never link an unlisted contract into an existing hand-written identity group.
      for (const group of Object.values(manual)) if (networkOrder.some(chain => matches[chain] && group[chain] === matches[chain])) {
        for (const chain of networkOrder) if (chain !== network) delete matches[chain];
        conflict = true; warnings.push('This automatic record overlaps a manual token group. Add the source contract to that group to confirm the match.'); break;
      }
      const status = conflict ? 'conflict' : evidence.length ? 'found' : lookups.some(r => r.status === 'conflict') ? 'conflict' : lookups.every(r => r.status === 'not-found') ? 'not-found' : 'unavailable';
      if (conflict) for (const chain of networkOrder) if (chain !== network) delete matches[chain];
      const report: TokenDiscoveryReport = { network, token, label: evidence[0]?.assetId, status, matches, sources: evidence.map(({ provider, assetId, url }) => ({ provider, assetId, url })), warnings };
      remember(key, report, status === 'found' ? 3600_000 : 60_000);
      return report;
    })();
    pending.set(key, work);
    try { return structuredClone(await work); } finally { pending.delete(key); }
  }
  async function resolve(targets: ComparisonTarget[]) {
    const unique = new Map<string, { network: NetworkId; token: string }>();
    for (const target of targets) for (const token of [target.supplied, target.borrowed, ...(target.supplyBasket ?? []), ...(target.borrowBasket ?? [])]) {
      if (!token) continue;
      const normalized = normalizeMarketToken(token, target.network);
      if (address(normalized)) unique.set(`${target.network}:${normalized}`, { network: target.network, token: normalized });
    }
    const inputs = [...unique.values()], reports: TokenDiscoveryReport[] = new Array(inputs.length);
    let next = 0, unknown = 0; const deadline = now() + 20_000;
    await Promise.all(Array.from({ length: Math.min(2, inputs.length) }, async () => {
      while (next < inputs.length) {
        const index = next++, input = inputs[index];
        const isManual = Object.values(manual).some(group => group[input.network] === input.token);
        if (!isManual && (++unknown > 20 || now() >= deadline)) { reports[index] = { ...input, status: 'unavailable', matches: { [input.network]: input.token }, sources: [], warnings: ['Automatic token discovery reached its per-request limit. Add a manual group to include this token across networks.'] }; continue; }
        reports[index] = await discover(input.network, input.token);
      }
    }));
    // Reconcile records found from different source-chain contracts before using their groups.
    const parents = reports.map((_, i) => i);
    const root = (i: number): number => parents[i] === i ? i : (parents[i] = root(parents[i]));
    const owners = new Map<string, number>();
    reports.forEach((report, i) => {
      if (report.status === 'manual') return;
      for (const source of report.sources) {
        const key = `${source.provider}:${source.assetId}`;
        const owner = owners.get(key);
        if (owner !== undefined) parents[root(i)] = root(owner);
        else owners.set(key, i);
      }
      for (const chain of networkOrder) if (report.matches[chain]) {
        const key = `${chain}:${report.matches[chain]}`;
        const owner = owners.get(key);
        if (owner !== undefined) parents[root(i)] = root(owner);
        else owners.set(key, i);
      }
    });
    const components = new Map<number, number[]>();
    reports.forEach((report, i) => { if (report.status !== 'manual') { const key = root(i); components.set(key, [...(components.get(key) ?? []), i]); } });
    for (const indices of components.values()) {
      const conflicting = indices.some(i => reports[i].status === 'conflict') || networkOrder.some(chain => new Set(indices.flatMap(i => reports[i].matches[chain] ? [reports[i].matches[chain]] : [])).size > 1);
      if (conflicting) {
        for (const i of indices) {
          const report = reports[i]; report.status = 'conflict'; report.matches = { [report.network]: report.token };
          if (indices.length > 1) report.warnings.push('Automatic records for this asset conflict across source networks. Cross-network matches were excluded; add a manual group to confirm them.');
          remember(`${report.network}:${report.token}`, report, 60_000);
        }
      } else {
        const group = Object.assign({}, ...indices.map(i => reports[i].matches));
        const sources = [...new Map(indices.flatMap(i => reports[i].sources).map(source => [`${source.provider}:${source.assetId}`, source])).values()];
        if (sources.length) for (const i of indices) { reports[i].matches = { ...group }; reports[i].sources = sources.map(s => ({ ...s })); reports[i].status = 'found'; }
      }
    }
    const matches: TokenMatches = { ...manual };
    reports.forEach((report, index) => { if (report.status !== 'manual') { let key = `automatic-${index}`; while (Object.hasOwn(matches, key)) key = `_${key}`; matches[key] = { ...report.matches }; } });
    return { matches, reports };
  }
  return { resolve };
}
export const resolveTokenMatches = createTokenDiscovery().resolve;
