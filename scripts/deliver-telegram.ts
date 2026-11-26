import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { parseWalletHistory } from '../src/wallet-history.js';
import { parseLiquidityNotifications } from '../server/liquidity-alert-tracker.js';
import { parseUtilizationNotifications } from '../server/utilization-alert-tracker.js';
import { deliverTelegramAlerts, parseTelegramState, sendTelegramMessage, type TelegramStore } from '../server/telegram-alerts.js';
import { createTelegramStore, TELEGRAM_DELIVERIES_PATH } from '../server/telegram-alert-store.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());
const publish = process.argv.includes('--publish');
if (process.argv.slice(2).some(arg => !['--publish','--dry-run'].includes(arg)) || publish && process.argv.includes('--dry-run')) throw Error('Usage: npm run deliver:telegram -- --dry-run|--publish');
try {
  if (!publish) {
    const state = parseTelegramState(JSON.parse(await readFile(TELEGRAM_DELIVERIES_PATH, 'utf8')));
    const history = parseWalletHistory(JSON.parse(await readFile('analysis/wallet-history.json', 'utf8')));
    const notifications = [...parseLiquidityNotifications(JSON.parse(await readFile('analysis/liquidity-alert-notifications.json','utf8'))).notifications, ...parseUtilizationNotifications(JSON.parse(await readFile('analysis/utilization-alert-notifications.json','utf8'))).notifications];
    console.log(JSON.stringify({ mode: 'dry-run', deliveryEnabledAt: state.enabledAt, notificationsSinceEnabled: notifications.filter(n => n.timestamp >= state.enabledAt).length, receipts: state.deliveries.length, wallets: history.wallets.length, sent: 0 }));
  } else {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? '', chatId = process.env.TELEGRAM_CHAT_ID?.trim() ?? '';
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token) || !/^(?:-?\d+|@[A-Za-z0-9_]{5,})$/.test(chatId)) throw Error('Telegram credentials missing or invalid.');
    const store: TelegramStore = createTelegramStore({ token: process.env.GITHUB_TOKEN ?? '', repository: process.env.GITHUB_REPOSITORY ?? 'Sberex/DeFiMon', branch: process.env.TELEGRAM_TRACKER_BRANCH ?? 'main' });
    const test = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && process.env.TELEGRAM_SEND_TEST === 'true';
    if (test && !process.env.GITHUB_RUN_ID) throw Error('Telegram test requires an Actions run identifier.');
    const testId = test ? createHash('sha256').update(`telegram-test:${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`).digest('hex') : undefined;
    const result = await deliverTelegramAlerts({ store, owner: randomUUID(), testId, send: text => sendTelegramMessage(token, chatId, text) });
    console.log(JSON.stringify({ mode: 'publish', ...result, testRequested: test }));
    if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `### Telegram delivery\n\nSent ${result.sent}; failed ${result.failed}; skipped ${result.skipped}. ${test ? 'An explicit connection test was requested.' : ''}\n\nDelivery receipts: [${TELEGRAM_DELIVERIES_PATH}](https://github.com/${process.env.GITHUB_REPOSITORY ?? 'Sberex/DeFiMon'}/blob/main/${TELEGRAM_DELIVERIES_PATH})\n`, { flag: 'a' });
    if (result.failed) process.exitCode = 1;
  }
} catch {
  // Never print transport exceptions, request URLs, Telegram bodies, tokens or chat IDs.
  console.error('Telegram delivery could not be completed. Check TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, bot Start/access, and the GitHub delivery receipts. If a message was accepted but checkpointing failed, it may be retried after the delivery lease expires. Credentials are never printed.');
  process.exitCode = 1;
}
