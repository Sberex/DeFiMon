// Verify the actual static artifact, including root/custom-domain or repository-path assets and API routing.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { combinedExample } from '../src/example.js';
const liveFixture = structuredClone(combinedExample);
let tokenIndex = 1;
for (const protocol of liveFixture.protocols) for (const position of protocol.positions) for (const asset of position.assets) asset.address = `0x${(tokenIndex++).toString(16).padStart(40, '0')}`;
const basePath = process.env.PAGES_BASE_PATH || '/DeFiMon/';
const apiOrigin = (process.env.PAGES_API_BASE_URL || '').replace(/\/$/, '');
const root = resolve('dist');
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url!, 'http://localhost').pathname;
  if (!path.startsWith(basePath)) { res.writeHead(404).end(); return; }
  const file = resolve(root, decodeURIComponent(path.slice(basePath.length)) || 'index.html');
  if (!file.startsWith(root + sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Missing test port');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) });
try {
  const page = await browser.newPage();
  const errors: string[] = [], assets: number[] = [], apiRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().includes('/assets/')) assets.push(response.status()); });
  await page.route('**/api/**', route => {
    apiRequests.push(route.request().url());
    if (route.request().url().endsWith('/safety-grades')) return route.fulfill({ json: { schemaVersion: 1, asOfSec: Math.floor(Date.now() / 1000), publicationStatus: 'current', methodologyVersion: '10.57', grades: [{ id: 'usdc-circle', grade: 'A+', score: 87, ratingStatus: 'rated' }] } });
    return route.fulfill({ json: route.request().url().includes('/portfolio/') ? liveFixture : route.request().url().endsWith('/recommendations') ? { alternatives: [], coverage: [], checkedAt: new Date().toISOString() } : { address: combinedExample.address, status: 'ok', networks: [] } });
  });
  const url = `http://127.0.0.1:${address.port}${basePath}`;
  await page.goto(url);
  await expect(page.getByRole('heading', { name: /Know where/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'DeFiMon home' })).toHaveAttribute('href', basePath);
  await page.getByRole('button', { name: /Explore an example/ }).click();
  await expect(page.getByText(/Example only — all balances/)).toBeVisible();
  await page.getByLabel('Wallet address', { exact: true }).fill(combinedExample.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  if (!apiOrigin) {
    await expect(page.getByRole('alert')).toContainText('Live wallet checks are not configured');
    expect(apiRequests).toEqual([]);
  } else {
    await expect(page.getByRole('region', { name: 'Wallet results' })).toBeVisible();
    await expect.poll(() => apiRequests.length).toBe(3);
    await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Recommendations', exact: true }).click();
    await expect.poll(() => apiRequests.length).toBe(4);
    expect(apiRequests.every(url => new URL(url).origin === new URL(apiOrigin).origin)).toBe(true);
  }
  expect(assets.length).toBeGreaterThan(0);
  expect(assets.every(status => status === 200)).toBe(true);
  expect(errors).toEqual([]);
  console.log('GitHub Pages artifact passed: configured base-path assets, home link, example, and live API configuration.');
} finally { await browser.close(); server.close(); server.closeAllConnections(); }
