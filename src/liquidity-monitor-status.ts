import type { SavedWallet } from './wallet-history';
interface MonitorState {
  version: 1; lastRunAt: string | null; lastRunEvent?: string; lastScheduledRunAt?: string | null; lastExternalRunAt?: string | null;
  watches: { watch: { address: string; network: string; protocol: string; positionId: string; ruleUpdatedAt: string }; checkedAt: string; status: string }[];
}
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function liquidityMonitorStatus(value: unknown, wallet: SavedWallet, now = Date.now(), kind: 'liquidity' | 'utilization' = 'liquidity') {
  const label = kind === 'liquidity' ? 'Liquidity' : 'Utilization';
  const rules = (wallet.alerts ?? []).filter(a => kind === 'liquidity' ? a.rules.newLiquidityAdded : a.rules.utilizationAbove.enabled);
  if (!rules.length) return { warning: false, text: `No ${kind} alerts are enabled for this wallet.`, lastRunAt: null, lastScheduledRunAt: null, lastExternalRunAt: null };
  const s = value as MonitorState;
  if (!s || s.version !== 1 || !(s.lastRunAt === null || date(s.lastRunAt)) || !(s.lastScheduledRunAt == null || date(s.lastScheduledRunAt)) || !(s.lastExternalRunAt == null || date(s.lastExternalRunAt)) || !Array.isArray(s.watches) || s.watches.some(w => !w?.watch || typeof w.watch.address !== 'string' || typeof w.watch.positionId !== 'string' || !date(w.checkedAt))) return { warning: true, text: `${label} monitoring status could not be verified. Check Monitoring runs.`, lastRunAt: null, lastScheduledRunAt: null, lastExternalRunAt: null };
  const common = { lastRunAt: s.lastRunAt, lastScheduledRunAt: s.lastScheduledRunAt ?? null, lastExternalRunAt: s.lastExternalRunAt ?? null };
  const automaticAt = [s.lastScheduledRunAt, s.lastExternalRunAt].filter((v): v is string => !!v).sort((a,b) => Date.parse(b) - Date.parse(a))[0];
  if (!automaticAt) return { ...common, warning: true, text: `Scheduled ${kind} monitoring is not confirmed: no scheduled run has been recorded and no external trigger has been recorded. A successful manual check does not confirm the schedule is running.` };
  if (now - Date.parse(automaticAt) > 15 * 60000) return { ...common, warning: true, text: `Scheduled ${kind} monitoring is overdue: no GitHub cron or external-triggered check has been recorded in the last 15 minutes.` };
  const matched = rules.map(rule => s.watches.find(w => w.watch.address.toLowerCase() === wallet.address.toLowerCase() && w.watch.network === rule.network && w.watch.protocol === rule.protocol && w.watch.positionId.toLowerCase() === rule.positionId.toLowerCase() && w.watch.ruleUpdatedAt === rule.updatedAt));
  if (matched.some(w => !w || now - Date.parse(w.checkedAt) > 15 * 60000)) return { ...common, warning: true, text: `One or more enabled ${kind} alerts are waiting for a recent check with their current preferences.` };
  if (matched.some(w => w?.status !== 'ok')) return { ...common, warning: true, text: `One or more enabled ${kind} alerts could not be verified or are inactive. Check Monitoring runs for details.` };
  return { ...common, warning: false, text: automaticAt === s.lastExternalRunAt ? `Recent externally triggered ${kind} checks are recorded for your enabled positions.` : `Recent scheduled ${kind} checks are confirmed for your enabled positions.` };
}
