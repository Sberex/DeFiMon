import { expect, it } from 'vitest';
import { defaultAlertRules } from '../src/alert-rules';
import type { SavedWallet } from '../src/wallet-history';
import { liquidityMonitorStatus } from '../src/liquidity-monitor-status';
const now = Date.parse('2026-11-22T18:30:00.000Z'), recent = '2026-11-22T18:25:00.000Z';
const rule = { network: 'ethereum' as const, protocol: 'morpho', positionId: 'one', updatedAt: recent, rules: { ...defaultAlertRules(), newLiquidityAdded: true } };
const wallet: SavedWallet = { address: '0x1111111111111111111111111111111111111111', lastCheckedAt: recent, manualLiquidationPrices: [], alerts: [rule] };
const state = () => ({ version: 1, lastRunAt: recent, lastScheduledRunAt: recent, lastRunEvent: 'schedule', watches: [{ watch: { address: wallet.address, network: rule.network, protocol: rule.protocol, positionId: rule.positionId, ruleUpdatedAt: rule.updatedAt }, checkedAt: recent, status: 'ok' }] });
it('never treats an active workflow or fresh manual run as proof that scheduling works', () => {
  expect(liquidityMonitorStatus(null, wallet, now).warning).toBe(true);
  expect(liquidityMonitorStatus({ ...state(), lastScheduledRunAt: null, lastRunEvent: 'workflow_dispatch' }, wallet, now)).toMatchObject({ warning: true, text: expect.stringContaining('no scheduled run') });
  expect(liquidityMonitorStatus(state(), wallet, now).warning).toBe(false);
});
it('warns on overdue scheduled runs even when a newer manual check succeeded', () => {
  expect(liquidityMonitorStatus({ ...state(), lastScheduledRunAt: '2026-11-22T18:00:00.000Z', lastRunEvent: 'workflow_dispatch' }, wallet, now)).toMatchObject({ warning: true, text: expect.stringContaining('overdue') });
});
it('requires recent successful readings for every currently enabled preference', () => {
  for (const status of ['error', 'unsupported', 'inactive', 'pending']) {
    const s = state(); s.watches[0].status = status;
    expect(liquidityMonitorStatus(s, wallet, now).warning).toBe(true);
  }
  const changed = state(); changed.watches[0].watch.ruleUpdatedAt = '2026-11-22T18:20:00.000Z';
  expect(liquidityMonitorStatus(changed, wallet, now)).toMatchObject({ warning: true, text: expect.stringContaining('current preferences') });
  const stale = state(); stale.watches[0].checkedAt = '2026-11-22T18:00:00.000Z';
  expect(liquidityMonitorStatus(stale, wallet, now).warning).toBe(true);
  expect(liquidityMonitorStatus(state(), { ...wallet, alerts: [] }, now)).toMatchObject({ warning: false, text: expect.stringContaining('No liquidity alerts') });
});

it('checks utilization preferences independently of the liquidity checkbox', () => {
  const utilizationWallet = { ...wallet, alerts: [{ ...rule, rules: { ...defaultAlertRules(), utilizationAbove: { enabled: true, thresholdPercent: 90 } } }] };
  expect(liquidityMonitorStatus(state(), utilizationWallet, now, 'utilization')).toMatchObject({ warning: false, text: expect.stringContaining('Recent scheduled utilization checks') });
  expect(liquidityMonitorStatus(state(), utilizationWallet, now).text).toContain('No liquidity alerts');
  expect(liquidityMonitorStatus({ ...state(), lastScheduledRunAt: null }, utilizationWallet, now, 'utilization').warning).toBe(true);
});
it('recognizes recent external triggers for both metrics without mistaking them for native cron', () => {
  const external = { ...state(), lastScheduledRunAt: null, lastExternalRunAt: recent, lastRunEvent: 'external_scheduler' };
  expect(liquidityMonitorStatus(external, wallet, now)).toMatchObject({ warning: false, text: expect.stringContaining('externally triggered liquidity'), lastScheduledRunAt: null, lastExternalRunAt: recent });
  const utilizationWallet = { ...wallet, alerts: [{ ...rule, rules: { ...defaultAlertRules(), utilizationAbove: { enabled: true, thresholdPercent: 90 } } }] };
  expect(liquidityMonitorStatus(external, utilizationWallet, now, 'utilization')).toMatchObject({ warning: false, text: expect.stringContaining('externally triggered utilization') });
  expect(liquidityMonitorStatus({ ...external, lastExternalRunAt: '2026-11-22T18:00:00.000Z', lastRunEvent: 'workflow_dispatch' }, wallet, now)).toMatchObject({ warning: true, text: expect.stringContaining('overdue') });
  expect(liquidityMonitorStatus({ ...external, lastExternalRunAt: 'invalid' }, wallet, now).warning).toBe(true);
  expect(liquidityMonitorStatus({ ...external, watches: [] }, wallet, now).warning).toBe(true);
  const failed = structuredClone(external); failed.watches[0].status = 'error'; expect(liquidityMonitorStatus(failed, wallet, now).warning).toBe(true);
});

it('shows monitoring status when only liquidity withdrawal is enabled', () => {
  const withdrawal = structuredClone(wallet);
  withdrawal.alerts![0].rules.newLiquidityAdded = false;
  withdrawal.alerts![0].rules.liquidityWithdrawn = true;
  expect(liquidityMonitorStatus(state(), withdrawal, now)).toMatchObject({ warning: false });
  expect(liquidityMonitorStatus(null, withdrawal, now)).toMatchObject({ warning: true });
});
