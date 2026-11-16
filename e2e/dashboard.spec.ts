import { test, expect } from '@playwright/test';
import { combinedExample, example } from '../src/example';
import { portfolio as aprPortfolio, rewards as aprRewards } from '../tests/fixtures/merkl-apr';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/rewards/*', route => route.fulfill({ json: { address: new URL(route.request().url()).pathname.split('/').at(-1), updatedAt: new Date().toISOString(), status: 'ok', networks: [] } }));
});
test('shows clearly labeled example positions and partial protocol coverage', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Know where/ })).toBeVisible();
  await page.getByRole('button', { name: /Explore an example/ }).click();
  await expect(page.getByText(/Example only — all balances/)).toBeVisible();
  await expect(page.getByText('$47,000.00', { exact: true })).toBeVisible();
  await expect(page.getByText('Not connected', { exact: true })).toHaveCount(0);
  await expect(page.getByText('$2,117.65', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/defimon-desktop.png', fullPage: true });
});
test('rejects invalid input and displays provider failures without example balances', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Wallet address').fill('not-an-address');
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.getByRole('alert')).toContainText('valid wallet address');
  await page.route('**/api/portfolio/*', route => route.fulfill({ status: 503, json: { error: 'Ethereum data is unavailable.' } }));
  await page.getByLabel('Wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.getByRole('alert')).toContainText('Ethereum data is unavailable');
  await expect(page.getByText('$47,000.00', { exact: true })).toHaveCount(0);
});
test('searches and refreshes the displayed wallet rather than an edited address', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/portfolio/*', route => {
    expect(route.request().url()).toContain(example.address);
    reads++;
    return route.fulfill({ json: { ...example, blockNumber: String(100 + reads), updatedAt: new Date().toISOString() } });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.getByText(/Block 101/)).toBeVisible();
  await expect(page.getByText(/Coverage: 6 of 6/)).toBeVisible();
  await page.getByLabel('Wallet address').fill('0x2222222222222222222222222222222222222222');
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
  await page.getByLabel('Wallet address').fill(example.address);
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
  await page.getByLabel('Wallet address').fill(example.address);
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
  await page.getByLabel('Wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.aave-v4');
  await expect(card.getByRole('heading', { name: 'Aave v4 · MAIN', exact: true })).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Aave v4 · BLUECHIP', exact: true })).toBeVisible();
  await expect(card.getByText('Liquidation threshold reached', { exact: true })).toBeVisible();
  await expect(card.locator('.position-stats').first().getByText('0.90', { exact: true })).toBeVisible();
  await expect(page.getByText('Lowest health factor', { exact: true })).toHaveCount(0);
});

test('distinguishes an unavailable Aave v4 market from an empty market', async ({ page }) => {
  const fixture = structuredClone(example);
  const v4 = fixture.protocols.find(p => p.id === 'aave-v4')!;
  v4.status = 'partial';
  v4.message = 'Some Aave v4 lending markets could not be checked.';
  v4.positions = [{ id: 'unknown-v4', label: 'BLUECHIP market · unavailable', suppliedUsd: null, debtUsd: null, healthFactor: null, risk: 'unknown', assets: [], notes: ['Balances and risk are unknown.'] }];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: { ...fixture, blockNumber: '123', updatedAt: new Date().toISOString() } }));
  await page.goto('/');
  await page.getByLabel('Wallet address').fill(example.address);
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
  const card = page.locator('article.morpho[data-chain="Ethereum"]');
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
  await page.getByLabel('Wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.morpho[data-chain="Ethereum"]');
  await expect(card.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(card.getByText(/api.morpho.org/)).toBeVisible();
  await expect(card.getByText(/No positions found/)).toHaveCount(0);
  await expect(card.getByText('$0.00', { exact: true })).toHaveCount(0);
  await expect(page.locator('article.fluid').getByText('Checked', { exact: true })).toBeVisible();
  await expect(page.getByText('$26,500.00', { exact: true })).toBeVisible();
});

test('shows all four networks grouped by protocol, refreshes all, and fits on mobile', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/portfolio/*', route => {
    expect(new URL(route.request().url()).searchParams.get('chain')).toBe('all'); reads++;
    return route.fulfill({ json: { ...combinedExample, updatedAt: new Date().toISOString(), networks: [
      { chain: 'Ethereum', status: 'ok', blockNumber: String(900 + reads), updatedAt: new Date().toISOString() },
      { chain: 'Plasma', status: 'ok', blockNumber: String(1900 + reads), updatedAt: new Date().toISOString() },
      { chain: 'Arbitrum', status: 'ok', blockNumber: String(2900 + reads), updatedAt: new Date().toISOString() },
    ] } });
  });
  await page.goto('/');
  await expect(page.getByLabel('Blockchain')).toHaveCount(0);
  await page.getByLabel('Wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.getByText(/Coverage: 19 of 19 protocol readers completed on Ethereum \+ Plasma \+ Arbitrum/)).toBeVisible();
  await expect(page.locator('article.protocol')).toHaveCount(19);
  await expect(page.locator('article.protocol .protocol-name h2')).toHaveText(['Aave v3 · Ethereum', 'Aave v3 · Plasma', 'Aave v3 · Arbitrum', 'Aave v3 · Base', 'Aave v4 · Ethereum', 'Morpho · Ethereum', 'Morpho · Arbitrum', 'Morpho · Base', 'Compound · Ethereum', 'Compound · Arbitrum', 'Compound · Base', 'Fluid · Ethereum', 'Fluid · Plasma', 'Fluid · Arbitrum', 'Fluid · Base', 'Euler · Ethereum', 'Euler · Plasma', 'Euler · Arbitrum', 'Euler · Base']);
  await expect(page.getByText(/Ethereum · Block 901/)).toBeVisible();
  await expect(page.getByText(/Plasma · Block 1901/)).toBeVisible();
  await expect(page.getByText(/Arbitrum · Block 2901/)).toBeVisible();
  await expect(page.getByText('$47,000.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText(/Ethereum · Block 902/)).toBeVisible();
  await expect(page.getByText(/Plasma · Block 1902/)).toBeVisible();
  await expect(page.getByText(/Arbitrum · Block 2902/)).toBeVisible();
  expect(reads).toBe(2);
  await page.screenshot({ path: '/tmp/defimon-combined-networks.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/defimon-combined-networks-mobile.png', fullPage: true });
});

test('an example cancels an older lookup so its late response cannot replace the example', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/portfolio/*', async route => {
    await gate;
    await route.fulfill({ json: { ...example, blockNumber: '111', updatedAt: new Date().toISOString() } });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address').fill(example.address);
  const started = page.waitForRequest('**/api/portfolio/*');
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await started;
  await page.getByRole('button', { name: /Explore an example/ }).click();
  release();
  await expect(page.getByRole('button', { name: 'Check wallet' })).toBeEnabled();
  await expect(page.getByText(/Example only — all balances/)).toBeVisible();
  await expect(page.locator('article.protocol')).toHaveCount(19);
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
  await page.getByLabel('Wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.fluid');
  await expect(card.getByText('$121,843.97', { exact: true })).toBeVisible();
  await expect(card.getByText('$14,738.18', { exact: true })).toBeVisible();
  await expect(card.getByText('Fluid oracle estimate', { exact: true })).toBeVisible();
  await expect(card.getByText('1.02', { exact: true })).toBeVisible();
  await expect(card.getByText(/Supplied and net values include these estimates/)).toBeVisible();
  await page.screenshot({ path: '/tmp/defimon-plasma-fluid-price-fix.png', fullPage: true });
});

test('keeps Ethereum results when Plasma fails and never calls unavailable Plasma balances zero', async ({ page }) => {
  const fixture = structuredClone(combinedExample);
  fixture.protocols = fixture.protocols.map(p => p.chain === 'Plasma' ? { ...p, status: 'error', positions: [], message: 'Plasma connection unavailable. Its balances and risk are unknown.' } : p);
  fixture.wallets = fixture.wallets?.map(w => w.chain === 'Plasma' ? { ...w, status: 'error', tokens: [], pricedValueUsd: null, message: 'Wallet balances unknown.' } : w);
  fixture.networks = [
    { chain: 'Ethereum', status: 'ok', blockNumber: '101', updatedAt: new Date().toISOString() },
    { chain: 'Plasma', status: 'error', blockNumber: null, updatedAt: new Date().toISOString() },
  ];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await page.getByLabel('Wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.getByText('$42,000.00', { exact: true })).toBeVisible();
  await expect(page.getByText('Plasma · Connection unavailable', { exact: true })).toBeVisible();
  const plasma = page.locator('article.fluid[data-chain="Plasma"]');
  await expect(plasma.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(plasma.getByText(/balances and risk are unknown/)).toBeVisible();
  await expect(plasma.getByText(/No positions found/)).toHaveCount(0);
  await expect(plasma.getByText('$0.00', { exact: true })).toHaveCount(0);
  await expect(page.locator('article.fluid[data-chain="Ethereum"]').getByText('Checked', { exact: true })).toBeVisible();
});

test('adds wallet tokens to net value and groups them Ethereum then Plasma', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore an example/ }).click();
  await expect(page.locator('.wallet-network .protocol-name h2')).toHaveText(['Wallet tokens · Ethereum', 'Wallet tokens · Plasma', 'Wallet tokens · Arbitrum', 'Wallet tokens · Base']);
  const ethereum = page.locator('.wallet-network[data-chain="Ethereum"]');
  const plasma = page.locator('.wallet-network[data-chain="Plasma"]');
  await expect(ethereum.getByText('ETH', { exact: true })).toBeVisible();
  await expect(ethereum.getByText('$6,000.00', { exact: true })).toBeVisible();
  await expect(plasma.getByText('XPL', { exact: true })).toBeVisible();
  await expect(page.locator('.summary.primary strong')).toHaveText('$47,000.00');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(plasma.getByText('XPL', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/defimon-wallet-tokens-mobile.png', fullPage: true });
});

test('adds and removes a token contract on its selected network and refreshes the displayed wallet', async ({ page }) => {
  const queries: string[] = [];
  await page.route('**/api/portfolio/*', route => {
    const url = new URL(route.request().url());
    expect(url.pathname).toContain(example.address);
    queries.push(url.searchParams.get('tokens') ?? '');
    return route.fulfill({ json: combinedExample });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.locator('.wallet-network')).toHaveCount(4);
  await page.getByText('Add another token', { exact: true }).click();
  await page.getByLabel('Token network').selectOption('plasma');
  await page.getByLabel('Token contract address').fill('0x2222222222222222222222222222222222222222');
  await page.getByRole('button', { name: 'Add token', exact: true }).click();
  await expect(page.locator('.wallet-network')).toHaveCount(4);
  expect(queries.at(-1)).toBe('plasma:0x2222222222222222222222222222222222222222');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('.wallet-network')).toHaveCount(4);
  expect(queries.at(-1)).toBe('');
});

test('keeps unpriced and receipt-token amounts out of wallet net value while showing their balances', async ({ page }) => {
  const fixture = structuredClone(combinedExample);
  const wallet = fixture.wallets![0]; wallet.status = 'partial'; wallet.unpricedCount = 1;
  wallet.message = 'Some wallet prices are unavailable; unpriced values are excluded.';
  wallet.tokens.push({ address: '0x3333333333333333333333333333333333333333', symbol: 'EUL', balance: 5, priceUsd: null, valueUsd: null });
  wallet.tokens.push({ address: '0x4444444444444444444444444444444444444444', symbol: 'aUSDC', balance: 10000, priceUsd: null, valueUsd: null, excludedReason: 'Lending receipt token: its underlying value belongs in the protocol section.' });
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.locator('.summary.primary strong')).toHaveText('$47,000.00');
  const section = page.locator('.wallet-network[data-chain="Ethereum"]');
  await expect(section.getByText('EUL', { exact: true })).toBeVisible();
  await expect(section.getByText(/Lending receipt token/)).toBeVisible();
  await expect(page.getByText(/Wallet totals exclude 1 unpriced/)).toBeVisible();
});

test('shows current supply and borrow APR by asset, including genuine zero collateral interest', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore an example/ }).click();
  const aave = page.locator('article.aave-v3[data-chain="Ethereum"]');
  await expect(aave.getByRole('columnheader', { name: 'Supply APR', exact: true })).toBeVisible();
  await expect(aave.getByRole('columnheader', { name: 'Borrow APR', exact: true })).toBeVisible();
  await expect(aave.getByText('3.50%', { exact: false })).toBeVisible();
  await expect(aave.getByText('5.50%', { exact: false })).toBeVisible();
  const compound = page.locator('article.compound[data-chain="Ethereum"]');
  await expect(compound.getByText('0.00%', { exact: false })).toBeVisible();
  await expect(page.getByText(/Example only — all balances/)).toBeVisible();
});

test('labels estimated and unavailable rates without hiding supplied values or risk', async ({ page }) => {
  const fixture = structuredClone(combinedExample);
  const fluid = fixture.protocols.find(p => p.id === 'fluid' && p.chain === 'Plasma')!;
  fluid.positions[0].assets[0].supplyRate = { apr: -0.01, estimated: true, note: 'Interest component only; excludes pool trading income.' };
  fluid.positions[0].assets[1].borrowRate = { apr: null, note: 'Rate lookup unavailable.' };
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.fluid[data-chain="Plasma"]');
  await expect(card.getByText('≈ -1.00%', { exact: false })).toBeVisible();
  await expect(card.locator('tbody tr').nth(1).locator('td').nth(4)).toHaveText('Unavailable');
  await expect(card.getByText('$1,500.00', { exact: true })).toBeVisible();
  await expect(card.getByText('3.20', { exact: true })).toBeVisible();
  await card.getByText('Estimate details', { exact: true }).click();
  await expect(card.getByText('Interest component only; excludes pool trading income.', { exact: true })).toBeVisible();
});

test('shows LLTV for collateral across every protocol and a dash for unpledged assets', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore an example/ }).click();
  for (const id of ['aave-v3', 'aave-v4', 'morpho', 'compound', 'fluid']) {
    const card = page.locator(`article.${id}[data-chain="Ethereum"]`);
    await expect(card.getByRole('columnheader', { name: 'LLTV', exact: true }).first()).toBeVisible();
    const collateral = card.locator('tbody tr').filter({ hasText: 'Collateral' }).first();
    await expect(collateral.locator('td').nth(6)).toHaveText(/\d+\.\d{2}%/);
    const debtOnly = card.locator('tbody tr').filter({ has: page.getByText('USDC', { exact: true }) }).first();
    await expect(debtOnly.locator('td').nth(6)).toHaveText('—');
  }
});

test('calculates only the largest collateral using manual prices and clears stale results on edit and refresh', async ({ page }) => {
  const fixture = structuredClone(example);
  const protocol = fixture.protocols.find(p => p.id === 'aave-v3')!;
  fixture.protocols = [protocol];
  const p = protocol.positions[0];
  p.debtUsd = 30000; p.suppliedUsd = 70000; p.healthFactor = 1.8;
  const eth = p.assets[0]; eth.address = 'eth'; eth.liquidationThreshold = .8;
  p.assets.push({ ...eth, address: 'btc', symbol: 'WBTC', supplied: .5, priceUsd: 50000, liquidationThreshold: .75 });
  p.assets.push({ ...eth, address: 'usdt', symbol: 'USDT', supplied: 15000, priceUsd: 1, liquidationThreshold: .9 });
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.aave-v3');
  const result = card.locator('.calculated-price strong');
  await expect(card.getByLabel('WETH liquidation price (USD)')).toHaveCount(0);
  await expect(result).toHaveText('—');
  await card.getByRole('button', { name: 'Calculate', exact: true }).click();
  await expect(card.getByRole('status')).toHaveText(/Enter a valid USD liquidation price/);
  await card.getByLabel('WBTC liquidation price (USD)').fill('30000');
  await card.getByLabel('USDT liquidation price (USD)').fill('0.8');
  await card.getByRole('button', { name: 'Calculate', exact: true }).click();
  await expect(result).toHaveText('$993.75');
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Recommendations', exact: true }).click();
  await expect(card).toBeHidden();
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Wallet Overview', exact: true }).click();
  await expect(card.getByLabel('WBTC liquidation price (USD)')).toHaveValue('30000');
  await expect(card.getByLabel('USDT liquidation price (USD)')).toHaveValue('0.8');
  await expect(result).toHaveText('$993.75');
  await expect(card.locator('.position-stats strong').nth(1)).toHaveText('$30,000.00');
  await expect(card.locator('.position-stats strong').last()).toHaveText('1.80');
  await card.getByLabel('USDT liquidation price (USD)').fill('0');
  await expect(result).toHaveText('—');
  await card.getByRole('button', { name: 'Calculate', exact: true }).click();
  await expect(result).toHaveText('$2,343.75');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/defimon-liquidation-calculator-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(result).toHaveText('—');
  await expect(card.getByLabel('WBTC liquidation price (USD)')).toHaveValue('');
});

test('shows smart-vault LLTV but keeps its oracle boundary instead of independent token prices', async ({ page }) => {
  const fixture = structuredClone(example);
  const fluid = fixture.protocols.find(p => p.id === 'fluid')!;
  fixture.protocols = [fluid];
  const p = fluid.positions[0]; p.liquidationModel = 'oracle-ratio';
  p.assets[0].address = 'eth';
  p.assets.push({ ...p.assets[0], address: 'btc', symbol: 'WBTC', supplied: .1, priceUsd: 50000 });
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.getByRole('button', { name: 'Calculate', exact: true })).toHaveCount(0);
  await expect(page.getByText(/This vault uses pool shares/)).toBeVisible();
  await expect(page.getByText('Liquidation boundary · oracle ratio', { exact: true })).toBeVisible();
  await expect(page.locator('tbody tr').first().locator('td').nth(6)).toHaveText('92.00%');
});

test('shows sUSDai past-month intrinsic APR separately and adds it to protocol interest across all families', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/portfolio/*', route => {
    reads++;
    const fixture = structuredClone(example);
    for (const protocol of fixture.protocols) {
      if (!protocol.positions.length) continue;
      const asset = protocol.positions[0].assets[0];
      asset.symbol = 'sUSDai'; asset.address = '0x0b2b2b2076d95dda7817e785989fe353fe955ef9';
      asset.supplyRate = { apr: ['compound', 'morpho'].includes(protocol.id) ? 0 : .02, note: 'Current protocol interest only.' };
      asset.intrinsicSupplyRate = { apr: reads === 1 ? .0756 : .08, estimated: true, note: 'Past-month intrinsic APR estimate. Simple annualization, not compounded APY.', source: { chain: 'Ethereum', oracle: '0x0fBE44B96320EBD455FF9CCE0781fA9A83Ddee7a', blockNumber: '26414491', startTimestamp: 1792040027, endTimestamp: 1794632711 } };
    }
    return route.fulfill({ json: fixture });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  for (const id of ['aave-v3', 'aave-v4', 'morpho', 'compound', 'fluid']) {
    const cell = page.locator(`article.${id}`).locator('tbody tr').first().locator('td').nth(2);
    await expect(cell.getByText('Intrinsic (30d): 7.56%', { exact: true })).toBeVisible();
    await expect(cell.getByText(['compound', 'morpho'].includes(id) ? '≈ 7.56%' : '≈ 9.56%', { exact: false })).toBeVisible();
    await expect(cell.getByText(['compound', 'morpho'].includes(id) ? 'Protocol: 0.00%' : 'Protocol: 2.00%', { exact: true })).toBeVisible();
  }
  const cell = page.locator('article.aave-v3').locator('tbody tr').first().locator('td').nth(2);
  await cell.getByText('Intrinsic yield details', { exact: true }).click();
  await expect(cell.getByText(/Oracle observations:/)).toBeVisible();
  await expect(cell.getByRole('link', { name: 'View oracle' })).toHaveAttribute('href', 'https://etherscan.io/address/0x0fBE44B96320EBD455FF9CCE0781fA9A83Ddee7a#readContract');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(cell.getByText('Intrinsic (30d): 8.00%', { exact: true })).toBeVisible();
  await expect(cell.getByText('≈ 10.00%', { exact: false })).toBeVisible();
});

test('keeps sUSDai lending rates and balances when intrinsic oracle data is unavailable', async ({ page }) => {
  const fixture = structuredClone(example);
  const asset = fixture.protocols[0].positions[0].assets[0];
  asset.symbol = 'sUSDai'; asset.address = '0x0b2b2b2076d95dda7817e785989fe353fe955ef9';
  asset.intrinsicSupplyRate = { apr: null, estimated: true, note: 'The past-month sUSDai intrinsic APR could not be verified.', source: { chain: 'Ethereum', oracle: '0x0fBE44B96320EBD455FF9CCE0781fA9A83Ddee7a' } };
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.aave-v3');
  const cell = card.locator('tbody tr').first().locator('td').nth(2);
  await expect(cell.getByText('Intrinsic (30d): Unavailable', { exact: true })).toBeVisible();
  await expect(cell.getByText('Protocol: 3.50%', { exact: true })).toBeVisible();
  await expect(card.locator('.position-stats strong').first()).toHaveText('$30,000.00');
  await expect(page.locator('.summary.primary strong')).toHaveText('$31,500.00');
});

test('shows monthly token interest and USD NPL after protocol net value across networks', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore an example/ }).click();
  await expect(page.getByRole('region', { name: 'Protocol monthly interest', exact: true })).toHaveCount(15);
  const card = page.locator('article.aave-v3[data-chain="Ethereum"]');
  const summary = card.getByRole('region', { name: 'Protocol monthly interest', exact: true });
  await expect(summary.locator('.protocol-interest-totals > p')).toHaveText(['Net value: $12,000.00', 'APR: ≈ 0.50%', 'Monthly NPL: ≈ $5.00 / month']);
  await expect(summary.getByText('Earned: ≈ $87.50 / month · Paid: ≈ $82.50 / month', { exact: true })).toBeVisible();
  await expect(card.getByRole('columnheader', { name: 'Monthly interest earned', exact: true })).toBeVisible();
  await expect(card.locator('tbody tr').first().locator('td').nth(8)).toHaveText('≈ 0.0291667 WETH / month≈ $87.50 / month');
  await expect(card.locator('tbody tr').nth(1).locator('td').nth(9)).toHaveText('≈ 82.5 USDC / month≈ $82.50 / month');
  await expect(page.locator('article.aave-v3[data-chain="Plasma"] .protocol-monthly-npl')).toHaveText('Monthly NPL: ≈ $7.08 / month');
  await expect(page.locator('article.aave-v3[data-chain="Arbitrum"] .protocol-monthly-npl')).toHaveText('Monthly NPL: ≈ $2.08 / month');
  await expect(page.locator('article.compound[data-chain="Ethereum"] .protocol-monthly-npl')).toHaveText('Monthly NPL: ≈ -$22.92 / month');
  // Morpho has both a direct loan and a separate vault holding; both count once.
  await expect(page.locator('article.morpho[data-chain="Ethereum"] .protocol-monthly-npl')).toHaveText('Monthly NPL: ≈ -$7.08 / month');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await card.getByRole('region', { name: 'Protocol monthly interest', exact: true }).screenshot({ path: '/tmp/defimon-monthly-interest-mobile.png' });
});

test('uses sUSDai combined supply APR for monthly NPL and preserves unknown intrinsic data after refresh', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/portfolio/*', route => {
    reads++;
    const fixture = structuredClone(example);
    const fluid = fixture.protocols.find(p => p.id === 'fluid')!; fixture.protocols = [fluid];
    const p = fluid.positions[0]; p.suppliedUsd = 1320; p.debtUsd = 1200;
    Object.assign(p.assets[0], { symbol: 'sUSDai', address: '0x0b2b2b2076d95dda7817e785989fe353fe955ef9', supplied: 1200, priceUsd: 1.1, supplyRate: { apr: .02, note: '' }, intrinsicSupplyRate: { apr: reads === 1 ? .0756 : null, estimated: true, note: '', source: { chain: 'Ethereum', oracle: '0x0fBE44B96320EBD455FF9CCE0781fA9A83Ddee7a' } } });
    Object.assign(p.assets[1], { borrowed: 1200, borrowRate: { apr: .06, note: '' } });
    return route.fulfill({ json: fixture });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const summary = page.getByRole('region', { name: 'Fluid vault monthly interest', exact: true });
  await expect(summary.locator('.protocol-monthly-npl')).toHaveText('Monthly NPL: ≈ $4.52 / month');
  await expect(summary.getByText('Earned: ≈ $10.52 / month · Paid: ≈ $6.00 / month', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(summary.locator('.protocol-monthly-npl')).toHaveText('Monthly NPL: Unavailable');
  await expect(summary.getByText('Earned: Unavailable · Paid: ≈ $6.00 / month', { exact: true })).toBeVisible();
  await expect(summary.locator('.protocol-net-value')).toHaveText('Net value: $120.00');
});

test('shows monthly token interest with unavailable USD totals when a token price is missing', async ({ page }) => {
  const fixture = structuredClone(example);
  fixture.protocols = [fixture.protocols[0]];
  const p = fixture.protocols[0].positions[0]; p.assets[0].priceUsd = null; p.suppliedUsd = null;
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.locator('.protocol-monthly-npl')).toHaveText('Monthly NPL: Unavailable');
  await expect(page.locator('tbody tr').first().locator('td').nth(8)).toHaveText('≈ 0.0291667 WETH / monthUnavailable');
  await expect(page.getByRole('region', { name: 'Protocol monthly interest', exact: true }).getByText('Earned: Unavailable · Paid: ≈ $82.50 / month', { exact: true })).toBeVisible();
});


test('puts total monthly NPL in the fourth summary card and sums all networks once', async ({ page }) => {
  await page.goto('/');
  const total = page.getByRole('region', { name: 'Total monthly NPL', exact: true });
  await expect(total).toHaveCount(0);
  await page.getByRole('button', { name: /Explore an example/ }).click();
  await expect(page.locator('.summary-grid > *')).toHaveCount(5);
  await expect(page.locator('.summary-grid > *').nth(3)).toHaveAttribute('aria-label', 'Total monthly NPL');
  await expect(page.locator('.summary-grid > *').nth(4)).toHaveAttribute('aria-label', 'Portfolio APR');
  await expect(page.getByRole('region', { name: 'Portfolio APR', exact: true }).locator('strong')).toHaveText('≈ -0.11%');
  await expect(page.getByText('Lowest health factor', { exact: true })).toHaveCount(0);
  await expect(total).toHaveCount(1);
  await expect(total.locator('strong')).toHaveText('≈ -$4.35');
  await expect(total.getByText('Earned: ≈ $160.42 / month · Paid: ≈ $164.77 / month', { exact: true })).toBeVisible();
  await expect(total.getByText(/Illustrative example/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await total.screenshot({ path: '/tmp/defimon-total-npl-mobile.png' });
});

test('shows Fluid NPL separately for each vault and lending deposit, and keeps unreadable costs out of totals', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/portfolio/*', route => {
    reads++;
    const fixture = structuredClone(example);
    const fluid = fixture.protocols.find(p => p.id === 'fluid')!; fixture.protocols = [fluid];
    const second = structuredClone(fluid.positions[0]);
    second.id = 'fluid-nft-second'; second.label = 'Vault 22'; second.suppliedUsd = 3000; second.debtUsd = 6000;
    Object.assign(second.assets[0], { supplied: 1, supplyRate: { apr: .04, note: '' } });
    Object.assign(second.assets[1], { borrowed: 6000, borrowRate: reads === 1 ? { apr: .06, note: '' } : undefined });
    const deposit = structuredClone(fluid.positions[0]);
    deposit.id = 'fluid-lending-example'; deposit.label = 'ETH lending deposit'; deposit.debtUsd = 0;
    deposit.assets = [deposit.assets[0]]; deposit.assets[0].supplyRate = { apr: .06, note: '' };
    fluid.positions.push(second, deposit);
    return route.fulfill({ json: fixture });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.fluid');
  await expect(card.getByRole('region', { name: 'Protocol monthly interest', exact: true })).toHaveCount(0);
  const vaults = card.getByRole('region', { name: 'Fluid vault monthly interest', exact: true });
  await expect(vaults).toHaveCount(2);
  await expect(vaults.nth(0).locator('.protocol-monthly-npl')).toHaveText('Monthly NPL: ≈ $1.46 / month');
  await expect(vaults.nth(1).locator('.protocol-monthly-npl')).toHaveText('Monthly NPL: ≈ -$20.00 / month');
  await expect(card.getByRole('region', { name: 'Fluid deposit monthly interest', exact: true }).locator('.protocol-monthly-npl')).toHaveText('Monthly NPL: ≈ $30.00 / month');
  const total = page.getByRole('region', { name: 'Total monthly NPL', exact: true });
  await expect(total.locator('strong')).toHaveText('≈ $11.46');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(vaults.nth(0).locator('.protocol-monthly-npl')).toHaveText('Monthly NPL: ≈ $1.46 / month');
  await expect(vaults.nth(1).locator('.protocol-monthly-npl')).toHaveText('Monthly NPL: Unavailable');
  await expect(total.locator('strong')).toHaveText('Unavailable');
  await expect(total.getByText(/A complete total is unavailable/)).toBeVisible();
});

test('shows Merkl unclaimed and pending balances by network without changing net value or NPL', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore an example/ }).click();
  const section = page.getByRole('region', { name: 'Merkl rewards', exact: true });
  await expect(section.getByText(/Illustrative Merkl rewards only/)).toBeVisible();
  await expect(section.locator('.merkl-network h3')).toHaveText(['Merkl · Ethereum', 'Merkl · Plasma', 'Merkl · Arbitrum', 'Merkl · Base']);
  const eth = section.locator('[data-chain="Ethereum"]');
  await expect(eth.locator('tbody tr').first().locator('td').nth(1)).toHaveText('1.5');
  await expect(eth.locator('tbody tr').first().locator('td').nth(2)).toHaveText('0.2');
  await expect(eth.getByText('$75.00', { exact: true })).toBeVisible();
  await expect(page.locator('.summary.primary strong')).toHaveText('$47,000.00');
  await expect(page.getByRole('region', { name: 'Total monthly NPL', exact: true }).locator('strong')).toHaveText('≈ -$4.35');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await section.screenshot({ path: '/tmp/defimon-merkl-mobile.png' });
});

test('refreshes Merkl independently and explains failures without losing lending balances', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: example }));
  await page.route('**/api/rewards/*', route => {
    reads++;
    return route.fulfill({ status: reads === 1 ? 200 : 503, json: reads === 1 ? { address: example.address, updatedAt: new Date().toISOString(), status: 'ok', networks: [{ chain: 'Ethereum', status: 'ok', rewards: [], unclaimedUsd: 0, pendingUsd: 0 }] } : { error: 'upstream failure' } });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const section = page.getByRole('region', { name: 'Merkl rewards', exact: true });
  await expect(section.getByText('No unclaimed or pending token rewards reported by Merkl.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(section.getByText(/Merkl rewards are unavailable/)).toBeVisible();
  await expect(section.getByText('No unclaimed or pending token rewards reported by Merkl.', { exact: true })).toHaveCount(0);
  await expect(page.locator('.summary.primary strong')).toHaveText('$31,500.00');
  expect(reads).toBe(2);
});

test('late Merkl responses cannot replace an illustrative example', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: example }));
  await page.route('**/api/rewards/*', async route => { await gate; await route.fulfill({ json: { address: example.address, updatedAt: new Date().toISOString(), status: 'error', networks: [], message: 'Old wallet Merkl failure' } }); });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  const started = page.waitForRequest('**/api/rewards/*');
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await started;
  await page.getByRole('button', { name: /Explore an example/ }).click();
  release();
  const section = page.getByRole('region', { name: 'Merkl rewards', exact: true });
  await expect(section.getByText(/Illustrative Merkl rewards only/)).toBeVisible();
  await expect(section.getByText('Old wallet Merkl failure', { exact: true })).toHaveCount(0);
  await expect(section.locator('.merkl-network')).toHaveCount(4);
});

test('Merkl balances remain visible when the lending provider fails', async ({ page }) => {
  await page.route('**/api/portfolio/*', route => route.fulfill({ status: 503, json: { error: 'Ethereum data is unavailable.' } }));
  await page.route('**/api/rewards/*', route => route.fulfill({ json: { address: example.address, updatedAt: new Date().toISOString(), status: 'ok', networks: [{ chain: 'Plasma', status: 'partial', unclaimedUsd: null, pendingUsd: null, message: 'Some reward prices are unavailable.', rewards: [{ address: '0x2222222222222222222222222222222222222222', symbol: 'RWD', decimals: 18, unclaimed: 6, pending: 2, unclaimedRaw: '6000000000000000000', pendingRaw: '2000000000000000000', priceUsd: null, unclaimedUsd: null, pendingUsd: null }] }] } }));
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.getByRole('alert')).toContainText('Ethereum data is unavailable');
  const section = page.getByRole('region', { name: 'Merkl rewards', exact: true });
  await expect(section.getByText('RWD', { exact: true })).toBeVisible();
  await expect(section.locator('tbody tr').first().locator('td').nth(1)).toHaveText('6');
  await expect(section.locator('tbody tr').first().locator('td').nth(4)).toHaveText('Unavailable');
});


test('applies live Merkl supply and borrow APR to matching Fluid vaults and net-borrowing Aave positions', async ({ page }) => {
  const fixture = aprPortfolio();
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/rewards/*', route => route.fulfill({ json: aprRewards() }));
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(fixture.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const fluid = page.locator('article.fluid');
  const gho = fluid.locator('tbody tr').first();
  await expect(gho.locator('td').nth(2).locator('.asset-rate')).toContainText('≈ 5.32%');
  await expect(gho.locator('td').nth(2).getByText('Merkl: +1.32%', { exact: true })).toBeVisible();
  await expect(gho.locator('td').nth(4).locator('.asset-rate')).toContainText('≈ 4.55%');
  await expect(gho.locator('td').nth(4).getByText('Protocol: 6.00%', { exact: true })).toBeVisible();
  await expect(gho.locator('td').nth(4).getByText('Merkl rebate: −1.45%', { exact: true })).toBeVisible();
  await expect(fluid.locator('.protocol-monthly-npl')).toHaveText('Monthly NPL: ≈ $13.16 / month');
  await expect(fluid.locator('.position-net-apr strong')).toHaveText('≈ 7.89%');
  const aaveBorrow = page.locator('article.aave-v4 tbody tr').first().locator('td').nth(4);
  await expect(aaveBorrow.locator('.asset-rate')).toContainText('≈ 4.95%');
  await expect(aaveBorrow.getByText('Merkl rebate: −1.05%', { exact: true })).toBeVisible();
  await aaveBorrow.getByText('Merkl reward details', { exact: true }).click();
  await expect(aaveBorrow.getByText(/Estimated eligible share: 60.00%/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Total monthly NPL', exact: true }).locator('strong')).toHaveText('≈ -$21.43');
  await expect(page.locator('.summary.primary strong')).toHaveText('-$4,000.00');
  const opportunities = page.getByRole('table', { name: 'Merkl APR opportunities and position matching' });
  await expect(opportunities.getByText('Applied to 1 position', { exact: true })).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await fluid.screenshot({ path: '/tmp/defimon-merkl-apr-mobile.png' });
});

test('Merkl APR failures preserve base rates and clearly exclude unverified incentives from NPL', async ({ page }) => {
  let reads = 0; const fixture = aprPortfolio();
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/rewards/*', route => { reads++; return route.fulfill({ json: reads === 1 ? aprRewards() : { ...aprRewards(), aprStatus: 'error', aprMessage: 'Merkl APR lookup is unavailable. Displayed rates and NPL exclude unverified Merkl incentives.', opportunities: [] } }); });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(fixture.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const total = page.getByRole('region', { name: 'Total monthly NPL', exact: true }).locator('strong');
  await expect(total).toHaveText('≈ -$21.43');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(total).toHaveText('≈ -$50.83');
  await expect(page.locator('.merkl-apr-notice')).toContainText('exclude unverified Merkl incentives');
  await expect(page.locator('article.fluid tbody tr').first().locator('td').nth(4).locator('.asset-rate')).toContainText('6.00%');
  await expect(page.locator('.summary.primary strong')).toHaveText('-$4,000.00');
});

test('Merkl vault rewards do not leak into a different Fluid vault', async ({ page }) => {
  const fixture = aprPortfolio();
  const other = structuredClone(fixture.protocols[1].positions[0]); other.id = 'fluid-nft-other'; other.marketAddress = '0x1111111111111111111111111111111111111111'; other.label = 'Other Fluid vault';
  fixture.protocols[1].positions.push(other);
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/rewards/*', route => route.fulfill({ json: aprRewards() }));
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(fixture.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const positions = page.locator('article.fluid > .position');
  await expect(positions.nth(0).locator('.protocol-monthly-npl')).toHaveText('Monthly NPL: ≈ $13.16 / month');
  await expect(positions.nth(1).locator('.protocol-monthly-npl')).toHaveText('Monthly NPL: ≈ -$7.50 / month');
  await expect(positions.nth(1).getByText('Merkl reward details', { exact: true })).toHaveCount(0);
});


test('a late Merkl APR lookup preserves liquidation scenario inputs and calculated prices', async ({ page }) => {
  const fixture = aprPortfolio(); const pos = fixture.protocols[0].positions[0];
  pos.suppliedUsd = 10000;
  pos.assets.push({ address: '0x2222222222222222222222222222222222222222', symbol: 'WETH', supplied: 2, borrowed: 0, priceUsd: 3000, collateral: true, liquidationThreshold: .85, liquidationPriceUsd: null, supplyRate: { apr: .03, note: '' } });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/rewards/*', async route => { await gate; await route.fulfill({ json: aprRewards() }); });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(fixture.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const aave = page.locator('article.aave-v4');
  await aave.getByLabel('USDT liquidation price (USD)').fill('0.8');
  await aave.getByRole('button', { name: 'Calculate', exact: true }).click();
  await expect(aave.locator('.calculated-price strong')).toHaveText('$4,188.24');
  release();
  await expect(aave.locator('tbody tr').first().locator('td').nth(4).getByText('Merkl rebate: −1.05%', { exact: true })).toBeVisible();
  await expect(aave.getByLabel('USDT liquidation price (USD)')).toHaveValue('0.8');
  await expect(aave.locator('.calculated-price strong')).toHaveText('$4,188.24');
});


test('shows monthly NPL before annualized APR for each protocol and Fluid vault', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore an example/ }).click();
  for (const [id, value, npl] of [['aave-v3', '≈ 0.50%', '≈ $5.00'], ['aave-v4', '≈ 1.90%', '≈ $7.92'], ['morpho', '≈ -3.00%', '≈ -$10.00'], ['compound', '≈ -3.93%', '≈ -$22.92'], ['fluid', '≈ 0.70%', '≈ $1.46']]) {
    const stats = page.locator(`article.${id}[data-chain="Ethereum"] .position-stats`).first();
    await expect(stats.locator(':scope > div > span')).toHaveText(['Supplied', 'Borrowed', 'Net value', 'Monthly NPL', 'APR ⓘ', 'Health factor ⓘ']);
    await expect(stats.locator('.position-monthly-npl strong')).toHaveText(npl);
    await expect(stats.locator('.position-net-apr strong')).toHaveText(value);
  }
  await expect(page.locator('article.morpho[data-chain="Ethereum"] .protocol-net-apr')).toHaveText('APR: ≈ -1.70%');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('article.fluid[data-chain="Ethereum"] .position-stats').screenshot({ path: '/tmp/defimon-net-apr-mobile.png' });
});

test('keeps NPL APR unavailable for zero net value or unknown monthly interest', async ({ page }) => {
  const fixture = structuredClone(example); fixture.protocols = fixture.protocols.filter(p => ['aave-v3', 'fluid'].includes(p.id));
  fixture.protocols[0].positions[0].suppliedUsd = fixture.protocols[0].positions[0].debtUsd;
  fixture.protocols[1].positions[0].assets[1].borrowRate = { apr: null, note: 'Unknown borrowing APR' };
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.locator('article.aave-v3 .position-net-apr strong')).toHaveText('Unavailable');
  await expect(page.locator('article.fluid .position-net-apr strong')).toHaveText('Unavailable');
  await expect(page.locator('article.fluid .position-monthly-npl strong')).toHaveText('Unavailable');
  await expect(page.locator('article.aave-v3 .position-monthly-npl strong')).toHaveText('≈ $5.00');
  await expect(page.locator('article.fluid .position-stats strong').nth(2)).toHaveText('$2,500.00');
});


test('portfolio APR uses displayed net value including wallet tokens and matches the supplied example', async ({ page }) => {
  const fixture = structuredClone(example); fixture.protocols = [fixture.protocols[0]];
  fixture.protocols[0].status = 'partial';
  const p = fixture.protocols[0].positions[0]; p.suppliedUsd = 1552965.90; p.debtUsd = 1273770.34;
  p.assets = [{ ...p.assets[0], symbol: 'USDC', supplied: p.suppliedUsd, borrowed: p.debtUsd, priceUsd: 1, supplyRate: { apr: 6677.18 * 12 / p.suppliedUsd, note: '' }, borrowRate: { apr: 5622.42 * 12 / p.debtUsd, note: '' } }];
  fixture.wallets = [{ chain: 'Ethereum', status: 'ok', pricedValueUsd: 900.58, unpricedCount: 0, tokens: [], coverage: 'Example wallet balance' }];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.locator('.summary.primary strong')).toHaveText('$280,096.14');
  await expect(page.getByRole('region', { name: 'Total monthly NPL', exact: true }).locator('strong')).toHaveText('≈ $1,054.76');
  const apr = page.getByRole('region', { name: 'Portfolio APR', exact: true });
  await expect(apr.locator('strong')).toHaveText('≈ 4.52%');
  await expect(apr.getByText('Checked assets only. Partial coverage.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('.summary-grid').screenshot({ path: '/tmp/defimon-portfolio-apr-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('.summary-grid').screenshot({ path: '/tmp/defimon-portfolio-apr-mobile.png' });
});

test('portfolio APR remains unavailable when net value is zero or total NPL cannot be checked', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/portfolio/*', route => {
    reads++; const fixture = structuredClone(example); fixture.protocols = [fixture.protocols[0]];
    const p = fixture.protocols[0].positions[0];
    if (reads === 1) p.suppliedUsd = p.debtUsd;
    else p.assets[1].borrowRate = { apr: null, note: 'Unknown borrowing interest' };
    return route.fulfill({ json: fixture });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const apr = page.getByRole('region', { name: 'Portfolio APR', exact: true });
  await expect(apr.locator('strong')).toHaveText('Unavailable');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Total monthly NPL', exact: true }).locator('strong')).toHaveText('Unavailable');
  await expect(apr.locator('strong')).toHaveText('Unavailable');
});


test('shows Morpho creator/curator/owner vaults with zero deposits without adding managed assets to portfolio totals', async ({ page }) => {
  const fixture = structuredClone(example);
  const morpho = fixture.protocols.find(p => p.id === 'morpho')!; fixture.protocols = [morpho];
  const depositor = structuredClone(morpho.positions[1]);
  depositor.vault = { address: '0x2222222222222222222222222222222222222222', version: 1, roles: [], totalAssets: 500000, totalAssetsUsd: 500000 };
  const created = structuredClone(depositor); created.id = 'morpho-vault-created'; created.label = 'Morpho vault V1 · Created zero deposit vault'; created.suppliedUsd = 0; created.assets[0].supplied = 0;
  created.vault = { address: '0x3333333333333333333333333333333333333333', version: 1, roles: [{ role: 'creator', source: 'api' }, { role: 'curator', source: 'onchain' }], totalAssets: 1000000, totalAssetsUsd: 1000000 };
  const owned = structuredClone(created); owned.id = 'morpho-vault-owned'; owned.label = 'Morpho vault V2 · Empty owned vault';
  owned.vault = { address: '0x4444444444444444444444444444444444444444', version: 2, roles: [{ role: 'owner', source: 'onchain' }], totalAssets: 0, totalAssetsUsd: 0 };
  morpho.positions = [depositor, created, owned];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.morpho');
  await expect(card.getByRole('region', { name: 'Morpho vault information', exact: true })).toHaveCount(3);
  await expect(card.getByText('Your roles: Creator (API record) · Curator', { exact: true })).toBeVisible();
  await expect(card.getByText('Your roles: Owner', { exact: true })).toBeVisible();
  await expect(card.getByText('Vault assets · all depositors: 1,000,000 USDC · $1,000,000.00', { exact: true })).toBeVisible();
  const empty = card.locator('.position').filter({ has: page.getByRole('heading', { name: 'Morpho vault V2 · Empty owned vault', exact: true }) });
  await expect(empty.locator('.position-stats strong').first()).toHaveText('$0.00');
  await expect(empty.getByText('Vault assets · all depositors: 0 USDC · $0.00', { exact: true })).toBeVisible();
  await expect(page.locator('.summary.primary strong')).toHaveText('$1,000.00');
  await expect(page.getByRole('region', { name: 'Total monthly NPL', exact: true }).locator('strong')).toHaveText('≈ $2.92');
  await expect(page.locator('.morpho-network-note')).toContainText('Plasma discovery is unsupported');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await empty.screenshot({ path: '/tmp/defimon-morpho-zero-vault-mobile.png' });
});

test('explains unavailable total NPL and Portfolio APR with protocol, network, vault and missing rate', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/portfolio/*', route => {
    const fixture = structuredClone(example);
    const fluid = fixture.protocols.find(p => p.id === 'fluid')!;
    fluid.chain = 'Plasma'; fluid.positions = [fluid.positions[0]];
    if (reads++ === 0) fluid.positions[0].assets[1].borrowRate = undefined;
    fixture.protocols = [fluid];
    return route.fulfill({ json: fixture });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill('0x5929D94eb4C41D91955154465a58a531Ad4CF7b8');
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const issues = page.getByRole('region', { name: 'Missing interest data', exact: true });
  await expect(issues.getByText(/Fluid · Plasma/)).toBeVisible();
  await expect(issues.getByText(/Borrow APR unavailable/)).toBeVisible();
  await expect(page.locator('.total-npl > strong')).toHaveText('Unavailable');
  await expect(page.locator('.portfolio-apr > strong')).toHaveText('Unavailable');
  await expect(page.locator('.summary.primary > strong')).not.toHaveText('—');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(issues).toHaveCount(0);
  await expect(page.locator('.total-npl > strong')).not.toHaveText('Unavailable');
  await expect(page.locator('.portfolio-apr > strong')).not.toHaveText('Unavailable');
});

test('keeps total NPL and Portfolio APR available when only Arbitrum managed-vault discovery fails', async ({ page }) => {
  const fixture = structuredClone(example);
  fixture.address = '0x5929D94eb4C41D91955154465a58a531Ad4CF7b8';
  fixture.protocols = [fixture.protocols[0], {
    id: 'morpho', name: 'Morpho', chain: 'Arbitrum', status: 'partial', coverage: 'Arbitrum Morpho vaults',
    balanceDiscoveryComplete: true, positions: [],
    message: 'Morpho V2 curator vault discovery is unavailable. Morpho V2 owner vault discovery is unavailable.',
  }];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(fixture.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.locator('.total-npl > strong')).toHaveText('≈ $5.00');
  await expect(page.locator('.portfolio-apr > strong')).not.toHaveText('Unavailable');
  await expect(page.getByRole('region', { name: 'Missing interest data', exact: true })).toHaveCount(0);
  const morpho = page.locator('article.morpho[data-chain="Arbitrum"]');
  await expect(morpho.getByText('Partially checked', { exact: true })).toBeVisible();
  await expect(morpho.locator('.protocol-warning')).toContainText('curator vault discovery is unavailable');
  await expect(morpho.locator('.protocol-monthly-npl')).toHaveText('Monthly NPL: ≈ $0.00 / month');
});

test('shows Morpho vault supply interest without loan fields and counts own V1/V2 deposits once across networks', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/portfolio/*', route => {
    const fixture = structuredClone(example);
    const morpho = fixture.protocols.find(p => p.id === 'morpho')!;
    const v1 = structuredClone(morpho.positions[1]);
    v1.id = 'morpho-vault-v1'; v1.label = 'Morpho vault V1 · Own Ethereum deposit'; v1.suppliedUsd = 2400;
    Object.assign(v1.assets[0], { address: '0x1111111111111111111111111111111111111111', supplied: 1200, priceUsd: 2, supplyRate: { apr: .12, note: '' } });
    v1.vault = { address: '0x2222222222222222222222222222222222222222', version: 1, roles: [], totalAssets: 1000000, totalAssetsUsd: 2000000 };
    const v2 = structuredClone(v1); v2.id = 'morpho-vault-v2'; v2.label = 'Morpho vault V2 · Own Arbitrum deposit'; v2.suppliedUsd = 600;
    Object.assign(v2.assets[0], { supplied: 600, priceUsd: 1, supplyRate: reads++ === 0 ? { apr: .06, note: '' } : undefined });
    v2.vault = { ...v1.vault, address: '0x3333333333333333333333333333333333333333', version: 2 };
    const managed = structuredClone(v1); managed.id = 'morpho-vault-managed'; managed.label = 'Morpho vault V1 · Managed only'; managed.suppliedUsd = 0;
    Object.assign(managed.assets[0], { supplied: 0, supplyRate: undefined, priceUsd: null });
    managed.vault = { ...v1.vault, roles: [{ role: 'curator', source: 'onchain' }] };
    fixture.protocols = [{ ...morpho, chain: 'Ethereum', positions: [v1, managed] }, { ...morpho, chain: 'Arbitrum', positions: [v2] }];
    return route.fulfill({ json: fixture });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const vaults = page.locator('.morpho-vault-position');
  await expect(vaults).toHaveCount(3);
  for (const vault of await vaults.all()) {
    await expect(vault.getByText('Borrowed', { exact: true })).toHaveCount(0);
    await expect(vault.getByText('Net value', { exact: true })).toHaveCount(0);
    await expect(vault.getByRole('columnheader', { name: 'Monthly interest earned', exact: true })).toBeVisible();
    await expect(vault.getByRole('columnheader', { name: 'Borrow APR', exact: true })).toHaveCount(0);
  }
  await expect(vaults.nth(0).locator('tbody td').last()).toHaveText('≈ 12 USDC / month≈ $24.00 / month');
  await expect(vaults.nth(1).locator('tbody td').last()).toHaveText('≈ 0 USDC / month≈ $0.00 / month');
  await expect(vaults.nth(2).locator('tbody td').last()).toHaveText('≈ 3 USDC / month≈ $3.00 / month');
  await expect(page.locator('.total-npl > strong')).toHaveText('≈ $27.00');
  await expect(page.locator('.summary.primary > strong')).toHaveText('$3,000.00');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await vaults.first().screenshot({ path: '/tmp/defimon-morpho-vault-interest-mobile.png' });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(vaults.nth(2).locator('tbody td').last()).toHaveText('Unavailable');
  await expect(page.locator('.total-npl > strong')).toHaveText('Unavailable');
});

test('switches between a two-column overview and recommendations with matching lending rates and nonzero Morpho deposits', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Dashboard sections', exact: true });
  const overview = nav.getByRole('button', { name: 'Wallet Overview', exact: true });
  const recommendations = nav.getByRole('button', { name: 'Recommendations', exact: true });
  await expect(overview).toHaveAttribute('aria-pressed', 'true');
  await recommendations.click();
  await expect(page.getByText(/Check a wallet address or explore the example/)).toBeVisible();
  await page.getByRole('button', { name: /Explore an example/ }).click();
  const section = page.getByRole('region', { name: 'Wallet recommendations', exact: true });
  await expect(section).toBeVisible();
  await expect(page.getByRole('region', { name: 'Wallet results', exact: true })).toBeHidden();
  await expect(section.locator('.recommendation-card')).not.toHaveCount(0);
  const first = section.locator('.recommendation-card').first();
  await expect(first.getByRole('columnheader')).toHaveText(['Supplied asset', 'Supply APR', 'Borrowed asset', 'Borrow APR']);
  await expect(first.locator('tbody tr').first().locator('td')).toHaveText(['WETH', /^3\.50%Rate details/, 'USDC', /^5\.50%Rate details/]);
  const vault = section.locator('.vault-recommendation').first();
  await expect(vault.getByRole('columnheader')).toHaveText(['Supplied asset', 'Supply APR']);
  await expect(vault.locator('tbody tr').first().locator('td').first()).toHaveText('USDC');
  await expect(section.getByText(/Example only/)).toBeVisible();
  const navBox = await nav.boundingBox(); const sectionBox = await section.boundingBox();
  expect(navBox!.x + navBox!.width).toBeLessThan(sectionBox!.x);
  await page.screenshot({ path: '/tmp/defimon-recommendations-desktop.png', fullPage: true });
  await overview.click();
  await expect(page.getByRole('region', { name: 'Wallet results', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Total monthly NPL', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Merkl rewards', exact: true })).toBeVisible();
  await expect(section).toHaveCount(0);
  await page.screenshot({ path: '/tmp/defimon-overview-sidebar-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await recommendations.click();
  await expect(section).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/defimon-recommendations-mobile.png', fullPage: true });
});

test('recommendations follow refreshed wallet data, retain unknown rates, and omit managed-only vaults', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/portfolio/*', route => {
    const fixture = structuredClone(example);
    const morpho = fixture.protocols.find(p => p.id === 'morpho')!;
    const owned = structuredClone(morpho.positions[1]); owned.id = 'morpho-vault-owned-empty'; owned.label = 'Managed-only vault'; owned.suppliedUsd = 0;
    owned.assets[0].supplied = 0;
    owned.vault = { address: 'vault', version: 2, roles: [{ role: 'owner', source: 'api' }], totalAssets: 1000000, totalAssetsUsd: 1000000 };
    morpho.positions.push(owned);
    if (reads++ > 0) { morpho.positions[1].assets[0].symbol = 'USDT'; morpho.positions[1].assets[0].supplyRate = undefined; }
    fixture.protocols = [morpho];
    return route.fulfill({ json: fixture });
  });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Recommendations', exact: true }).click();
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const section = page.getByRole('region', { name: 'Wallet recommendations', exact: true });
  await expect(section.locator('.vault-recommendation')).toHaveCount(1);
  await expect(section.getByText('Managed-only vault', { exact: true })).toHaveCount(0);
  await expect(section.locator('.vault-recommendation tbody td').first()).toHaveText('USDC');
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(section.locator('.vault-recommendation tbody td').first()).toHaveText('USDT');
  await expect(section.locator('.vault-recommendation tbody td').last()).toHaveText('Unavailable');
  await expect(page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Recommendations', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('finds lower borrow APRs and higher Morpho vault supply APRs without changing the wallet totals', async ({ page }) => {
  const fixture = structuredClone(example);
  const aave = fixture.protocols[0];
  Object.assign(aave.positions[0].assets[0], { symbol: 'wstETH', address: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0' });
  Object.assign(aave.positions[0].assets[1], { symbol: 'GHO', address: '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f', borrowRate: { apr: .045, note: '' } });
  const morpho = fixture.protocols.find(p => p.id === 'morpho')!;
  morpho.positions = [morpho.positions[1]];
  Object.assign(morpho.positions[0].assets[0], { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', supplyRate: { apr: .04, note: '' } });
  fixture.protocols = [aave, morpho];
  let marketReads = 0;
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/recommendations', async route => {
    const { targets } = route.request().postDataJSON(); marketReads++;
    expect(targets).toHaveLength(2);
    expect(targets[0]).not.toHaveProperty('wallet');
    if (marketReads === 3) { await route.fulfill({ status: 503, json: { error: 'Market source unavailable' } }); return; }
    await route.fulfill({ json: {
      targetIds: targets.map((t: any) => t.id), checkedAt: '2026-11-15T12:00:00Z',
      coverage: [{ protocol: 'Aave v3', network: 'ethereum', status: 'ok' }, { protocol: 'Fluid', network: 'plasma', status: 'error', message: 'Provider unavailable' }],
      alternatives: targets.flatMap((t: any) => [{ targetId: t.id, protocol: t.borrowed ? 'Morpho' : 'Fluid', network: 'arbitrum', market: '0x2222222222222222222222222222222222222222', label: 'Better verified market', liquidity: t.borrowed ? (marketReads === 1 ? { amount: 123456.789, symbol: 'GHO', token: t.borrowed, note: 'Morpho total available liquidity from supplied assets minus borrowed assets.' } : marketReads === 2 ? { amount: 0, symbol: 'GHO', token: t.borrowed, note: 'Borrowing capacity exhausted.' } : null) : null, supplyApr: t.borrowed ? 0 : .07, borrowApr: t.borrowed ? (marketReads === 1 ? .03 : .02) : null, lltv: .8, block: '100', url: 'https://app.morpho.org/', note: 'Instant protocol rate.' }, { targetId: t.id, protocol: 'Compound', network: 'ethereum', market: '0x3333333333333333333333333333333333333333', label: 'Worse rate', supplyApr: .02, borrowApr: t.borrowed ? .06 : null, lltv: .75, block: '100', url: 'https://app.compound.finance/', note: '' }, { targetId: t.id, protocol: 'Fluid', network: 'arbitrum', market: '0x4444444444444444444444444444444444444444', label: 'Liquidity unknown', supplyApr: .02, borrowApr: t.borrowed ? .035 : null, lltv: .8, block: '100', url: 'https://fluid.instadapp.io/', note: '', liquidity: null }, { targetId: t.id, protocol: 'Aave v4', network: 'ethereum', market: '0x5555555555555555555555555555555555555555', label: 'Higher liquidity market', supplyApr: .02, borrowApr: t.borrowed ? .04 : null, lltv: .8, block: '100', url: 'https://app.aave.com/', note: '', liquidity: { amount: 200000, symbol: 'GHO', token: t.borrowed, note: 'Borrowable pool cash.' } }]),
    } });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const totalBefore = await page.locator('.total-npl > strong').textContent();
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Recommendations', exact: true }).click();
  const loan = page.getByRole('region', { name: 'Alternatives for wstETH - GHO', exact: true });
  await expect(loan.getByText('Morpho · Arbitrum', { exact: true })).toBeVisible();
  await expect(loan.getByText('≈ 3.00%', { exact: true })).toBeVisible();
  await expect(loan.getByText('1.50 percentage points', { exact: true })).toBeVisible();
  await expect(loan.getByRole('columnheader')).toHaveText(['Alternative market', 'Supply APR', 'Borrow APR', 'Available Liquidity ↓', 'LLTV', 'Borrow APR reduction']);
  await expect(loan.getByText('123,457 GHO', { exact: true })).toBeVisible();
  await expect(loan.getByText('Total liquidity', { exact: true })).toBeVisible();
  await expect(loan.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(loan.locator('tbody tr').first()).toContainText('Higher liquidity market');
  await expect(loan.locator('tbody tr').nth(1)).toContainText('Better verified market');
  await expect(loan.locator('tbody tr').last()).toContainText('Liquidity unknown');
  await expect(loan.locator('.best-alternative-rate strong')).toHaveText('Best verified Borrow APR: ≈ 3.00%');
  await expect(loan.getByText('Worse rate', { exact: true })).toHaveCount(0);
  const vault = page.getByRole('region', { name: 'Alternatives for USDC', exact: true });
  await expect(vault.getByText('≈ 7.00%', { exact: true })).toBeVisible();
  await expect(vault.getByText('3.00 percentage points', { exact: true })).toBeVisible();
  await page.getByText(/Market search coverage/).click();
  await expect(page.getByText('Fluid · Plasma: Unavailable · Provider unavailable', { exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Wallet Overview', exact: true }).click();
  await expect(page.locator('.total-npl > strong')).toHaveText(totalBefore!);
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Recommendations', exact: true }).click();
  expect(marketReads).toBe(1);
  await page.getByRole('button', { name: 'Refresh alternative rates', exact: true }).click();
  await expect(loan.locator('tbody tr').filter({ hasText: 'Better verified market' }).locator('td').nth(2)).toHaveText('≈ 2.00%');
  await expect(loan.getByText('0 GHO', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/defimon-market-alternatives-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Refresh alternative rates', exact: true }).click();
  await expect(loan.getByText('Market search is unavailable. Refresh alternative rates to retry.', { exact: true })).toBeVisible();
  await expect(page.locator('.recommendation-card').first().locator('tbody tr').first().locator('td').last()).toContainText('4.50%');
});

test('shows automatic token-match provenance, manual priority and lookup failures without losing current rates', async ({ page }) => {
  const fixture = structuredClone(example); fixture.protocols = [fixture.protocols[0]];
  const assets = fixture.protocols[0].positions[0].assets;
  const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', gho = '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f', unlisted = '0x0000000000000000000000000000000000000123';
  assets[0].address = weth; assets[1].address = gho; assets[1].symbol = 'GHO';
  assets.push({ ...assets[0], address: unlisted, symbol: 'UNLISTED', supplied: 10 });
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/recommendations', route => route.fulfill({ json: {
    checkedAt: '2026-11-15T12:00:00Z', alternatives: [], coverage: [], tokenDiscovery: [
      { network: 'ethereum', token: weth, label: 'wrapped-ether', status: 'found', matches: { ethereum: weth, arbitrum: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1' }, sources: [{ provider: 'CoinGecko', assetId: 'weth', url: 'https://www.coingecko.com/en/coins/weth' }, { provider: 'CoinMarketCap', assetId: '2396', url: 'https://coinmarketcap.com/currencies/weth/' }], warnings: [] },
      { network: 'ethereum', token: gho, label: 'GHO', status: 'manual', matches: { ethereum: gho, plasma: '0xb77e872a68c62cfc0dfb02c067ecc3da23b4bbf3' }, sources: [], warnings: [] },
      { network: 'ethereum', token: unlisted, status: 'unavailable', matches: { ethereum: unlisted }, sources: [], warnings: ['CoinGecko lookup could not be completed.'] },
    ],
  } }));
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const total = await page.locator('.total-npl > strong').textContent();
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Recommendations', exact: true }).click();
  await page.getByText('Token matching · 1 automatic · 1 manual', { exact: true }).click();
  const details = page.locator('.token-discovery');
  await expect(details.getByRole('link', { name: /View CoinGecko record/ })).toHaveAttribute('href', 'https://www.coingecko.com/en/coins/weth');
  await expect(details.getByRole('link', { name: /View CoinMarketCap record/ })).toHaveAttribute('href', 'https://coinmarketcap.com/currencies/weth/');
  await expect(details.getByText('Manual match', { exact: true })).toBeVisible();
  await expect(details.getByText('Automatic lookup unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText(/Some automatic token matches could not be verified/)).toBeVisible();
  await expect(page.locator('.recommendation-card').first().getByRole('columnheader', { name: 'Borrow APR', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Wallet Overview', exact: true }).click();
  await expect(page.locator('.total-npl > strong')).toHaveText(total!);
});

test('keeps same-two-token Fluid vaults in overview but excludes them from recommendation cards and search targets', async ({ page }) => {
  let portfolioReads = 0, marketReads = 0;
  const fixture = structuredClone(example);
  const fluid = fixture.protocols.find(p => p.id === 'fluid')!; fixture.protocols = [fluid]; fluid.chain = 'Plasma';
  const loop = structuredClone(fluid.positions[0]); loop.id = 'fluid-nft-loop'; loop.label = 'Vault 33 · GHO/USDT0 / GHO/USDT0';
  loop.suppliedUsd = 3000; loop.debtUsd = 2000;
  Object.assign(loop.assets[0], { address: '0xb77e872a68c62cfc0dfb02c067ecc3da23b4bbf3', symbol: 'GHO', supplied: 1000, borrowed: 800, priceUsd: 1, supplyRate: { apr: .02, note: '' }, borrowRate: { apr: .04, note: '' } });
  Object.assign(loop.assets[1], { address: '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb', symbol: 'USDT0', supplied: 2000, borrowed: 1200, priceUsd: 1, supplyRate: { apr: .02, note: '' }, borrowRate: { apr: .04, note: '' } });
  const eligible = structuredClone(loop); eligible.id = 'fluid-nft-eligible'; eligible.label = 'Vault 36 · sUSDai / USDT0'; eligible.suppliedUsd = 1500; eligible.debtUsd = 1000;
  Object.assign(eligible.assets[0], { address: '0x0b2b2b2076d95dda7817e785989fe353fe955ef9', symbol: 'sUSDai', supplied: 1500, borrowed: 0 });
  Object.assign(eligible.assets[1], { supplied: 0, borrowed: 1000 });
  await page.route('**/api/portfolio/*', route => { fluid.positions = ++portfolioReads === 1 ? [loop, eligible] : [loop]; return route.fulfill({ json: fixture }); });
  await page.route('**/api/recommendations', route => {
    marketReads++;
    const targets = route.request().postDataJSON().targets;
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ network: 'plasma', supplied: eligible.assets[0].address, borrowed: eligible.assets[1].address });
    expect(targets[0].id).not.toContain('fluid-nft-loop');
    return route.fulfill({ json: { checkedAt: '2026-11-15T12:00:00Z', coverage: [], alternatives: [] } });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.getByRole('heading', { name: loop.label, exact: true })).toBeVisible();
  const total = await page.locator('.total-npl > strong').textContent();
  const nav = page.getByRole('navigation', { name: 'Dashboard sections' });
  await nav.getByRole('button', { name: 'Recommendations', exact: true }).click();
  const recommendations = page.getByRole('region', { name: 'Wallet recommendations' });
  await expect(recommendations.locator('.recommendation-card')).toHaveCount(1);
  await expect(recommendations.getByRole('heading', { name: loop.label, exact: true })).toHaveCount(0);
  await expect(recommendations.getByRole('heading', { name: eligible.label, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh alternative rates', exact: true })).toBeEnabled();
  expect(marketReads).toBe(1);
  await nav.getByRole('button', { name: 'Wallet Overview', exact: true }).click();
  await expect(page.locator('.total-npl > strong')).toHaveText(total!);
  await expect(page.getByRole('heading', { name: loop.label, exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Recommendations', exact: true }).click();
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(recommendations.getByText(/No eligible positions for recommendations/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh alternative rates', exact: true })).toHaveCount(0);
  expect(marketReads).toBe(1);
});

test('shows Euler positions, rates, LLTV, NPL and market alternatives on all three networks', async ({ page }) => {
  const fixture = structuredClone(example);
  const seed = structuredClone(fixture.protocols[0].positions[0]);
  fixture.protocols = (['Ethereum', 'Plasma', 'Arbitrum'] as const).map((chain, index) => {
    const position = structuredClone(seed);
    position.id = `euler-loan-${index}`; position.label = `Euler loan · ${chain}`;
    position.marketAddress = '0x3333333333333333333333333333333333333333';
    position.suppliedUsd = 6000; position.debtUsd = 1000; position.healthFactor = 4.8; position.risk = 'lower';
    Object.assign(position.assets[0], { symbol: chain === 'Plasma' ? 'WXPL' : 'WETH', address: chain === 'Ethereum' ? '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' : chain === 'Arbitrum' ? '0x82af49447d8a07e3bd95bd0d56f35241523fbab1' : '0x6100e367285b01f48d07953803a2d8dca5d19873', supplied: chain === 'Plasma' ? 12000 : 2, priceUsd: chain === 'Plasma' ? .5 : 3000, liquidationThreshold: .8, supplyRate: { apr: .02, note: 'Euler current lending APR.' }, priceSource: 'euler-oracle' });
    Object.assign(position.assets[1], { symbol: chain === 'Plasma' ? 'USDT0' : 'USDC', address: chain === 'Ethereum' ? '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' : chain === 'Arbitrum' ? '0xaf88d065e77c8cc2239327c5edb3a432268e5831' : '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb', borrowed: 1000, borrowRate: { apr: .06, note: 'Euler current borrow APR.' } });
    return { id: 'euler', name: 'Euler', chain, status: 'ok', coverage: 'Euler V2 EVK and EVC subaccounts', balanceDiscoveryComplete: true, positions: [position] };
  });
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/recommendations', route => {
    const targets = route.request().postDataJSON().targets;
    expect(targets).toHaveLength(3);
    return route.fulfill({ json: { checkedAt: '2026-11-15T12:00:00Z', coverage: [{ protocol: 'Euler', network: 'arbitrum', status: 'ok' }], alternatives: [{ targetId: targets[0].id, protocol: 'Euler', network: 'arbitrum', market: '0x9999999999999999999999999999999999999999', route: '0x8888888888888888888888888888888888888888', label: 'Euler alternative USDC vault', borrowApy: .03045453395, collateralVault: { address: '0x8888888888888888888888888888888888888888', label: 'Euler WETH collateral vault', url: 'https://app.euler.finance/vault/0x8888888888888888888888888888888888888888?network=arbitrum' }, supplyApr: .025, borrowApr: .03, lltv: .8, block: '321', url: 'https://app.euler.finance/', note: 'Euler EVK quote.', liquidity: { amount: 500000, symbol: 'USDC', token: fixture.protocols[0].positions[0].assets[1].address, note: 'Vault cash limited by borrowing cap.' } }] } });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const cards = page.locator('article.euler');
  await expect(cards).toHaveCount(3);
  for (const card of await cards.all()) {
    await expect(card.getByRole('columnheader', { name: 'Supply APR', exact: true })).toBeVisible();
    await expect(card.locator('tbody tr').first().locator('td').nth(6)).toContainText('80.00%');
    await expect(card.locator('.position-stats strong').last()).toHaveText('4.80');
    await expect(card.locator('.protocol-monthly-npl')).toHaveText('Monthly NPL: ≈ $5.00 / month');
    await expect(card.locator('.position-monthly-npl strong')).toHaveText('≈ $5.00');
    await expect(card.getByText('Euler oracle estimate', { exact: true })).toBeVisible();
  }
  await expect(page.locator('.total-npl > strong')).toHaveText('≈ $15.00');
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Recommendations', exact: true }).click();
  const alternatives = page.getByRole('region', { name: 'Alternatives for WETH - USDC', exact: true }).first();
  await expect(alternatives.getByRole('link', { name: /Euler alternative USDC vault/ })).toBeVisible();
  await expect(alternatives.getByRole('link', { name: /Borrowing vault:/ })).toHaveAttribute('href', 'https://app.euler.finance/');
  await expect(alternatives.getByRole('link', { name: /Collateral vault: Euler WETH/ })).toHaveAttribute('href', 'https://app.euler.finance/vault/0x8888888888888888888888888888888888888888?network=arbitrum');
  await expect(alternatives.getByTitle('0x8888888888888888888888888888888888888888', { exact: true })).toBeVisible();
  await expect(alternatives.getByText('500,000 USDC', { exact: true })).toBeVisible();
  await expect(alternatives.getByText('Borrow APY: ≈ 3.05%', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('labels stablecoin and savings stablecoin wallet balances without changing values', async ({ page }) => {
  const fixture = structuredClone(example);
  fixture.wallets = [{ chain: 'Ethereum', status: 'ok', coverage: 'Configured token registry', pricedValueUsd: 7.32, unpricedCount: 0, tokens: [
    { address: '0x0B2b2B2076d95dda7817e785989fE353fe955ef9', symbol: 'sUSDai', category: 'Savings stablecoin', balance: 2, priceUsd: 1.21, valueUsd: 2.42 },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', category: 'Stablecoin', balance: 5, priceUsd: .98, valueUsd: 4.9 },
  ] }];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const wallet = page.locator('.wallet-network[data-chain="Ethereum"]');
  await expect(wallet.getByText('Savings stablecoin', { exact: true })).toBeVisible();
  await expect(wallet.getByText('Stablecoin', { exact: true })).toBeVisible();
  await expect(wallet.getByRole('row').filter({ hasText: 'sUSDai' })).toContainText('$2.42');
  await expect(wallet.getByRole('row').filter({ hasText: 'USDC' })).toContainText('$4.90');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('shows Base balances, monthly NPL and Base alternatives without treating Base as Arbitrum', async ({ page }) => {
  const fixture = structuredClone(example);
  fixture.chain = 'Base';
  const position = structuredClone(fixture.protocols[0].positions[0]);
  Object.assign(position, { id: 'base-aave', label: 'Base main market', suppliedUsd: 6000, debtUsd: 1000, healthFactor: 4.8, risk: 'lower' });
  position.assets = [
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', supplied: 2, borrowed: 0, priceUsd: 3000, collateral: true, liquidationThreshold: .8, liquidationPriceUsd: 625, supplyRate: { apr: .02, note: 'Current Base supply APR' } },
    { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', supplied: 0, borrowed: 1000, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, borrowRate: { apr: .06, note: 'Current Base borrow APR' } },
  ];
  fixture.protocols = [{ id: 'aave-v3', name: 'Aave v3', chain: 'Base', status: 'ok', coverage: 'Base main market', positions: [position] }];
  fixture.wallets = [{ chain: 'Base', status: 'ok', pricedValueUsd: 300, unpricedCount: 0, coverage: 'Base wallet tokens', tokens: [{ address: 'native', symbol: 'ETH', balance: .1, priceUsd: 3000, valueUsd: 300 }] }];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/recommendations', route => {
    const { targets } = route.request().postDataJSON();
    expect(targets[0].network).toBe('base');
    return route.fulfill({ json: { checkedAt: new Date().toISOString(), coverage: [{ protocol: 'Euler', network: 'base', status: 'ok' }], alternatives: [{ targetId: targets[0].id, protocol: 'Euler', network: 'base', market: '0x9999999999999999999999999999999999999999', label: 'Base USDC vault', supplyApr: .02, borrowApr: .03, borrowApy: .0304545, lltv: .8, block: '845300', url: 'https://app.euler.finance/', note: 'Base rate quote', liquidity: { amount: 500000, symbol: 'USDC', token: position.assets[1].address, note: 'Base vault liquidity' } }] } });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.locator('article.aave-v3[data-chain="Base"] .position-monthly-npl strong')).toHaveText('≈ $5.00');
  await expect(page.locator('article.aave-v3[data-chain="Base"] .position-net-apr strong')).toHaveText('≈ 1.20%');
  await expect(page.locator('.wallet-network[data-chain="Base"]')).toContainText('ETH');
  await expect(page.locator('.summary.primary strong')).toHaveText('$5,300.00');
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Recommendations', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Alternatives for WETH - USDC', exact: true }).getByText('Euler · Base', { exact: true })).toBeVisible();
  await expect(page.getByText('500,000 USDC', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('includes reUSD oracle growth in Supply APR, monthly NPL and alternatives without calling it sUSDai', async ({ page }) => {
  const fixture = structuredClone(example);
  fixture.protocols = [{ id: 'morpho', name: 'Morpho', status: 'ok', chain: 'Ethereum', coverage: 'Savings collateral', positions: [{
    id: 'reusd-loan', label: 'Morpho · reUSD / USDC', suppliedUsd: 1100, debtUsd: 500, healthFactor: 1.98, risk: 'lower', notes: [], assets: [
      { address: '0x5086bf358635b81d8c47c66d1c8b9e567db70c72', symbol: 'reUSD', supplied: 1000, borrowed: 0, priceUsd: 1.1, collateral: true, liquidationThreshold: .9, liquidationPriceUsd: null, supplyRate: { apr: 0, note: 'Collateral earns no protocol lending interest' }, intrinsicSupplyRate: { apr: .12, estimated: true, note: 'Past-month reUSD oracle growth, annualized with 365 / 30.', source: { chain: 'Ethereum', oracle: '0x72B5760cFBE437DD01409f44055fDfB8f8121B46', kind: 'chainlink', label: 'reUSD/USD exchange-rate oracle', startRate: 1, endRate: 1 + .12 * 30 / 365, startTimestamp: 1792000000, endTimestamp: 1794592000, windowDays: 30 } } },
      { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', supplied: 0, borrowed: 500, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, borrowRate: { apr: .06, note: 'Current borrow APR' } },
    ],
  }] }];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/recommendations', route => {
    const { targets } = route.request().postDataJSON();
    return route.fulfill({ json: { checkedAt: new Date().toISOString(), coverage: [], alternatives: [{ targetId: targets[0].id, protocol: 'Morpho', network: 'base', market: 'alternative', label: 'Base reUSD market', supplyApr: 0, borrowApr: .05, lltv: .9, block: '123', url: 'https://app.morpho.org/', note: '' }] } });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.morpho');
  await expect(card.locator('.position-monthly-npl strong')).toHaveText('≈ $8.50');
  await expect(card.locator('.position-net-apr strong')).toHaveText('≈ 17.00%');
  await expect(page.locator('.total-npl > strong')).toHaveText('≈ $8.50');
  await expect(card.getByText('Intrinsic (30d): 12.00%', { exact: true })).toBeVisible();
  await card.getByText('Intrinsic yield details', { exact: true }).click();
  await expect(card.getByText(/Source: Ethereum reUSD\/USD exchange-rate oracle/)).toBeVisible();
  await expect(card.getByText(/Source: Ethereum sUSDai/)).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Recommendations', exact: true }).click();
  const alternatives = page.getByRole('region', { name: 'Alternatives for reUSD - USDC', exact: true });
  await expect(alternatives.locator('tbody tr td').nth(1)).toHaveText('≈ 12.00%');
});

test('links active market titles and full identifiers across protocols and wraps addresses on mobile', async ({ page }) => {
  const market = `0x${'ab'.repeat(32)}`;
  const addresses = Array.from({ length: 8 }, (_, i) => `0x${String(i + 1).repeat(40)}`);
  const template = example.protocols[0].positions[0];
  const position = (label: string, address: string) => ({ ...template, id: address, label, marketAddress: address });
  const fixture = { ...combinedExample, protocols: [
    { ...example.protocols[0], id: 'aave-v3', chain: 'Ethereum', positions: [position('Aave main market', addresses[0])] },
    { ...example.protocols[0], id: 'aave-v4', chain: 'Ethereum', positions: [position('Aave v4 MAIN', addresses[1])] },
    { ...example.protocols[0], id: 'compound', name: 'Compound', chain: 'Arbitrum', positions: [position('Compound USDC market', addresses[2])] },
    { ...example.protocols[0], id: 'fluid', name: 'Fluid', chain: 'Plasma', positions: [position('Fluid vault 162', addresses[3])] },
    { ...example.protocols[0], id: 'morpho', name: 'Morpho', chain: 'Ethereum', positions: [{ ...template, id: `morpho-market-${market}`, label: 'Morpho reUSD / USDC' }] },
    { ...example.protocols[0], id: 'morpho', name: 'Morpho', chain: 'Base', positions: [{ ...position('Morpho USDC vault', addresses[4]), vault: { address: addresses[4], version: 1, roles: [], totalAssets: 1000, totalAssetsUsd: 1000 } }] },
    { ...example.protocols[0], id: 'euler', name: 'Euler', chain: 'Arbitrum', positions: [{ ...position('Euler lending position', addresses[5]), receiptTokens: [addresses[5], addresses[6], addresses[6]] }] },
    { ...example.protocols[0], id: 'fluid', name: 'Fluid', chain: 'Base', positions: [{ ...position('Fluid lending deposit', addresses[7]), id: `fluid-lending-${addresses[7]}` }] },
  ] };
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await page.getByLabel('Wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  const urls = [
    `https://etherscan.io/address/${addresses[0]}`, `https://etherscan.io/address/${addresses[1]}`,
    `https://arbiscan.io/address/${addresses[2]}`, `https://plasmascan.to/address/${addresses[3]}`,
    `https://app.morpho.org/ethereum/market/${market}`, `https://app.morpho.org/base/vault/${addresses[4]}`,
    `https://app.euler.finance/vault/${addresses[5]}?network=arbitrum`, `https://basescan.org/address/${addresses[7]}`,
  ];
  const titles = ['Aave main market', 'Aave v4 MAIN', 'Compound USDC market', 'Fluid vault 162', 'Morpho reUSD / USDC', 'Morpho USDC vault', 'Euler lending position', 'Fluid lending deposit'];
  for (let i = 0; i < titles.length; i++) {
    const card = page.locator('.position').filter({ has: page.getByRole('heading', { name: titles[i], exact: true }) });
    await expect(card.getByRole('heading').getByRole('link')).toHaveAttribute('href', urls[i]);
    await expect(card.locator('.position-market-links a').first()).toHaveAttribute('href', urls[i]);
    await expect(card.locator('.position-market-links code').first()).toHaveText(i === 4 ? market : addresses[i === 5 ? 4 : i === 6 ? 5 : i === 7 ? 7 : i]);
  }
  await expect(page.locator('.position-market-links a').filter({ hasText: addresses[6] })).toHaveCount(1);
  await expect(page.locator('.position-market-links a').filter({ hasText: addresses[6] })).toHaveAttribute('href', `https://app.euler.finance/vault/${addresses[6]}?network=arbitrum`);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('.position-market-links code').filter({ hasText: market })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
