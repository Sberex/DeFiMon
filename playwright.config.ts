import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
export default defineConfig({
  testDir: './e2e', fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:3001', launchOptions: { executablePath }, screenshot: 'only-on-failure' },
  webServer: { command: 'npm start', url: 'http://127.0.0.1:3001/api/health', reuseExistingServer: !process.env.CI, timeout: 30000 },
});
