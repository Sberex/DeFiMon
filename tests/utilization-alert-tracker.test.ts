import { expect, it } from 'vitest';
import { defaultAlertRules } from '../src/alert-rules';
import type { WalletHistoryFile } from '../src/wallet-history';
import type { UtilizationWatch, UtilizationObservation } from '../server/utilization-alert-reader';
import { advanceUtilizationAlerts, emptyUtilizationState, emptyUtilizationNotifications, parseUtilizationState, parseUtilizationNotifications } from '../server/utilization-alert-tracker';
const time = (i: number) => new Date(Date.parse('2026-11-23T06:00:00.000Z') + i * 300000).toISOString();
const watch: UtilizationWatch = { address: '0x1111111111111111111111111111111111111111', network: 'ethereum', protocol: 'morpho', positionId: 'market-one', ruleUpdatedAt: time(0), thresholdPercent: 90 };
const history = (enabled = true, threshold = 90, updatedAt = time(0)): WalletHistoryFile => ({ version: 1, wallets: [{ address: watch.address, lastCheckedAt: time(0), manualLiquidationPrices: [], alerts: [{ network: watch.network, protocol: watch.protocol, positionId: watch.positionId, updatedAt, rules: { ...defaultAlertRules(), utilizationAbove: { enabled, thresholdPercent: threshold } } }] }] });
const observe = (value: number, i: number, status: UtilizationObservation['status'] = 'ok', w = watch): UtilizationObservation => ({ watch: w, checkedAt: time(i), blockNumber: String(100+i), status, readings: status === 'ok' ? [{ market: 'one', marketAddress: '0x2222222222222222222222222222222222222222', token: '0x3333333333333333333333333333333333333333', symbol: 'USDC', label: 'Market one', utilizationPercent: value, note: 'Total borrowed / supplied × 100.' }] : [] });
const seed = (value = 89) => advanceUtilizationAlerts(history(), emptyUtilizationState(), emptyUtilizationNotifications(), [observe(value, 0)], time(0), 'schedule');
it('alerts only strictly above the threshold, records percentage point change, re-arms and suppresses repeated above-threshold samples', () => {
  let s = seed(); expect(s.added).toBe(0);
  s = advanceUtilizationAlerts(history(), s.state, s.notifications, [observe(90, 1)], time(1)); expect(s.added).toBe(0);
  s = advanceUtilizationAlerts(history(), s.state, s.notifications, [observe(92.5, 2)], time(2)); expect(s.added).toBe(1);
  expect(s.notifications.notifications[0]).toMatchObject({ address: watch.address, market: 'one', thresholdPercent: 90, previousUtilizationPercent: 90, utilizationPercent: 92.5, utilizationChangePercentagePoints: 2.5, previousCheckedAt: time(1), timestamp: time(2) });
  s = advanceUtilizationAlerts(history(), s.state, s.notifications, [observe(98, 3)], time(3)); expect(s.added).toBe(0);
  s = advanceUtilizationAlerts(history(), s.state, s.notifications, [observe(90, 4)], time(4));
  s = advanceUtilizationAlerts(history(), s.state, s.notifications, [observe(95, 5)], time(5)); expect(s.added).toBe(1); expect(s.notifications.notifications).toHaveLength(2);
  expect(parseUtilizationState(s.state)).toEqual(s.state); expect(parseUtilizationNotifications(s.notifications)).toEqual(s.notifications);
});
it('notifies on an already breached first observation without fabricating the previous value or change', () => {
  const s = seed(95); expect(s.added).toBe(1);
  expect(s.notifications.notifications[0]).toMatchObject({ previousUtilizationPercent: null, previousCheckedAt: null, utilizationChangePercentagePoints: null, utilizationPercent: 95 });
  expect(advanceUtilizationAlerts(history(), s.state, s.notifications, [observe(95, 0)], time(0)).added).toBe(0);
});
it('preserves baselines on errors and ignores older blocks; closed and disabled positions stop monitoring', () => {
  let s = seed(95);
  s = advanceUtilizationAlerts(history(), s.state, s.notifications, [observe(0, 1, 'error')], time(1)); expect(s.state.watches[0].baselines[0].utilizationPercent).toBe(95);
  const rolled = { ...observe(0, 2), blockNumber: '99' };
  s = advanceUtilizationAlerts(history(), s.state, s.notifications, [rolled], time(2)); expect(s.state.watches[0].baselines[0].utilizationPercent).toBe(95);
  s = advanceUtilizationAlerts(history(), s.state, s.notifications, [observe(99, 3)], time(3)); expect(s.added).toBe(0);
  expect(advanceUtilizationAlerts(history(false), s.state, s.notifications, [observe(99, 4)], time(4)).state.watches).toHaveLength(0);
  expect(advanceUtilizationAlerts(history(), s.state, s.notifications, [observe(0, 4, 'inactive')], time(4)).state.watches[0].baselines).toHaveLength(0);
});
it('rechecks current preferences and rejects readings for edited thresholds and timestamps', () => {
  const s = seed();
  const changed = advanceUtilizationAlerts(history(true, 85, time(1)), s.state, s.notifications, [observe(92, 1)], time(1));
  expect(changed.added).toBe(0); expect(changed.state.watches[0].status).toBe('pending');
  const fresh = advanceUtilizationAlerts(history(true, 85, time(1)), changed.state, changed.notifications, [observe(92, 2, 'ok', { ...watch, thresholdPercent: 85, ruleUpdatedAt: time(1) })], time(2)); expect(fresh.added).toBe(1);
  expect(() => parseUtilizationState({ ...fresh.state, watches: [{ ...fresh.state.watches[0], watch: { ...watch, thresholdPercent: 101 } }] })).toThrow();
  const corrupt = structuredClone(fresh.notifications); corrupt.notifications[0].utilizationPercent = NaN; expect(() => parseUtilizationNotifications(corrupt)).toThrow();
});
it('keeps independent wallets and token markets separate, including zero thresholds and utilization over 100%', () => {
  const h = history(true, 0); h.wallets.push({ ...structuredClone(h.wallets[0]), address: '0x4444444444444444444444444444444444444444' });
  const observations = h.wallets.map(w => observe(101, 0, 'ok', { ...watch, address: w.address, thresholdPercent: 0 }));
  const s = advanceUtilizationAlerts(h, emptyUtilizationState(), emptyUtilizationNotifications(), observations, time(0));
  expect(s.added).toBe(2); expect(new Set(s.notifications.notifications.map(n=>n.id)).size).toBe(2);
});
