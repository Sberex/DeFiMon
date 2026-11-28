import { alertRunMetadata, isAlertRunEvent, type AlertRunEvent } from './alert-run.js';
import { createHash } from 'node:crypto';
import { parseWalletHistory, type WalletHistoryFile } from '../src/wallet-history.js';
import { defaultAlertRules } from '../src/alert-rules.js';
import { watchKey } from './liquidity-alert-tracker.js';
import type { UtilizationWatch, UtilizationReading, UtilizationObservation } from './utilization-alert-reader.js';
export interface UtilizationBaseline extends UtilizationReading { checkedAt: string; blockNumber: string }
export interface UtilizationWatchState { watch: UtilizationWatch; checkedAt: string; status: UtilizationObservation['status'] | 'pending'; message?: string; baselines: UtilizationBaseline[] }
export interface UtilizationState { version: 1; lastRunAt: string | null; lastRunEvent?: string; lastScheduledRunAt?: string | null; lastExternalRunAt?: string | null; watches: UtilizationWatchState[] }
export interface UtilizationNotification {
  id: string; type: 'utilization-above-threshold'; address: string; network: UtilizationWatch['network']; protocol: string; positionId: string;
  market: string; marketAddress: string; marketLabel: string; token: string; symbol: string; thresholdPercent: number;
  previousUtilizationPercent: number | null; utilizationPercent: number; utilizationChangePercentagePoints: number | null;
  previousCheckedAt: string | null; timestamp: string; blockNumber: string; note: string; borrowApr?: number | null;
}
export interface UtilizationNotifications { version: 1; notifications: UtilizationNotification[] }
export const emptyUtilizationState = (): UtilizationState => ({ version: 1, lastRunAt: null, watches: [] });
export const emptyUtilizationNotifications = (): UtilizationNotifications => ({ version: 1, notifications: [] });
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const percent = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const raw = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v);
const key = (q: UtilizationReading) => `${q.market.toLowerCase()}:${q.token.toLowerCase()}`;
function validReading(q: UtilizationReading) { return q && typeof q.market === 'string' && q.market.length > 0 && /^0x[\da-f]{40}$/i.test(q.marketAddress) && /^0x[\da-f]{40}$/i.test(q.token) && typeof q.symbol === 'string' && q.symbol.length > 0 && q.symbol.length <= 128 && typeof q.label === 'string' && typeof q.note === 'string' && percent(q.utilizationPercent) && (q.borrowApr === undefined || q.borrowApr === null || typeof q.borrowApr === 'number' && Number.isFinite(q.borrowApr)); }
function validateWatch(w: UtilizationWatch, checkedAt: string) {
  if (!w || !percent(w.thresholdPercent) || w.thresholdPercent > 100) throw Error('Invalid utilization watch');
  parseWalletHistory({ version: 1, wallets: [{ address: w.address, lastCheckedAt: checkedAt, manualLiquidationPrices: [], alerts: [{ network: w.network, protocol: w.protocol, positionId: w.positionId, updatedAt: w.ruleUpdatedAt, rules: { ...defaultAlertRules(), utilizationAbove: { enabled: true, thresholdPercent: w.thresholdPercent } } }] }] });
}
export function enabledUtilizationWatches(history: WalletHistoryFile): UtilizationWatch[] {
  return parseWalletHistory(history).wallets.flatMap(w => (w.alerts ?? []).filter(a => a.rules.utilizationAbove.enabled).map(a => ({ address: w.address, network: a.network, protocol: a.protocol, positionId: a.positionId, ruleUpdatedAt: a.updatedAt, thresholdPercent: a.rules.utilizationAbove.thresholdPercent! })));
}
export function parseUtilizationState(value: unknown): UtilizationState {
  const f = value as UtilizationState;
  if (!f || f.version !== 1 || !(f.lastRunAt === null || iso(f.lastRunAt)) || f.lastScheduledRunAt != null && !iso(f.lastScheduledRunAt) || f.lastRunEvent !== undefined && !isAlertRunEvent(f.lastRunEvent) || f.lastExternalRunAt != null && !iso(f.lastExternalRunAt) || !Array.isArray(f.watches)) throw Error('Invalid utilization state; existing data retained.');
  const seen = new Set<string>();
  for (const w of f.watches) {
    validateWatch(w.watch, w.checkedAt);
    if (!iso(w.checkedAt) || !['ok','error','inactive','unsupported','pending'].includes(w.status) || !Array.isArray(w.baselines) || seen.has(watchKey(w.watch))) throw Error('Invalid utilization baseline');
    seen.add(watchKey(w.watch)); const keys = new Set<string>();
    for (const b of w.baselines) { if (!validReading(b) || !iso(b.checkedAt) || !raw(b.blockNumber) || keys.has(key(b))) throw Error('Invalid utilization baseline'); keys.add(key(b)); }
  }
  return structuredClone(f);
}
export function parseUtilizationNotifications(value: unknown): UtilizationNotifications {
  const f = value as UtilizationNotifications; if (!f || f.version !== 1 || !Array.isArray(f.notifications)) throw Error('Invalid utilization notifications');
  const ids = new Set<string>();
  for (const n of f.notifications) {
    if (!n || !/^[\da-f]{64}$/.test(n.id) || ids.has(n.id) || n.type !== 'utilization-above-threshold' || !validReading({ ...n, label: n.marketLabel }) || !percent(n.thresholdPercent) || n.thresholdPercent > 100 || n.utilizationPercent <= n.thresholdPercent || !iso(n.timestamp) || !raw(n.blockNumber)) throw Error('Invalid utilization notification');
    if (n.previousUtilizationPercent === null ? n.previousCheckedAt !== null || n.utilizationChangePercentagePoints !== null : !percent(n.previousUtilizationPercent) || !iso(n.previousCheckedAt) || n.utilizationChangePercentagePoints !== n.utilizationPercent - n.previousUtilizationPercent) throw Error('Invalid utilization change');
    validateWatch({ ...n, ruleUpdatedAt: n.timestamp }, n.timestamp); ids.add(n.id);
  }
  return structuredClone(f);
}
export function advanceUtilizationAlerts(history: WalletHistoryFile, previous: UtilizationState, previousNotifications: UtilizationNotifications, observations: UtilizationObservation[], runAt: string, runEvent?: AlertRunEvent) {
  if (!iso(runAt)) throw Error('Invalid tracker time');
  const state = parseUtilizationState(previous), notifications = parseUtilizationNotifications(previousNotifications);
  const enabled = enabledUtilizationWatches(history), old = new Map(state.watches.map(w => [watchKey(w.watch), w])), incoming = new Map(observations.map(o => [watchKey(o.watch), o]));
  const ids = new Set(notifications.notifications.map(n => n.id)); let added = 0;
  const watches = enabled.map(watch => {
    const existing = old.get(watchKey(watch)), observation = incoming.get(watchKey(watch));
    const prior = existing?.watch.ruleUpdatedAt === watch.ruleUpdatedAt && existing.watch.thresholdPercent === watch.thresholdPercent ? existing : undefined;
    if (prior && prior.checkedAt >= runAt) return prior;
    if (!observation || observation.watch.ruleUpdatedAt !== watch.ruleUpdatedAt || observation.watch.thresholdPercent !== watch.thresholdPercent) return prior ?? { watch, checkedAt: runAt, status: 'pending' as const, baselines: [] };
    if (!iso(observation.checkedAt) || observation.checkedAt > runAt || !raw(observation.blockNumber) || !['ok','error','inactive','unsupported'].includes(observation.status) || observation.readings.some(q => !validReading(q)) || new Set(observation.readings.map(key)).size !== observation.readings.length) throw Error('Invalid utilization observation');
    if (prior && observation.checkedAt <= prior.checkedAt) return prior;
    if (observation.status !== 'ok' || !observation.readings.length) return { watch, checkedAt: observation.checkedAt, status: observation.status === 'ok' ? 'error' as const : observation.status, message: observation.message ?? 'No verified utilization readings.', baselines: observation.status === 'inactive' ? [] : prior?.baselines ?? [] };
    const last = new Map((prior?.baselines ?? []).map(b => [key(b), b]));
    const baselines = observation.readings.map(q => {
      const old = last.get(key(q)), before = old?.marketAddress.toLowerCase() === q.marketAddress.toLowerCase() ? old : undefined;
      if (before && BigInt(observation.blockNumber) <= BigInt(before.blockNumber)) return before;
      if (q.utilizationPercent > watch.thresholdPercent && (!before || before.utilizationPercent <= watch.thresholdPercent)) {
        const id = createHash('sha256').update(JSON.stringify([watchKey(watch), key(q), watch.ruleUpdatedAt, watch.thresholdPercent, before?.blockNumber ?? null, observation.blockNumber])).digest('hex');
        if (!ids.has(id)) { ids.add(id); added++; notifications.notifications.push({ id, type: 'utilization-above-threshold', address: watch.address, network: watch.network, protocol: watch.protocol, positionId: watch.positionId, market: q.market, marketAddress: q.marketAddress, marketLabel: q.label, token: q.token, symbol: q.symbol, thresholdPercent: watch.thresholdPercent, previousUtilizationPercent: before?.utilizationPercent ?? null, utilizationPercent: q.utilizationPercent, utilizationChangePercentagePoints: before ? q.utilizationPercent - before.utilizationPercent : null, previousCheckedAt: before?.checkedAt ?? null, timestamp: observation.checkedAt, blockNumber: observation.blockNumber, note: q.note, borrowApr: q.borrowApr ?? null }); }
      }
      return { ...q, checkedAt: observation.checkedAt, blockNumber: observation.blockNumber };
    });
    return { watch, checkedAt: observation.checkedAt, status: 'ok' as const, baselines };
  });
  const advance = (enabled.length || state.watches.length) && (!state.lastRunAt || runAt >= state.lastRunAt);
  return { state: { version: 1 as const, lastRunAt: advance ? runAt : state.lastRunAt, ...alertRunMetadata(state, runAt, runEvent, Boolean(advance)), watches }, notifications, added };
}
