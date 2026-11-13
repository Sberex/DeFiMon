import { test, expect } from '@playwright/test';
import { example } from '../src/example';
test('shows clearly labeled example positions and partial protocol coverage', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Know where/ })).toBeVisible();
  await page.getByRole('button', { name: /Explore an example/ }).click();
  await expect(page.getByText(/Example only — all balances/)).toBeVisible();
  await expect(page.getByText('$21,500.00', { exact: true })).toBeVisible();
  await expect(page.getByText('Not connected', { exact: true })).toHaveCount(2);
  await expect(page.getByText('$2,117.65', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/defimon-desktop.png', fullPage: true });
});
test('rejects invalid input and displays provider failures without example balances', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Ethereum wallet address').fill('not-an-address');
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.getByRole('alert')).toContainText('valid Ethereum address');
  await page.route('**/api/portfolio/*', route => route.fulfill({ status: 503, json: { error: 'Ethereum data is unavailable.' } }));
  await page.getByLabel('Ethereum wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.getByRole('alert')).toContainText('Ethereum data is unavailable');
  await expect(page.getByText('$21,500.00', { exact: true })).toHaveCount(0);
});
test('searches and refreshes the displayed wallet rather than an edited address', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/portfolio/*', route => {
    expect(route.request().url()).toContain(example.address);
    reads++;
    return route.fulfill({ json: { ...example, blockNumber: String(100 + reads), updatedAt: new Date().toISOString() } });
  });
  await page.goto('/');
  await page.getByLabel('Ethereum wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.getByText(/Block 101/)).toBeVisible();
  await expect(page.getByText(/Partial coverage: 3 of 5/)).toBeVisible();
  await page.getByLabel('Ethereum wallet address').fill('0x2222222222222222222222222222222222222222');
  await page.getByRole('button', { name: /Refresh/ }).click();
  await expect(page.getByText(/Block 102/)).toBeVisible();
  expect(reads).toBe(2);
});
test('works on mobile without page-level horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /Explore an example/ }).click();
  await expect(page.getByRole('heading', { name: 'Protocol breakdown' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/defimon-mobile.png', fullPage: true });
});

test('shows Fluid liquidation ratios and excludes unpriced positions from dollar totals', async ({ page }) => {
  const fixture = structuredClone(example);
  const fluid = fixture.protocols.find(p => p.id === 'fluid')!;
  fluid.status = 'partial';
  fluid.message = 'Some positions have no verified USD price. Dollar totals are incomplete.';
  fluid.positions[0].suppliedUsd = null;
  fluid.positions[0].assets[0].priceUsd = null;
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: { ...fixture, blockNumber: '123', updatedAt: new Date().toISOString() } }));
  await page.goto('/');
  await page.getByLabel('Ethereum wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.fluid');
  await expect(card.getByText('Partially checked', { exact: true })).toBeVisible();
  await expect(card.getByText(/Current: 3,000 USDC per ETH/)).toBeVisible();
  await expect(card.getByText(/Threshold: 1,902.17 USDC per ETH/)).toBeVisible();
  await expect(page.getByText(/Dollar totals exclude 1 positions/)).toBeVisible();
  await expect(page.getByText('$19,000.00', { exact: true })).toBeVisible(); // Entire unpriced position excluded, including its debt.
  await expect(card.getByText('$0.00', { exact: true })).toHaveCount(0);
});

test('shows Fluid oracle ratios for smart collateral without inventing a dollar liquidation price', async ({ page }) => {
  const fixture = structuredClone(example);
  const p = fixture.protocols.find(p => p.id === 'fluid')!.positions[0];
  p.liquidationQuote = { current: .6, threshold: .3125, unit: 'debt pool share per collateral pool share' };
  p.assets.forEach(a => { a.liquidationPriceUsd = null; });
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: { ...fixture, blockNumber: '123', updatedAt: new Date().toISOString() } }));
  await page.goto('/');
  await page.getByLabel('Ethereum wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.fluid');
  await expect(card.getByText('Checked', { exact: true })).toBeVisible();
  await expect(card.getByText(/Threshold: 0.3125 debt pool share per collateral pool share/)).toBeVisible();
  await expect(card.getByText('$1,902.17', { exact: true })).toHaveCount(0);
});
