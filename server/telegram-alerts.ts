import type { WalletHistoryFile } from '../src/wallet-history.js';
import { networkNames } from '../src/networks.js';
import type { LiquidityNotification } from './liquidity-alert-tracker.js';
import type { UtilizationNotification } from './utilization-alert-tracker.js';
export type TelegramAlert = LiquidityNotification | UtilizationNotification;
export type DeliveryError = 'unauthorized' | 'forbidden' | 'invalid_request' | 'rate_limited' | 'telegram_unavailable' | 'invalid_response' | 'network_error' | 'preference_changed';
export interface TelegramReceipt {
  notificationId: string; kind: 'liquidity' | 'utilization' | 'test'; status: 'sending' | 'sent' | 'failed' | 'skipped';
  attempts: number; lastAttemptAt: string; nextAttemptAt: string | null; owner?: string; messageId?: number; sentAt?: string; error?: DeliveryError;
}
export interface TelegramState { version: 1; enabledAt: string; deliveries: TelegramReceipt[] }
export interface TelegramSnapshot { state: TelegramState; history: WalletHistoryFile; notifications: TelegramAlert[] }
export interface TelegramStore {
  read(): Promise<TelegramSnapshot>;
  update(change: (state: TelegramState, snapshot: TelegramSnapshot) => TelegramState): Promise<TelegramState>;
}
export type TelegramResult = { ok: true; messageId: number } | { ok: false; error: Exclude<DeliveryError, 'preference_changed'>; retryAfterSeconds?: number };
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const id = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{64}$/.test(v);
const errors: DeliveryError[] = ['unauthorized','forbidden','invalid_request','rate_limited','telegram_unavailable','invalid_response','network_error','preference_changed'];
export function parseTelegramState(value: unknown): TelegramState {
  const s = value as TelegramState;
  if (!s || s.version !== 1 || !iso(s.enabledAt) || !Array.isArray(s.deliveries) || Object.keys(s).some(k => !['version','enabledAt','deliveries'].includes(k))) throw Error('Invalid Telegram delivery state; existing records retained.');
  const seen = new Set<string>();
  for (const r of s.deliveries) {
    if (!r || !id(r.notificationId) || seen.has(r.notificationId) || !['liquidity','utilization','test'].includes(r.kind) || !['sending','sent','failed','skipped'].includes(r.status) || !Number.isSafeInteger(r.attempts) || r.attempts < 0 || !iso(r.lastAttemptAt) || !(r.nextAttemptAt === null || iso(r.nextAttemptAt)) || r.error !== undefined && !errors.includes(r.error) || Object.keys(r).some(k => !['notificationId','kind','status','attempts','lastAttemptAt','nextAttemptAt','owner','messageId','sentAt','error'].includes(k))) throw Error('Invalid Telegram delivery receipt.');
    if (r.status === 'sent' && (!iso(r.sentAt) || !Number.isSafeInteger(r.messageId) || r.messageId! <= 0 || r.nextAttemptAt !== null) || r.status === 'sending' && (typeof r.owner !== 'string' || !/^[\w-]{1,128}$/.test(r.owner) || !iso(r.nextAttemptAt)) || r.status === 'failed' && (!r.error || !iso(r.nextAttemptAt))) throw Error('Invalid Telegram delivery status.');
    seen.add(r.notificationId);
  }
  return structuredClone(s);
}
export function telegramAlertEnabled(n: TelegramAlert, history: WalletHistoryFile) {
  const wallet = history.wallets.find(w => w.address.toLowerCase() === n.address.toLowerCase());
  const rule = wallet?.alerts?.find(a => a.network === n.network && a.protocol === n.protocol && a.positionId.toLowerCase() === n.positionId.toLowerCase());
  if (!rule || rule.updatedAt > n.timestamp) return false;
  return n.type === 'available-liquidity-increased' ? rule.rules.newLiquidityAdded : rule.rules.utilizationAbove.enabled && rule.rules.utilizationAbove.thresholdPercent === n.thresholdPercent;
}
const clip = (s: string, length: number) => s.length > length ? s.slice(0, length - 1).replace(/[\uD800-\uDBFF]$/, '') + '…' : s;
export function telegramAlertText(n: TelegramAlert) {
  const at = new Date(n.timestamp).toLocaleString('en-GB', { timeZone: 'Europe/Kiev', timeZoneName: 'short', hour12: false });
  if (n.type === 'available-liquidity-increased') {
    const names: Record<string, string> = { morpho: 'Morpho', lista: 'Lista DAO', spark: 'Spark', 'aave-v3': 'Aave v3', 'aave-v4': 'Aave v4', euler: 'Euler', compound: 'Compound', fluid: 'Fluid' };
    const protocol = names[n.protocol] ?? n.protocol, label = clip(n.marketLabel.replace(/\s+/g, ' ').trim(), 200);
    const market = label.toLowerCase().startsWith(protocol.toLowerCase() + ' · ') || label === protocol ? label : `${protocol} · ${label}`;
    const symbol = n.symbol.replace(/\s+/g, ' ').trim();
    return clip(['New market liquidity', `Wallet: ${n.address}`, `Chain: ${networkNames[n.network]}`, `Market: ${market}`, `Asset: ${symbol}`, `Available: ${n.previousLiquidity} → ${n.availableLiquidity} ${symbol}`, `Increase: +${n.liquidityChange} ${symbol}`, `Observed: ${at} (Kyiv)`].join('\n'), 3800);
  }
  const common = [`Wallet: ${n.address}`, `Chain: ${networkNames[n.network]}`, `Market: ${clip(n.marketLabel, 200)}`, `Market ID: ${clip(n.market, 512)}`, `Market contract: ${n.marketAddress}`, `Asset: ${n.symbol} (${n.token})`];
  const values = ['DeFiMon · Utilization above threshold', `Threshold: ${n.thresholdPercent}%`, `Utilization: ${n.utilizationPercent}%`, `Previous: ${n.previousUtilizationPercent === null ? 'unknown (first observation)' : `${n.previousUtilizationPercent}%`}`, `Change: ${n.utilizationChangePercentagePoints === null ? 'unknown (first observation)' : `${n.utilizationChangePercentagePoints >= 0 ? '+' : ''}${n.utilizationChangePercentagePoints} percentage points`}`];
  const path = 'utilization';
  return clip([values[0], ...common, ...values.slice(1), `Observed: ${at} (Kyiv)`, `UTC: ${n.timestamp}`, `Block: ${n.blockNumber}`, `Alert ID: ${n.id}`, `https://github.com/Sberex/DeFiMon/blob/main/analysis/${path}-alert-notifications.json`].join('\n'), 3800);
}
/** Never return Telegram descriptions or transport exceptions: they may contain credentials or chat data. */
export async function sendTelegramMessage(token: string, chatId: string, text: string, fetcher: typeof fetch = fetch): Promise<TelegramResult> {
  try {
    const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: clip(text, 3800), link_preview_options: { is_disabled: true } }), signal: AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => null);
    if (response.ok && data?.ok === true && Number.isSafeInteger(data.result?.message_id) && data.result.message_id > 0) return { ok: true, messageId: data.result.message_id };
    const code = Number(data?.error_code ?? response.status);
    if (code === 429) return { ok: false, error: 'rate_limited', retryAfterSeconds: Math.min(86400, Math.max(1, Number.isFinite(data?.parameters?.retry_after) ? Math.ceil(data.parameters.retry_after) : 300)) };
    return { ok: false, error: code === 401 ? 'unauthorized' : code === 403 ? 'forbidden' : code >= 500 ? 'telegram_unavailable' : [400,404].includes(code) ? 'invalid_request' : 'invalid_response' };
  } catch { return { ok: false, error: 'network_error' }; }
}
export async function deliverTelegramAlerts(options: { store: TelegramStore; send: (text: string) => Promise<TelegramResult>; owner: string; testId?: string; now?: () => number; sleep?: (ms: number) => Promise<void>; limit?: number }) {
  const { store, send, owner } = options, now = options.now ?? Date.now, sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  if (!/^[\w-]{1,128}$/.test(owner) || options.testId !== undefined && !id(options.testId)) throw Error('Invalid delivery run identifier.');
  const start = now(), initial = await store.read();
  const initialReceipts = new Map(initial.state.deliveries.map(r => [r.notificationId, r]));
  const candidates: { id: string; kind: TelegramReceipt['kind'] }[] = initial.notifications.filter(n => n.timestamp >= initial.state.enabledAt).sort((a,b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)).map(n => ({ id: n.id, kind: n.type === 'available-liquidity-increased' ? 'liquidity' as const : 'utilization' as const }));
  if (options.testId) candidates.unshift({ id: options.testId, kind: 'test' });
  let sent = 0, failed = 0, skipped = 0, attempted = 0, lastSendAt = -Infinity;
  const failureCodes: DeliveryError[] = [];
  for (const candidate of candidates) {
    if (attempted >= (options.limit ?? 10) || now() - start >= 120000) break;
    const claimAt = new Date(now()).toISOString(), initialReceipt = initialReceipts.get(candidate.id);
    if (initialReceipt && (['sent','skipped'].includes(initialReceipt.status) || initialReceipt.nextAttemptAt !== null && initialReceipt.nextAttemptAt > claimAt)) continue;
    // A durable five-minute lease plus workflow concurrency prevents concurrent senders.
    // Reload current preferences and receipt state during every claim, including CAS retries.
    const state = await store.update((state, snapshot) => {
      const index = state.deliveries.findIndex(r => r.notificationId === candidate.id), before = state.deliveries[index];
      if (before && (['sent','skipped'].includes(before.status) || before.nextAttemptAt !== null && before.nextAttemptAt > claimAt)) return state;
      const n = snapshot.notifications.find(n => n.id === candidate.id);
      const enabled = candidate.kind === 'test' || n && n.timestamp >= state.enabledAt && telegramAlertEnabled(n, snapshot.history);
      const receipt: TelegramReceipt = enabled ? { notificationId: candidate.id, kind: candidate.kind, status: 'sending', attempts: (before?.attempts ?? 0) + 1, lastAttemptAt: claimAt, nextAttemptAt: new Date(Date.parse(claimAt) + 300000).toISOString(), owner } : { notificationId: candidate.id, kind: candidate.kind, status: 'skipped', attempts: before?.attempts ?? 0, lastAttemptAt: claimAt, nextAttemptAt: null, error: 'preference_changed' };
      if (index < 0) state.deliveries.push(receipt); else state.deliveries[index] = receipt; return state;
    });
    const claim = state.deliveries.find(r => r.notificationId === candidate.id)!;
    if (claim.status === 'skipped') { skipped++; continue; }
    if (claim.status !== 'sending' || claim.owner !== owner || claim.lastAttemptAt !== claimAt) continue;
    const notification = initial.notifications.find(n => n.id === candidate.id);
    const text = candidate.kind === 'test' ? `DeFiMon · Telegram delivery test\nLiquidity and utilization alert delivery is connected.\nTest time: ${claimAt}\nhttps://github.com/Sberex/DeFiMon/actions/workflows/market-liquidity-monitor.yml` : telegramAlertText(notification!);
    const delay = 1100 - (now() - lastSendAt); if (delay > 0) await sleep(delay);
    lastSendAt = now(); attempted++;
    // The transport normally returns sanitized results. Treat an injected/transport throw as an ambiguous network failure.
    const result: TelegramResult = await send(text).catch((): TelegramResult => ({ ok: false, error: 'network_error' }));
    const finishedAt = new Date(now()).toISOString();
    await store.update(state => {
      const index = state.deliveries.findIndex(r => r.notificationId === candidate.id), receipt = state.deliveries[index];
      if (!receipt || receipt.status !== 'sending' || receipt.owner !== owner) throw Error('Telegram delivery checkpoint changed; a message may already have been sent.');
      state.deliveries[index] = result.ok ? { notificationId: receipt.notificationId, kind: receipt.kind, status: 'sent', attempts: receipt.attempts, lastAttemptAt: receipt.lastAttemptAt, nextAttemptAt: null, messageId: result.messageId, sentAt: finishedAt } : { notificationId: receipt.notificationId, kind: receipt.kind, status: 'failed', attempts: receipt.attempts, lastAttemptAt: receipt.lastAttemptAt, nextAttemptAt: new Date(now() + (result.retryAfterSeconds ?? Math.min(3600, 300 * 2 ** Math.min(receipt.attempts - 1, 4))) * 1000).toISOString(), error: result.error };
      return state;
    });
    if (result.ok) sent++; else { failed++; failureCodes.push(result.error); break; }
  }
  return { sent, failed, skipped, attempted, failureCodes };
}
