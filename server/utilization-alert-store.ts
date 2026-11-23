import type { UtilizationObservation } from './utilization-alert-reader.js';
import { publishTrackerFiles, type TrackerPublishOptions } from './liquidity-alert-store.js';
import { advanceUtilizationAlerts, parseUtilizationState, parseUtilizationNotifications } from './utilization-alert-tracker.js';
export const UTILIZATION_STATE_PATH = 'analysis/utilization-alert-state.json';
export const UTILIZATION_NOTIFICATIONS_PATH = 'analysis/utilization-alert-notifications.json';
export function publishUtilizationObservations(observations: UtilizationObservation[], runAt: string, options: TrackerPublishOptions) {
  return publishTrackerFiles(runAt, options, { statePath: UTILIZATION_STATE_PATH, notificationsPath: UTILIZATION_NOTIFICATIONS_PATH, label: 'market utilization', transition: (history, state, notifications) => advanceUtilizationAlerts(history, parseUtilizationState(state), parseUtilizationNotifications(notifications), observations, runAt, options.eventName) });
}
