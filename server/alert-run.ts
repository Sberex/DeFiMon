/** Trigger attribution is supplied by the workflow, never by a wallet preference. */
export type AlertRunEvent = 'schedule' | 'external_scheduler' | 'workflow_dispatch' | 'push' | 'local';
export interface AlertRunMetadata { lastRunEvent?: string; lastScheduledRunAt?: string | null; lastExternalRunAt?: string | null }
export const isAlertRunEvent = (value: unknown): value is AlertRunEvent => typeof value === 'string' && ['schedule', 'external_scheduler', 'workflow_dispatch', 'push', 'local'].includes(value);
export function alertRunEvent(env: Record<string, string | undefined>): AlertRunEvent {
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.TRACKER_DISPATCH_SOURCE === 'external-scheduler') return 'external_scheduler';
  return ['schedule', 'workflow_dispatch', 'push'].includes(env.GITHUB_EVENT_NAME ?? '') ? env.GITHUB_EVENT_NAME as AlertRunEvent : 'local';
}
export function alertRunMetadata(previous: AlertRunMetadata, runAt: string, event: AlertRunEvent | undefined, advances: boolean): AlertRunMetadata {
  if (!advances || !event) return { ...(previous.lastRunEvent ? { lastRunEvent: previous.lastRunEvent } : {}), ...(previous.lastScheduledRunAt !== undefined ? { lastScheduledRunAt: previous.lastScheduledRunAt } : {}), ...(previous.lastExternalRunAt !== undefined ? { lastExternalRunAt: previous.lastExternalRunAt } : {}) };
  return { lastRunEvent: event, lastScheduledRunAt: event === 'schedule' ? runAt : previous.lastScheduledRunAt ?? null, ...(event === 'external_scheduler' || previous.lastExternalRunAt !== undefined ? { lastExternalRunAt: event === 'external_scheduler' ? runAt : previous.lastExternalRunAt } : {}) };
}
