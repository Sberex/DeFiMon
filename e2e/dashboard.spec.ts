import { test, expect } from '@playwright/test';
import { example } from '../src/example';
test('shows clearly labeled example positions and partial protocol coverage', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Know where/ })).toBeVisible();
  await page.getByRole('button', { name: /Explore an example/ }).click();
  await expect(page.getByText(/Example only — all balances/)).toBeVisible();
  await expect(page.getByText('$31,500.00', { exact: true })).toBeVisible();
  await expect(page.getByText('Not connected', { exact: true })).toHaveCount(0);
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
  await expect(page.getByText('$31,500.00', { exact: true })).toHaveCount(0);
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
  await expect(page.getByText(/Coverage: 5 of 5/)).toBeVisible();
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
  await expect(page.getByText('$29,000.00', { exact: true })).toBeVisible(); // Entire unpriced position excluded, including its debt.
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

test('shows Aave v4 markets separately and does not offset an unhealthy market with another market', async ({ page }) => {
  const fixture = structuredClone(example);
  const v4 = fixture.protocols.find(p => p.id === 'aave-v4')!;
  const main = v4.positions[0];
  main.debtUsd = 8000;
  main.assets[1].borrowed = 8000;
  main.healthFactor = .9;
  main.risk = 'liquidatable';
  main.assets[0].liquidationPriceUsd = 8000 / (3 * .8);
  const other = structuredClone(main);
  other.id = 'example-v4-bluechip'; other.label = 'Aave v4 · BLUECHIP';
  other.suppliedUsd = 100000; other.debtUsd = 100; other.healthFactor = 800; other.risk = 'lower';
  v4.positions.push(other);
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: { ...fixture, blockNumber: '123', updatedAt: new Date().toISOString() } }));
  await page.goto('/');
  await page.getByLabel('Ethereum wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.aave-v4');
  await expect(card.getByRole('heading', { name: 'Aave v4 · MAIN', exact: true })).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Aave v4 · BLUECHIP', exact: true })).toBeVisible();
  await expect(card.getByText('Liquidation threshold reached', { exact: true })).toBeVisible();
  await expect(page.locator('.summary').filter({ hasText: 'Lowest health factor' }).locator('strong')).toContainText('0.90');
});

test('distinguishes an unavailable Aave v4 market from an empty market', async ({ page }) => {
  const fixture = structuredClone(example);
  const v4 = fixture.protocols.find(p => p.id === 'aave-v4')!;
  v4.status = 'partial';
  v4.message = 'Some Aave v4 lending markets could not be checked.';
  v4.positions = [{ id: 'unknown-v4', label: 'BLUECHIP market · unavailable', suppliedUsd: null, debtUsd: null, healthFactor: null, risk: 'unknown', assets: [], notes: ['Balances and risk are unknown.'] }];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: { ...fixture, blockNumber: '123', updatedAt: new Date().toISOString() } }));
  await page.goto('/');
  await page.getByLabel('Ethereum wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.aave-v4');
  await expect(card.getByText('Partially checked', { exact: true })).toBeVisible();
  await expect(card.getByText('Risk unavailable', { exact: true })).toBeVisible();
  await expect(card.getByText('No positions found', { exact: false })).toHaveCount(0);
  await expect(card.getByText('$0.00', { exact: true })).toHaveCount(0);
});

test('shows Morpho borrowing and vault deposits separately with an oracle liquidation boundary', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore an example/ }).click();
  const card = page.locator('article.morpho');
  await expect(card.getByText('Checked', { exact: true })).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Morpho · WETH / USDC', exact: true })).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Morpho vault V1 · Example USDC vault', exact: true })).toBeVisible();
  await expect(card.getByText(/Threshold: 1,453.49 USDC per WETH/)).toBeVisible();
  await expect(card.getByText('No borrowing', { exact: true })).toBeVisible();
  await expect(card.getByText('$6,500.00', { exact: true })).toBeVisible();
  await expect(card.getByText('$2,500.00', { exact: true })).toBeVisible();
});

test('explains unavailable Morpho discovery and keeps other protocols visible without fake zero balances', async ({ page }) => {
  const fixture = structuredClone(example);
  const morpho = fixture.protocols.find(p => p.id === 'morpho')!;
  morpho.status = 'error'; morpho.positions = [];
  morpho.message = 'Morpho lookup is unavailable. Check access to api.morpho.org and your Ethereum provider. Its balances are unknown.';
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: { ...fixture, blockNumber: '123', updatedAt: new Date().toISOString() } }));
  await page.goto('/');
  await page.getByLabel('Ethereum wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.morpho');
  await expect(card.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(card.getByText(/api.morpho.org/)).toBeVisible();
  await expect(card.getByText(/No positions found/)).toHaveCount(0);
  await expect(card.getByText('$0.00', { exact: true })).toHaveCount(0);
  await expect(page.locator('article.fluid').getByText('Checked', { exact: true })).toBeVisible();
  await expect(page.getByText('$26,500.00', { exact: true })).toBeVisible();
});

test('selects Plasma, checks its two protocols, and refreshes on the same network', async ({ page }) => {
  let reads = 0;
  const fixture = { ...structuredClone(example), chain: 'Plasma', protocols: structuredClone(example.protocols.filter(p => p.id === 'aave-v3' || p.id === 'fluid')).map(p => ({ ...p, coverage: p.coverage.replaceAll('Ethereum', 'Plasma'), positions: p.positions.map(position => ({ ...position, label: position.label.replaceAll('Ethereum', 'Plasma') })) })) };
  await page.route('**/api/portfolio/*', route => {
    expect(new URL(route.request().url()).searchParams.get('chain')).toBe('plasma'); reads++;
    return route.fulfill({ json: { ...fixture, blockNumber: String(900 + reads), updatedAt: new Date().toISOString() } });
  });
  await page.goto('/');
  await page.getByLabel('Blockchain').selectOption('plasma');
  await expect(page.getByText('Aave v4', { exact: true })).toHaveCount(0);
  await page.getByLabel('Plasma wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.getByText(/Coverage: 2 of 2 protocol readers completed on Plasma/)).toBeVisible();
  await expect(page.locator('article.protocol')).toHaveCount(2);
  await expect(page.getByText(/Plasma · Checked.*Block 901/)).toBeVisible();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText(/Block 902/)).toBeVisible();
  expect(reads).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/defimon-plasma-mobile.png', fullPage: true });
  await page.getByLabel('Blockchain').selectOption('ethereum');
  await expect(page.getByRole('region', { name: 'Wallet results' })).toHaveCount(0);
  await expect(page.getByLabel('Ethereum wallet address')).toBeVisible();
});

test('switching networks cancels an older lookup and an example resets to its labeled Ethereum network', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/portfolio/*', async route => {
    await gate;
    await route.fulfill({ json: { ...example, blockNumber: '111', updatedAt: new Date().toISOString() } });
  });
  await page.goto('/');
  await page.getByLabel('Ethereum wallet address').fill(example.address);
  const started = page.waitForRequest('**/api/portfolio/*');
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await started;
  await page.getByLabel('Blockchain').selectOption('plasma');
  release();
  await expect(page.getByRole('button', { name: 'Check wallet' })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Wallet results' })).toHaveCount(0);
  await expect(page.getByLabel('Plasma wallet address')).toBeVisible();
  await page.getByRole('button', { name: /Explore an example/ }).click();
  await expect(page.getByLabel('Blockchain')).toHaveValue('ethereum');
  await expect(page.getByText(/Example only — all balances/)).toBeVisible();
});

test('shows supplied and net USD estimates for Plasma sUSDai collateral with the source labeled', async ({ page }) => {
  const fixture = structuredClone(example);
  fixture.chain = 'Plasma';
  fixture.protocols = fixture.protocols.filter(p => p.id === 'aave-v3' || p.id === 'fluid');
  const fluid = fixture.protocols.find(p => p.id === 'fluid')!;
  fluid.status = 'partial';
  fluid.coverage = fluid.coverage.replace('Ethereum', 'Plasma');
  fluid.message = 'Some collateral dollar values are estimated from Fluid’s liquidation oracle and a debt-token USD price. Supplied and net values include these estimates.';
  const p = fluid.positions[0];
  p.label = 'Vault 36 · sUSDai / USDT0 · NFT 3015';
  p.assets = [
    { symbol: 'sUSDai', address: '0x0B2b2B2076d95dda7817e785989fE353fe955ef9', supplied: 108366, borrowed: 0, priceUsd: 1.1255 * 0.999, priceSource: 'fluid-oracle', collateral: true, liquidationThreshold: 0.9, liquidationPriceUsd: 107213 / 108366 / 0.9 * 0.999 },
    { symbol: 'USDT0', address: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', supplied: 0, borrowed: 107213, priceUsd: 0.999, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null },
  ];
  p.suppliedUsd = 108366 * 1.1255 * 0.999;
  p.debtUsd = 107213 * 0.999;
  p.healthFactor = 108366 * 1.1255 * 0.9 / 107213;
  p.risk = 'high';
  p.liquidationQuote = { current: 1.1255, threshold: 107213 / 108366 / 0.9, unit: 'USDT0 per sUSDai' };
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: { ...fixture, blockNumber: '123', updatedAt: new Date().toISOString() } }));
  await page.goto('/');
  await page.getByLabel('Blockchain').selectOption('plasma');
  await page.getByLabel('Plasma wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.fluid');
  await expect(card.getByText('$121,843.97', { exact: true })).toBeVisible();
  await expect(card.getByText('$14,738.18', { exact: true })).toBeVisible();
  await expect(card.getByText('Fluid oracle estimate', { exact: true })).toBeVisible();
  await expect(card.getByText('1.02', { exact: true })).toBeVisible();
  await expect(card.getByText(/Supplied and net values include these estimates/)).toBeVisible();
  await page.screenshot({ path: '/tmp/defimon-plasma-fluid-price-fix.png', fullPage: true });
});
