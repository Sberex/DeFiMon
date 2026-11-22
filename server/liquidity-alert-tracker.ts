import { createHash } from 'node:crypto';
import { formatUnits } from 'viem';
import { parseWalletHistory, type WalletHistoryFile } from '../src/wallet-history.js';
import { alertScopeKey, defaultAlertRules } from '../src/alert-rules.js';
import type { LiquidityObservation, LiquidityReading, LiquidityWatch } from './liquidity-alert-reader.js';
export interface LiquidityBaseline extends LiquidityReading { checkedAt: string; blockNumber: string }
export interface LiquidityWatchState { watch: LiquidityWatch; checkedAt: string; status: LiquidityObservation['status'] | 'pending'; message?: string; baselines: LiquidityBaseline[] }
export interface LiquidityTrackerState { version: 1; lastRunAt: string | null; lastRunEvent?: string; lastScheduledRunAt?: string | null; watches: LiquidityWatchState[] }
export interface LiquidityNotification {
  id: string; type: 'available-liquidity-increased'; address: string; network: LiquidityWatch['network']; protocol: string; positionId: string;
  market: string; marketAddress: string; marketLabel: string; token: string; symbol: string; decimals: number;
  previousLiquidity: string; availableLiquidity: string; liquidityChange: string; previousRaw: string; availableRaw: string; changeRaw: string;
  previousCheckedAt: string; timestamp: string; blockNumber: string; note: string;
}
export interface LiquidityNotifications { version: 1; notifications: LiquidityNotification[] }
export const emptyLiquidityState = (): LiquidityTrackerState => ({ version: 1, lastRunAt: null, watches: [] });
export const emptyLiquidityNotifications = (): LiquidityNotifications => ({ version: 1, notifications: [] });
export const watchKey = (w: LiquidityWatch) => `${w.address.toLowerCase()}:${alertScopeKey(w)}`;
const readingKey = (q: LiquidityReading) => `${q.market.toLowerCase()}:${q.token.toLowerCase()}`;
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const raw = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v);
export function enabledLiquidityWatches(history: WalletHistoryFile): LiquidityWatch[] {
  return parseWalletHistory(history).wallets.flatMap(wallet => (wallet.alerts ?? []).filter(a => a.rules.newLiquidityAdded).map(a => ({ address: wallet.address, network: a.network, protocol: a.protocol, positionId: a.positionId, ruleUpdatedAt: a.updatedAt })));
}
function validReading(q: LiquidityReading) {
  return q && typeof q.market === 'string' && q.market.length > 0 && typeof q.marketAddress === 'string' && /^0x[\da-f]{40}$/i.test(q.marketAddress) && /^0x[\da-f]{40}$/i.test(q.token) && typeof q.symbol === 'string' && q.symbol.length > 0 && q.symbol.length <= 128 && Number.isInteger(q.decimals) && q.decimals >= 0 && q.decimals <= 36 && raw(q.rawAmount) && typeof q.label === 'string' && typeof q.note === 'string';
}
export function parseLiquidityState(value: unknown): LiquidityTrackerState {
  const f = value as LiquidityTrackerState;
  if (!f || f.version !== 1 || !(f.lastRunAt === null || iso(f.lastRunAt)) || f.lastScheduledRunAt !== undefined && f.lastScheduledRunAt !== null && !iso(f.lastScheduledRunAt) || f.lastRunEvent !== undefined && !['schedule', 'workflow_dispatch', 'push', 'local'].includes(f.lastRunEvent) || !Array.isArray(f.watches)) throw Error('Invalid tracker state; existing file was not replaced.');
  const seen = new Set<string>();
  for (const w of f.watches) {
    // Reuse the wallet-history validator for the saved scope and timestamp.
    parseWalletHistory({ version: 1, wallets: [{ address: w.watch?.address, lastCheckedAt: w.checkedAt, manualLiquidationPrices: [], alerts: [{ network: w.watch?.network, protocol: w.watch?.protocol, positionId: w.watch?.positionId, updatedAt: w.watch?.ruleUpdatedAt, rules: { borrowAprAboveSupplyApr: false, utilizationAbove: { enabled: false, thresholdPercent: null }, healthFactorBelow: { enabled: false, threshold: 1.01 }, positionAprBelow: { enabled: false, thresholdPercent: null } } }] }] });
    if (!['ok', 'error', 'inactive', 'unsupported', 'pending'].includes(w.status) || !Array.isArray(w.baselines) || seen.has(watchKey(w.watch))) throw Error('Invalid tracker watch');
    seen.add(watchKey(w.watch)); const readings = new Set<string>();
    for (const b of w.baselines) {
      if (!validReading(b) || !iso(b.checkedAt) || !raw(b.blockNumber) || readings.has(readingKey(b))) throw Error('Invalid tracker baseline');
      readings.add(readingKey(b));
    }
  }
  return structuredClone(f);
}
export function parseLiquidityNotifications(value: unknown): LiquidityNotifications {
  const f = value as LiquidityNotifications;
  if (!f || f.version !== 1 || !Array.isArray(f.notifications)) throw Error('Invalid notifications; existing file was not replaced.');
  const ids = new Set<string>();
  for (const n of f.notifications) {
    if (!n || typeof n.id !== 'string' || !/^[\da-f]{64}$/.test(n.id) || ids.has(n.id) || n.type !== 'available-liquidity-increased' || !iso(n.timestamp) || !iso(n.previousCheckedAt) || !raw(n.previousRaw) || !raw(n.availableRaw) || !raw(n.changeRaw) || BigInt(n.changeRaw) <= 0n || BigInt(n.availableRaw) - BigInt(n.previousRaw) !== BigInt(n.changeRaw) || !raw(n.blockNumber)) throw Error('Invalid liquidity notification');
    if (!validReading({ market: n.market, marketAddress: n.marketAddress, label: n.marketLabel, token: n.token, symbol: n.symbol, decimals: n.decimals, rawAmount: n.availableRaw, note: n.note }) || n.previousLiquidity !== formatUnits(BigInt(n.previousRaw), n.decimals) || n.availableLiquidity !== formatUnits(BigInt(n.availableRaw), n.decimals) || n.liquidityChange !== formatUnits(BigInt(n.changeRaw), n.decimals)) throw Error('Invalid notification units');
    parseWalletHistory({ version: 1, wallets: [{ address: n.address, lastCheckedAt: n.timestamp, manualLiquidationPrices: [], alerts: [{ network: n.network, protocol: n.protocol, positionId: n.positionId, updatedAt: n.timestamp, rules: defaultAlertRules() }] }] });
    ids.add(n.id);
  }
  return structuredClone(f);
}
/** Pure transition: baseline first, exact raw-unit increases only, independent wallets. */
export function advanceLiquidityAlerts(history: WalletHistoryFile, previous: LiquidityTrackerState, previousNotifications: LiquidityNotifications, observations: LiquidityObservation[], runAt: string, runEvent?: 'schedule' | 'workflow_dispatch' | 'push' | 'local') {
  if (!iso(runAt)) throw Error('Invalid tracker time');
  const state = parseLiquidityState(previous), notifications = parseLiquidityNotifications(previousNotifications);
  const enabled = enabledLiquidityWatches(history), old = new Map(state.watches.map(w => [watchKey(w.watch), w]));
  const incoming = new Map(observations.map(o => [watchKey(o.watch), o]));
  const ids = new Set(notifications.notifications.map(n => n.id)); let added = 0;
  const watches = enabled.map(watch => {
    const key = watchKey(watch), existing = old.get(key), observation = incoming.get(key);
    const prior = existing?.watch.ruleUpdatedAt === watch.ruleUpdatedAt ? existing : undefined;
    if (prior && prior.checkedAt >= runAt) return prior;
    if (!observation || observation.watch.ruleUpdatedAt !== watch.ruleUpdatedAt) return prior ?? { watch, checkedAt: runAt, status: 'pending' as const, baselines: [] };
    if (!iso(observation.checkedAt) || !raw(observation.blockNumber) || observation.checkedAt > runAt || observation.readings.some(q => !validReading(q))) throw Error('Invalid tracker observation');
    if (observation.status !== 'ok') return { watch, checkedAt: observation.checkedAt, status: observation.status, ...(observation.message ? { message: observation.message } : {}), baselines: observation.status === 'inactive' ? [] : prior?.baselines ?? [] };
    if (!observation.readings.length) return { watch, checkedAt: observation.checkedAt, status: 'error' as const, message: 'No verified liquidity readings; previous baseline retained.', baselines: prior?.baselines ?? [] };
    const last = new Map((prior?.baselines ?? []).map(b => [readingKey(b), b]));
    const baselines = observation.readings.map(q => {
      const before = last.get(readingKey(q));
      if (before && BigInt(observation.blockNumber) <= BigInt(before.blockNumber)) return before;
      if (before && before.decimals === q.decimals && before.marketAddress.toLowerCase() === q.marketAddress.toLowerCase() && BigInt(q.rawAmount) > BigInt(before.rawAmount)) {
        const change = BigInt(q.rawAmount) - BigInt(before.rawAmount);
        const id = createHash('sha256').update(JSON.stringify([key, readingKey(q), watch.ruleUpdatedAt, before.blockNumber, observation.blockNumber, before.rawAmount, q.rawAmount])).digest('hex');
        if (!ids.has(id)) {
          ids.add(id); added++;
          notifications.notifications.push({ id, type: 'available-liquidity-increased', address: watch.address, network: watch.network, protocol: watch.protocol, positionId: watch.positionId, market: q.market, marketAddress: q.marketAddress, marketLabel: q.label, token: q.token, symbol: q.symbol, decimals: q.decimals, previousLiquidity: formatUnits(BigInt(before.rawAmount), q.decimals), availableLiquidity: formatUnits(BigInt(q.rawAmount), q.decimals), liquidityChange: formatUnits(change, q.decimals), previousRaw: before.rawAmount, availableRaw: q.rawAmount, changeRaw: String(change), previousCheckedAt: before.checkedAt, timestamp: observation.checkedAt, blockNumber: observation.blockNumber, note: q.note });
        }
      }
      return { ...q, checkedAt: observation.checkedAt, blockNumber: observation.blockNumber };
    });
    return { watch, checkedAt: observation.checkedAt, status: 'ok' as const, baselines };
  });
  const advancesRun = (enabled.length > 0 || state.watches.length > 0) && (!state.lastRunAt || runAt >= state.lastRunAt);
  const metadata = runEvent && advancesRun ? { lastRunEvent: runEvent, lastScheduledRunAt: runEvent === 'schedule' ? runAt : state.lastScheduledRunAt ?? null } : { ...(state.lastRunEvent ? { lastRunEvent: state.lastRunEvent } : {}), ...(state.lastScheduledRunAt !== undefined ? { lastScheduledRunAt: state.lastScheduledRunAt } : {}) };
  return { state: { version: 1 as const, lastRunAt: enabled.length || state.watches.length ? (state.lastRunAt && state.lastRunAt > runAt ? state.lastRunAt : runAt) : state.lastRunAt, ...metadata, watches }, notifications, added };
}
