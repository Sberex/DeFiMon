import { test, expect } from '@playwright/test';
import { combinedExample, example } from '../src/example';
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
  await expect(page.getByText(/Coverage: 5 of 5/)).toBeVisible();
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

test('shows all three networks grouped by protocol, refreshes all, and fits on mobile', async ({ page }) => {
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
  await expect(page.getByText(/Coverage: 11 of 11 protocol readers completed on Ethereum \+ Plasma \+ Arbitrum/)).toBeVisible();
  await expect(page.locator('article.protocol')).toHaveCount(11);
  await expect(page.locator('article.protocol .protocol-name h2')).toHaveText(['Aave v3 · Ethereum', 'Aave v3 · Plasma', 'Aave v3 · Arbitrum', 'Aave v4 · Ethereum', 'Morpho · Ethereum', 'Morpho · Arbitrum', 'Compound · Ethereum', 'Compound · Arbitrum', 'Fluid · Ethereum', 'Fluid · Plasma', 'Fluid · Arbitrum']);
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
  await expect(page.locator('article.protocol')).toHaveCount(11);
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
  await expect(page.locator('.wallet-network .protocol-name h2')).toHaveText(['Wallet tokens · Ethereum', 'Wallet tokens · Plasma', 'Wallet tokens · Arbitrum']);
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
  await expect(page.locator('.wallet-network')).toHaveCount(3);
  await page.getByText('Add another token', { exact: true }).click();
  await page.getByLabel('Token network').selectOption('plasma');
  await page.getByLabel('Token contract address').fill('0x2222222222222222222222222222222222222222');
  await page.getByRole('button', { name: 'Add token', exact: true }).click();
  await expect(page.locator('.wallet-network')).toHaveCount(3);
  expect(queries.at(-1)).toBe('plasma:0x2222222222222222222222222222222222222222');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('.wallet-network')).toHaveCount(3);
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
  await expect(card.getByText('Unavailable', { exact: true })).toBeVisible();
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
  await expect(card.locator('.position-stats strong').nth(1)).toHaveText('$30,000.00');
  await expect(card.locator('.position-stats strong').nth(3)).toHaveText('1.80');
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
