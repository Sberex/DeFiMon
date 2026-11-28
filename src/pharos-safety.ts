import evmChains from '../config/evm-chains.json';
import type { PendleBaseAsset } from './pendle-safety';
import config from '../config/token-matches.json';
import { networkNames, portfolioNetwork } from './networks';
import type { ChainName, Portfolio } from './types';
export const safetyGrades = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'E+', 'E', 'E-', 'F'] as const;
export type SafetyGrade = typeof safetyGrades[number];
export interface PharosGrades {
  schemaVersion: 1; asOfSec: number; publicationStatus: 'current'; methodologyVersion: string;
  grades: { id: string; grade: SafetyGrade | 'NR'; score: number | null; ratingStatus: 'rated' | 'not-rated' | 'pipeline-gap' }[];
}
export function parsePharosGrades(value: unknown, now = Date.now()): PharosGrades {
  const data = value as PharosGrades;
  const fail = () => { throw Error('Current Pharos safety grades could not be verified.'); };
  if (!data || data.schemaVersion !== 1 || data.publicationStatus !== 'current' || !Number.isInteger(data.asOfSec) || data.asOfSec * 1000 > now + 300000 || now - data.asOfSec * 1000 > 72 * 3600000 || typeof data.methodologyVersion !== 'string' || data.methodologyVersion.length > 100 || !Array.isArray(data.grades) || !data.grades.length || data.grades.length > 5000) return fail();
  const seen = new Set<string>();
  const grades = data.grades.map(row => {
    if (!row || typeof row.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id) || seen.has(row.id)) return fail();
    seen.add(row.id);
    if (row.ratingStatus === 'pipeline-gap' && (row.grade === null || row.grade === 'NR') && row.score === null) return { id: row.id, grade: 'NR' as const, score: null, ratingStatus: 'pipeline-gap' as const };
    if (row.ratingStatus === 'not-rated' && row.grade === 'NR') return { id: row.id, grade: 'NR' as const, score: null, ratingStatus: 'not-rated' as const };
    if (row.ratingStatus !== 'rated' || !safetyGrades.includes(row.grade as SafetyGrade) || typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < 0 || row.score > 100) return fail();
    return { id: row.id, grade: row.grade as SafetyGrade, score: row.score, ratingStatus: 'rated' as const };
  });
  return { schemaVersion: 1, asOfSec: data.asOfSec, publicationStatus: 'current', methodologyVersion: data.methodologyVersion, grades };
}
interface Identity { group: string; url?: string; id?: string; category: unknown }
const identities = new Map<string, Identity>();
const chainIdentities = new Map<string, Identity>();
for (const [group, entry] of Object.entries(config) as [string, Record<string, unknown>][]) {
  const url = typeof entry['Safety Score'] === 'string' ? entry['Safety Score'] : undefined;
  const id = url?.match(/^https:\/\/pharos\.watch\/stablecoin\/([a-z0-9-]+)\/$/)?.[1];
  for (const [network, value] of Object.entries(evmChains)) {
    const address = entry[network];
    if (typeof address === 'string' && /^0x[\da-f]{40}$/i.test(address)) chainIdentities.set(`${value.chainId}:${address.toLowerCase()}`, { group, url, id, category: entry._category });
  }
  for (const [network, chain] of Object.entries(networkNames)) {
    const address = entry[network];
    if (typeof address === 'string' && /^0x[\da-f]{40}$/i.test(address)) identities.set(`${chain}:${address.toLowerCase()}`, { group, url, id, category: entry._category });
  }
}
export function tokenSafety(chain: ChainName, address: string, feed: PharosGrades | null, pendleBases?: Map<string, PendleBaseAsset>) {
  const contract = address === 'native' && chain === 'Arc' ? config.USDC.arc : address;
  const base = pendleBases?.get(`${chain}:${address.toLowerCase()}`);
  const identity = base ? chainIdentities.get(`${base.chainId}:${base.address}`) : identities.get(`${chain}:${contract.toLowerCase()}`);
  if (base && !identity) return { grade: 'NR' as const, score: null, url: undefined, inheritedFrom: base.symbol };
  if (!identity || !base && !['Stablecoin', 'Savings stablecoin'].includes(String(identity.category))) return undefined;
  const row = identity.id ? feed?.grades.find(row => row.id === identity.id) : undefined;
  return { grade: row?.ratingStatus === 'rated' ? row.grade : 'NR' as const, score: row?.ratingStatus === 'rated' ? row.score : null, url: identity.url, ...(base ? { inheritedFrom: base.symbol } : {}) };
}
export interface SafetyAsset {
  key: string; symbol: string; chain: ChainName; address: string; url?: string; grade: SafetyGrade | 'Not Rated'; score: number | null;
  valueUsd: number; unpriced: number;
  holdings: { chain: ChainName; location: string; amount: number | null; valueUsd: number | null }[];
}
export function assetSafetySummary(portfolio: Portfolio, feed: PharosGrades | null, pendleBases?: Map<string, PendleBaseAsset>) {
  const ratings = new Map(feed?.grades.map(row => [row.id, row]));
  const assets = new Map<string, SafetyAsset>();
  let incomplete = portfolio.networks?.some(n => n.status === 'error') ?? false;
  const add = (chain: ChainName, address: string, symbol: string, amount: number | null, value: number | null, location: string) => {
    // Arc's native and ERC-20 interfaces expose the same USDC identity, not two balances.
    const contract = address === 'native' && chain === 'Arc' ? config.USDC.arc : address;
    const identity = identities.get(`${chain}:${contract.toLowerCase()}`);
    const key = identity?.group ?? `${chain}:${address.toLowerCase()}`;
    const rating = identity?.id ? ratings.get(identity.id) : undefined;
    const inherited = pendleBases?.has(`${chain}:${address.toLowerCase()}`) ? tokenSafety(chain, address, feed, pendleBases) : undefined;
    const grade = inherited ? inherited.grade === 'NR' ? 'Not Rated' : inherited.grade as SafetyGrade : rating?.ratingStatus === 'rated' ? rating.grade as SafetyGrade : 'Not Rated';
    let asset = assets.get(key);
    if (!asset) { asset = { key, chain, address, symbol: identity?.group.split('#')[0] ?? symbol, url: inherited?.url ?? identity?.url, grade, score: inherited ? inherited.score : rating?.ratingStatus === 'rated' ? rating.score : null, valueUsd: 0, unpriced: 0, holdings: [] }; assets.set(key, asset); }
    if (value === null) asset.unpriced++; else asset.valueUsd += value;
    asset.holdings.push({ chain, location, amount, valueUsd: value });
  };
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  for (const wallet of portfolio.wallets ?? []) {
    if (wallet.status !== 'ok') incomplete = true;
    for (const token of wallet.tokens) {
      if (token.excludedReason || token.balance === 0) continue;
      const value = finite(token.valueUsd) ? token.valueUsd : null;
      add(wallet.chain, token.address, token.symbol, finite(token.balance) ? token.balance : null, value, 'Wallet');
    }
  }
  for (const protocol of portfolio.protocols) {
    if (protocol.status === 'error' || protocol.status === 'not-integrated' || protocol.balanceDiscoveryComplete === false || protocol.status === 'partial' && protocol.balanceDiscoveryComplete !== true) incomplete = true;
    const chain = protocol.chain ?? networkNames[portfolioNetwork(portfolio.chain)];
    for (const position of protocol.positions) {
      if (position.suppliedUsd === null || position.assets.some(a => !finite(a.supplied))) incomplete = true;
      const supplied = position.assets.filter(a => finite(a.supplied) && a.supplied > 0);
      const values = supplied.map(a => finite(a.priceUsd) && finite(a.supplied * a.priceUsd) ? a.supplied * a.priceUsd : null);
      const missing = values.filter(v => v === null).length;
      const priced = values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
      const remainder = finite(position.suppliedUsd) && position.suppliedUsd >= priced ? position.suppliedUsd - priced : null;
      supplied.forEach((a, i) => add(chain, a.address, a.symbol, a.supplied, values[i] ?? (missing === 1 ? remainder : null), `${protocol.name} · ${position.label}`));
      // A native position total cannot establish the grade of several unpriced components.
      if (missing > 1 && remainder !== null && remainder > 0) add(chain, `unallocated:${protocol.id}:${position.id}`, 'Unallocated supplied value', null, remainder, `${protocol.name} · ${position.label}`);
      if (!supplied.length && finite(position.suppliedUsd) && position.suppliedUsd > 0) add(chain, `unallocated:${protocol.id}:${position.id}`, 'Unallocated supplied value', null, position.suppliedUsd, `${protocol.name} · ${position.label}`);
    }
  }
  const rows = [...assets.values()];
  const groups = [...safetyGrades, 'Not Rated' as const].flatMap(grade => {
    const items = rows.filter(a => a.grade === grade).sort((a, b) => b.valueUsd - a.valueUsd || a.symbol.localeCompare(b.symbol));
    return items.length ? [{ grade, valueUsd: items.reduce((s, a) => s + a.valueUsd, 0), assets: items, unpriced: items.reduce((s, a) => s + a.unpriced, 0) }] : [];
  });
  return { groups, knownValueUsd: rows.reduce((s, a) => s + a.valueUsd, 0), ratedValueUsd: rows.filter(a => a.grade !== 'Not Rated').reduce((s, a) => s + a.valueUsd, 0), notRatedValueUsd: rows.filter(a => a.grade === 'Not Rated').reduce((s, a) => s + a.valueUsd, 0), unpriced: rows.reduce((s, a) => s + a.unpriced, 0), incomplete };
}
