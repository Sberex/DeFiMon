import { expect, it, vi } from 'vitest';
import { deliverTelegramAlerts, parseTelegramState, sendTelegramMessage, telegramAlertText, type TelegramAlert, type TelegramSnapshot, type TelegramStore } from '../server/telegram-alerts';
import { at, liquidity, utilization, snapshot } from './fixtures/telegram';
function memory(value = snapshot()) {
  const store: TelegramStore = { read: async () => structuredClone(value), update: async change => { value.state = parseTelegramState(change(structuredClone(value.state), structuredClone(value))); return structuredClone(value.state); } };
  return { store, value };
}
it('formats both alert types with wallet, market, values, change and original timestamp; keeps text within Telegram limits', () => {
  const text = telegramAlertText({ ...liquidity, marketLabel: 'sUSDai / USDC', timestamp: '2026-11-26T15:31:18.984Z' });
  expect(text.split('\n')).toEqual(['New market liquidity', `Wallet: ${liquidity.address}`, 'Chain: Ethereum', 'Market: Morpho · sUSDai / USDC', 'Asset: USDC', 'Available: 1 → 2 USDC', 'Increase: +1 USDC', 'Observed: 26/11/2026, 17:31:18 EET (Kyiv)']);
  expect(text).not.toContain(liquidity.marketAddress); expect(text).not.toContain(liquidity.token); expect(text).not.toContain(liquidity.id); expect(text).not.toContain('https://');
  expect(telegramAlertText(utilization)).toContain('Change: +2 percentage points');
  const first = { ...utilization, previousUtilizationPercent: null, previousCheckedAt: null, utilizationChangePercentagePoints: null } as typeof utilization;
  expect(telegramAlertText(first)).toContain('unknown (first observation)');
  expect(telegramAlertText({ ...liquidity, marketLabel: 'x'.repeat(5000) }).length).toBeLessThan(4096);
});
it('records each successful send durably and skips it on later runs', async () => {
  const m = memory(), send = vi.fn(async (_text: string) => ({ ok: true as const, messageId: 123 }));
  const options = { store: m.store, send, owner: 'worker-one', now: () => Date.parse(at(2)), sleep: async () => {} };
  expect(await deliverTelegramAlerts(options)).toMatchObject({ sent: 2, failed: 0 }); expect(send).toHaveBeenCalledTimes(2);
  expect(m.value.state.deliveries.every(r => r.status === 'sent' && r.messageId === 123)).toBe(true);
  expect(await deliverTelegramAlerts({ ...options, owner: 'worker-two' })).toMatchObject({ sent: 0, attempted: 0 }); expect(send).toHaveBeenCalledTimes(2);
});
it('does not replay historical notifications or send queued alerts for disabled or edited preferences', async () => {
  const s = snapshot(); s.state.enabledAt = at(2); const send = vi.fn();
  expect((await deliverTelegramAlerts({ store: memory(s).store, send, owner: 'worker', now: () => Date.parse(at(3)) })).sent).toBe(0); expect(send).not.toHaveBeenCalled();
  const m = memory(); m.value.history.wallets[0].alerts![0].rules.newLiquidityAdded = false; m.value.history.wallets[0].alerts![0].rules.utilizationAbove.thresholdPercent = 95;
  expect(await deliverTelegramAlerts({ store: m.store, send, owner: 'worker', now: () => Date.parse(at(2)) })).toMatchObject({ skipped: 2, sent: 0 }); expect(send).not.toHaveBeenCalled();
});
it('persists failures and retries only when due, respecting Telegram retry_after', async () => {
  const s = snapshot(); s.notifications = [liquidity]; const m = memory(s), send = vi.fn().mockResolvedValueOnce({ ok: false, error: 'rate_limited', retryAfterSeconds: 600 }).mockResolvedValue({ ok: true, messageId: 15 });
  const options = { store: m.store, send, owner: 'worker-one', now: () => Date.parse(at(2)) };
  expect(await deliverTelegramAlerts(options)).toMatchObject({ failed: 1 }); expect(m.value.state.deliveries[0]).toMatchObject({ status: 'failed', attempts: 1, nextAttemptAt: at(12), error: 'rate_limited' });
  await deliverTelegramAlerts({ ...options, owner: 'worker-two', now: () => Date.parse(at(3)) }); expect(send).toHaveBeenCalledTimes(1);
  expect(await deliverTelegramAlerts({ ...options, owner: 'worker-three', now: () => Date.parse(at(12)) })).toMatchObject({ sent: 1 }); expect(send).toHaveBeenCalledTimes(2); expect(m.value.state.deliveries[0].attempts).toBe(2);
});
it('requires a persisted lease before sending; waits for stale leases and checkpoints each successful message before the next one', async () => {
  const s = snapshot(); s.notifications = [liquidity];
  s.state.deliveries.push({ notificationId: liquidity.id, kind: 'liquidity', status: 'sending', attempts: 1, lastAttemptAt: at(1), nextAttemptAt: at(6), owner: 'other-worker' });
  const m = memory(s), send = vi.fn(async (_text: string) => ({ ok: true as const, messageId: 4 }));
  await deliverTelegramAlerts({ store: m.store, send, owner: 'worker', now: () => Date.parse(at(2)) }); expect(send).not.toHaveBeenCalled();
  await deliverTelegramAlerts({ store: m.store, send, owner: 'worker', now: () => Date.parse(at(6)) }); expect(send).toHaveBeenCalledTimes(1);
  const broken: TelegramStore = { read: async () => snapshot(), update: async () => { throw Error('storage failed'); } };
  await expect(deliverTelegramAlerts({ store: broken, send, owner: 'worker', now: () => Date.parse(at(2)) })).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(1);
  const partial = memory(); let calls = 0;
  const result = await deliverTelegramAlerts({ store: partial.store, owner: 'worker', now: () => Date.parse(at(2)), sleep: async () => {}, send: async () => { calls++; if (calls === 2) { expect(partial.value.state.deliveries[0].status).toBe('sent'); return { ok: false, error: 'network_error' }; } return { ok: true, messageId: 1 }; } });
  expect(result).toMatchObject({ sent: 1, failed: 1 });
});
it('sends an explicit connection test without creating a fake market alert and limits batches', async () => {
  const m = memory(), send = vi.fn(async (_text: string) => ({ ok: true as const, messageId: 2 }));
  const result = await deliverTelegramAlerts({ store: m.store, send, owner: 'worker', testId: 'c'.repeat(64), limit: 1, now: () => Date.parse(at(2)) });
  expect(result.sent).toBe(1); expect(send.mock.calls[0][0]).toContain('Telegram delivery test'); expect(m.value.state.deliveries[0].kind).toBe('test'); expect(m.value.notifications).toHaveLength(2);
});
it('uses plain Telegram text and sanitizes failures without exposing the bot URL, token, chat ID or Telegram response', async () => {
  const secret = '12345:secret-token', chat = '987654321';
  const fetcher = vi.fn(async (_url: any, init: any) => { const body = JSON.parse(init.body); expect(body.chat_id).toBe(chat); expect(body.parse_mode).toBeUndefined(); return Response.json({ ok: true, result: { message_id: 44, chat: { id: chat } } }); }) as any;
  expect(await sendTelegramMessage(secret, chat, '<unsafe-markup>', fetcher)).toEqual({ ok: true, messageId: 44 });
  const failed = await sendTelegramMessage(secret, chat, 'text', (async () => Response.json({ ok: false, error_code: 401, description: secret+chat }, { status: 401 })) as any);
  expect(failed).toEqual({ ok: false, error: 'unauthorized' }); expect(JSON.stringify(failed)).not.toContain(secret); expect(JSON.stringify(failed)).not.toContain(chat);
  expect(await sendTelegramMessage(secret, chat, 'text', (async () => { throw Error(`https://api.telegram.org/bot${secret}/sendMessage`); }) as any)).toEqual({ ok: false, error: 'network_error' });
  expect(await sendTelegramMessage(secret, chat, 'text', (async () => Response.json({ ok: false, error_code: 429, parameters: { retry_after: 120 } }, { status: 429 })) as any)).toMatchObject({ ok: false, error: 'rate_limited', retryAfterSeconds: 120 });
});
it('rejects malformed or secret-bearing delivery state rather than overwriting it', () => {
  expect(() => parseTelegramState({ ...snapshot().state, botToken: 'secret' })).toThrow();
  const s = snapshot().state; s.deliveries.push({ notificationId: liquidity.id, kind: 'liquidity', status: 'sent', attempts: 1, lastAttemptAt: at(2), nextAttemptAt: null }); expect(() => parseTelegramState(s)).toThrow();
});
