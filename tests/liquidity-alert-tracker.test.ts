import { expect, it } from 'vitest';
import { defaultAlertRules } from '../src/alert-rules';
import { advanceLiquidityAlerts, emptyLiquidityNotifications, emptyLiquidityState, enabledLiquidityWatches, parseLiquidityNotifications, parseLiquidityState } from '../server/liquidity-alert-tracker';
import type { LiquidityObservation, LiquidityWatch } from '../server/liquidity-alert-reader';
import type { WalletHistoryFile } from '../src/wallet-history';
const address = '0x1111111111111111111111111111111111111111', token = '0x2222222222222222222222222222222222222222', market = '0x3333333333333333333333333333333333333333';
const day = '2026-11-22T10:00:00.000Z', next = '2026-11-22T10:05:00.000Z', later = '2026-11-22T10:10:00.000Z';
const watch: LiquidityWatch = { address, network: 'ethereum', protocol: 'morpho', positionId: 'morpho-market-one', ruleUpdatedAt: day };
const history = (enabled = true, at = day): WalletHistoryFile => ({ version: 1, wallets: [{ address, lastCheckedAt: day, manualLiquidationPrices: [], alerts: [{ network: watch.network, protocol: watch.protocol, positionId: watch.positionId, updatedAt: at, rules: { ...defaultAlertRules(), newLiquidityAdded: enabled } }] }] });
const observe = (rawAmount: string, block = '100', checkedAt = day, w = watch): LiquidityObservation => ({ watch: w, checkedAt, blockNumber: block, status: 'ok', readings: [{ market, marketAddress: market, label: 'USDC market', token, symbol: 'USDC', decimals: 6, rawAmount, note: 'Verified cash' }] });
it('seeds first readings without a notification, then logs exact positive changes with address, market, units and timestamps', () => {
  const seeded = advanceLiquidityAlerts(history(), emptyLiquidityState(), emptyLiquidityNotifications(), [observe('100000000')], day);
  expect(seeded.added).toBe(0);
  const change = advanceLiquidityAlerts(history(), seeded.state, seeded.notifications, [observe('112345678', '101', next)], next);
  expect(change.added).toBe(1);
  expect(change.notifications.notifications[0]).toMatchObject({ address, market, token, previousLiquidity: '100', availableLiquidity: '112.345678', liquidityChange: '12.345678', changeRaw: '12345678', previousCheckedAt: day, timestamp: next, blockNumber: '101' });
  expect(parseLiquidityState(change.state)).toEqual(change.state); expect(parseLiquidityNotifications(change.notifications)).toEqual(change.notifications);
  const repeat = advanceLiquidityAlerts(history(), change.state, change.notifications, [observe('112345678', '101', next)], next);
  expect(repeat.added).toBe(0); expect(repeat.notifications.notifications).toHaveLength(1);
});
it('updates falling baselines, treats real zero correctly, and never turns failed reads into zero', () => {
  let s = advanceLiquidityAlerts(history(), emptyLiquidityState(), emptyLiquidityNotifications(), [observe('100')], day);
  s = advanceLiquidityAlerts(history(), s.state, s.notifications, [observe('0', '101', next)], next); expect(s.added).toBe(0);
  const failed = { ...observe('0', '102', later), status: 'error' as const, readings: [], message: 'Provider unavailable' };
  s = advanceLiquidityAlerts(history(), s.state, s.notifications, [failed], later); expect(s.state.watches[0].baselines[0].rawAmount).toBe('0');
  s = advanceLiquidityAlerts(history(), s.state, s.notifications, [observe('50', '103', '2026-11-22T10:15:00.000Z')], '2026-11-22T10:15:00.000Z');
  expect(s.notifications.notifications[0].changeRaw).toBe('50'); expect(s.notifications.notifications[0].previousCheckedAt).toBe(next);
});
it('resets baselines for disabled/re-enabled or edited rules, closes inactive holdings, and ignores changed rules while publishing', () => {
  const initial = advanceLiquidityAlerts(history(), emptyLiquidityState(), emptyLiquidityNotifications(), [observe('100')], day);
  expect(advanceLiquidityAlerts(history(false), initial.state, initial.notifications, [observe('200', '101', next)], next).state.watches).toEqual([]);
  const edited = advanceLiquidityAlerts(history(true, next), initial.state, initial.notifications, [observe('200', '101', next)], next);
  expect(edited.added).toBe(0); expect(edited.state.watches[0].status).toBe('pending');
  const reseed = advanceLiquidityAlerts(history(true, next), edited.state, edited.notifications, [observe('500', '102', later, { ...watch, ruleUpdatedAt: next })], later);
  expect(reseed.added).toBe(0);
  expect(advanceLiquidityAlerts(history(), initial.state, initial.notifications, [{ ...observe('100', '101', next), status: 'inactive', readings: [] }], next).state.watches[0].baselines).toEqual([]);
});
it('preserves precision beyond JavaScript numbers and isolates identical markets watched by different wallets', () => {
  const second = '0x4444444444444444444444444444444444444444'; const h = history(); h.wallets.push({ ...structuredClone(h.wallets[0]), address: second });
  const watches = enabledLiquidityWatches(h), value = '9007199254740993000000';
  let s = advanceLiquidityAlerts(h, emptyLiquidityState(), emptyLiquidityNotifications(), watches.map(w => observe(value, '100', day, w)), day);
  s = advanceLiquidityAlerts(h, s.state, s.notifications, watches.map(w => observe(String(BigInt(value) + 1n), '101', next, w)), next);
  expect(s.added).toBe(2); expect(new Set(s.notifications.notifications.map(n => n.id)).size).toBe(2);
  expect(s.notifications.notifications.map(n => n.liquidityChange)).toEqual(['0.000001', '0.000001']);
});
it('does not compare rolled-back blocks or changed token precision, and rejects corrupt persisted amounts', () => {
  const first = advanceLiquidityAlerts(history(), emptyLiquidityState(), emptyLiquidityNotifications(), [observe('100')], day);
  const rollback = advanceLiquidityAlerts(history(), first.state, first.notifications, [observe('200', '99', next)], next);
  expect(rollback.added).toBe(0); expect(rollback.state.watches[0].baselines[0].rawAmount).toBe('100');
  const changed = observe('500', '101', next); changed.readings[0].decimals = 18;
  expect(advanceLiquidityAlerts(history(), first.state, first.notifications, [changed], next).added).toBe(0);
  const corrupt = structuredClone(first.state); corrupt.watches[0].baselines[0].rawAmount = '-1'; expect(() => parseLiquidityState(corrupt)).toThrow();
});

it('distinguishes scheduled checks from manual recovery and preserves their timestamp on later manual runs', () => {
  let result = advanceLiquidityAlerts(history(), emptyLiquidityState(), emptyLiquidityNotifications(), [observe('100')], day, 'push');
  expect(result.state.lastScheduledRunAt).toBeNull();
  result = advanceLiquidityAlerts(history(), result.state, result.notifications, [observe('110', '101', next)], next, 'schedule');
  expect(result.state).toMatchObject({ lastScheduledRunAt: next, lastRunEvent: 'schedule' });
  result = advanceLiquidityAlerts(history(), result.state, result.notifications, [observe('120', '102', later)], later, 'workflow_dispatch');
  expect(parseLiquidityState(result.state)).toMatchObject({ lastScheduledRunAt: next, lastRunAt: later, lastRunEvent: 'workflow_dispatch' });
  const stale = advanceLiquidityAlerts(history(), result.state, result.notifications, [], day, 'schedule');
  expect(stale.state.lastScheduledRunAt).toBe(next); expect(stale.state.lastRunAt).toBe(later);
});
it('persists external-dispatch attribution without claiming a GitHub cron run and reads legacy states', () => {
  const s = advanceLiquidityAlerts(history(), emptyLiquidityState(), emptyLiquidityNotifications(), [observe('100')], day, 'external_scheduler');
  expect(parseLiquidityState(s.state)).toMatchObject({ lastExternalRunAt: day, lastScheduledRunAt: null, lastRunEvent: 'external_scheduler' });
  const manual = advanceLiquidityAlerts(history(), s.state, s.notifications, [observe('100', '101', next)], next, 'workflow_dispatch');
  expect(manual.state.lastExternalRunAt).toBe(day); expect(manual.state.lastScheduledRunAt).toBeNull();
  expect(() => parseLiquidityState({ ...s.state, lastExternalRunAt: 'invalid' })).toThrow();
  expect(parseLiquidityState(emptyLiquidityState())).toEqual(emptyLiquidityState());
});
