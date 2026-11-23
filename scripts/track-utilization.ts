import { alertRunEvent } from '../server/alert-run.js';
import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { makeClient } from '../server/rpc.js';
import { parseWalletHistory } from '../src/wallet-history.js';
import { createUtilizationAlertReader, type UtilizationObservation } from '../server/utilization-alert-reader.js';
import { advanceUtilizationAlerts, enabledUtilizationWatches, parseUtilizationNotifications, parseUtilizationState } from '../server/utilization-alert-tracker.js';
import { UTILIZATION_NOTIFICATIONS_PATH, UTILIZATION_STATE_PATH, publishUtilizationObservations } from '../server/utilization-alert-store.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());
const publish = process.argv.includes('--publish');
if (process.argv.slice(2).some(arg => !['--publish', '--dry-run'].includes(arg)) || publish && process.argv.includes('--dry-run')) throw Error('Usage: npm run track:utilization -- --dry-run|--publish');
try {
  const history = parseWalletHistory(JSON.parse(await readFile('analysis/wallet-history.json', 'utf8'))), watches = enabledUtilizationWatches(history);
  const state = parseUtilizationState(JSON.parse(await readFile(UTILIZATION_STATE_PATH, 'utf8'))), notifications = parseUtilizationNotifications(JSON.parse(await readFile(UTILIZATION_NOTIFICATIONS_PATH, 'utf8')));
  const signal = AbortSignal.timeout(180000);
  const read = createUtilizationAlertReader(n => makeClient(n, process.env[`${n.toUpperCase()}_RPC_URL`] || (n === 'ethereum' ? 'https://eth.drpc.org' : undefined), signal));
  const observations: UtilizationObservation[] = []; let index = 0;
  await Promise.all(Array.from({ length: Math.min(watches.length, 4) }, async () => {
    while (index < watches.length) {
      const watch = watches[index++];
      observations.push(signal.aborted ? { watch, checkedAt: new Date().toISOString(), blockNumber: '0', status: 'error', readings: [], message: 'The monitoring run reached its time limit. The last successful reading is retained.' } : await read(watch));
    }
  }));
  const runAt = new Date().toISOString();
  const runEvent = alertRunEvent(process.env);
  const next = advanceUtilizationAlerts(history, state, notifications, observations, runAt, runEvent);
  const summary = publish ? await publishUtilizationObservations(observations, runAt, { token: process.env.GITHUB_TOKEN ?? '', repository: process.env.GITHUB_REPOSITORY ?? 'Sberex/DeFiMon', branch: process.env.UTILIZATION_TRACKER_BRANCH ?? 'main', eventName: runEvent }) : { committed: false, added: next.added, watches: watches.length };
  const errors = observations.filter(o => ['error', 'unsupported'].includes(o.status));
  console.log(JSON.stringify({ mode: publish ? 'publish' : 'dry-run', checkedAt: runAt, ...summary, successful: observations.filter(o => o.status === 'ok').length, inactive: observations.filter(o => o.status === 'inactive').length, errors: errors.map(o => ({ address: o.watch.address, network: o.watch.network, protocol: o.watch.protocol, positionId: o.watch.positionId, status: o.status, message: o.message })), observations: observations.filter(o => o.status === 'ok').map(o => ({ address: o.watch.address, network: o.watch.network, protocol: o.watch.protocol, positionId: o.watch.positionId, blockNumber: o.blockNumber, readings: o.readings })) }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `### Utilization alerts\n\nChecked ${watches.length} enabled positions: ${observations.filter(o => o.status === 'ok').length} successful, ${errors.length} unavailable, ${summary.added} new increase notifications.\n\nNotifications: [${UTILIZATION_NOTIFICATIONS_PATH}](https://github.com/${process.env.GITHUB_REPOSITORY ?? 'Sberex/DeFiMon'}/blob/main/${UTILIZATION_NOTIFICATIONS_PATH})\n`, { flag: 'a' });
  // Persist failures first, then make the run visibly fail so missed monitoring
  // is not mistaken for a successful zero-utilization check.
  if (errors.length) process.exitCode = 1;
} catch (error) { const status = error instanceof Error ? error.message.match(/(?:GitHub tracker operation failed|Tracker source could not be read|Tracker commit could not be published) \(\d+\)/)?.[0] : undefined; console.error(`Utilization tracking failed.${status ? ` ${status}` : ''} Existing baselines and notifications were not replaced with guessed values. Check repository permissions and RPC connectivity; credentials are never printed.`); process.exitCode = 1; }
