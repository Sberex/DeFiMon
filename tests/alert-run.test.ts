import { expect, it } from 'vitest';
import { alertRunEvent, alertRunMetadata } from '../server/alert-run';
const time = '2026-11-23T12:00:00.000Z', later = '2026-11-23T12:05:00.000Z';
it('attributes external dispatch only when the workflow dispatch explicitly declares its source', () => {
  expect(alertRunEvent({ GITHUB_EVENT_NAME: 'workflow_dispatch', TRACKER_DISPATCH_SOURCE: 'external-scheduler' })).toBe('external_scheduler');
  for (const source of [undefined, 'manual', 'external_scheduler', 'untrusted-value']) expect(alertRunEvent({ GITHUB_EVENT_NAME: 'workflow_dispatch', TRACKER_DISPATCH_SOURCE: source })).toBe('workflow_dispatch');
  expect(alertRunEvent({ GITHUB_EVENT_NAME: 'schedule', TRACKER_DISPATCH_SOURCE: 'external-scheduler' })).toBe('schedule');
  expect(alertRunEvent({ GITHUB_EVENT_NAME: 'push', TRACKER_DISPATCH_SOURCE: 'external-scheduler' })).toBe('push');
  expect(alertRunEvent({ TRACKER_DISPATCH_SOURCE: 'external-scheduler' })).toBe('local');
});
it('keeps external and GitHub cron heartbeats separate and never refreshes either from manual runs', () => {
  let state = alertRunMetadata({}, time, 'external_scheduler', true);
  expect(state).toEqual({ lastRunEvent: 'external_scheduler', lastScheduledRunAt: null, lastExternalRunAt: time });
  state = alertRunMetadata(state, later, 'workflow_dispatch', true);
  expect(state).toEqual({ lastRunEvent: 'workflow_dispatch', lastScheduledRunAt: null, lastExternalRunAt: time });
  state = alertRunMetadata(state, later, 'schedule', true);
  expect(state).toEqual({ lastRunEvent: 'schedule', lastScheduledRunAt: later, lastExternalRunAt: time });
  expect(alertRunMetadata(state, time, 'external_scheduler', false)).toEqual(state);
  expect(alertRunMetadata({}, time, undefined, true)).toEqual({});
});
