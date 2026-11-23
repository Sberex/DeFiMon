import { test, expect } from '@playwright/test';
import { combinedExample, example } from '../src/example';
import { portfolio as aprPortfolio, rewards as aprRewards } from '../tests/fixtures/merkl-apr';
test.beforeEach(async ({ page }) => {
  await page.route('**/analysis/utilization-alert-state.json*', route => route.fulfill({ json: { version: 1, lastRunAt: null, watches: [] } }));
  await page.route('**/analysis/liquidity-alert-state.json*', route => route.fulfill({ json: { version: 1, lastRunAt: null, watches: [] } }));
  await page.route('**/api/rewards/*', route => route.fulfill({ json: { address: new URL(route.request().url()).pathname.split('/').at(-1), updatedAt: new Date().toISOString(), status: 'ok', networks: [] } }));
});
test('sorts valuable Pendle PT/YT and collapses expired, zero and absent holdings without changing wallet value', async ({ page }) => {
  const fixture = structuredClone(combinedExample); fixture.protocols = [];
  const info = { kind: 'PT' as const, name: '', marketAddress: '0x1111111111111111111111111111111111111111', syAddress: '0x2222222222222222222222222222222222222222', quoteAsset: { address: '0x3333333333333333333333333333333333333333', symbol: 'USDC' }, oraclePrice: 1, quoteValue: 10, impliedApy: .1, underlyingApy: 0, tvlUsd: 100000, expiry: Date.parse('2026-12-17T00:00:00Z') / 1000, matured: false, oracleAddress: '0x5542be50420E88dd7D5B4a3D488FA6ED82F6DAc2', blockNumber: '100', marketUpdatedAt: null, notes: [] };
  const token = (i: number, name: string, value: number | null, kind: 'PT' | 'YT' = 'PT', matured = false) => ({ address: `0x${String(i).repeat(40)}`, symbol: name, balance: 10, priceUsd: value === null ? null : value / 10, valueUsd: value, pendle: { ...info, name, kind, matured } });
  fixture.wallets = [
    { chain: 'Ethereum', status: 'partial', pricedValueUsd: 3700, unpricedCount: 1, coverage: '', tokens: [token(1, 'Smaller PT', 100), token(2, 'Larger YT', 400, 'YT'), token(3, 'Expired redeemable PT', 2000, 'PT', true), token(4, 'Zero-value YT', 0, 'YT'), token(5, 'Unpriced PT', null), token(7, 'Highest PT', 1200)], pendle: { status: 'partial', balanceDiscoveryComplete: true, marketCount: 100, blockNumber: '100', coverage: '' } },
    { chain: 'Plasma', status: 'ok', pricedValueUsd: 0, unpricedCount: 0, coverage: '', tokens: [], pendle: { status: 'ok', marketCount: 10, blockNumber: '100', coverage: '' } },
    { chain: 'Base', status: 'ok', pricedValueUsd: 800, unpricedCount: 0, coverage: '', tokens: [token(6, 'Base PT', 800)], pendle: { status: 'ok', marketCount: 10, blockNumber: '100', coverage: '' } },
  ];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const section = page.getByRole('region', { name: 'Pendle positions' });
  await expect(section.locator('.pendle-active .protocol-heading h2')).toHaveText(['Pendle · Ethereum', 'Pendle · Base', 'Pendle · Ethereum']);
  await expect(section.locator('.pendle-active .pendle-position h3')).toHaveText(['Highest PT ↗', 'Base PT ↗', 'Larger YT ↗', 'Smaller PT ↗', 'Unpriced PT ↗']);
  const collapsed = section.locator('.pendle-inactive'); await expect(collapsed).not.toHaveAttribute('open');
  await expect(collapsed.getByText('Expired redeemable PT ↗', { exact: true })).toBeHidden(); await expect(collapsed.getByText('Zero-value YT ↗', { exact: true })).toBeHidden();
  await expect(section.getByText(/No directly held/)).toBeHidden(); await expect(page.locator('.summary.primary strong')).toHaveText('$4,500.00');
  await collapsed.locator('summary').first().click(); await expect(collapsed.getByText('Expired redeemable PT ↗', { exact: true })).toBeVisible(); await expect(collapsed.getByText('Zero-value YT ↗', { exact: true })).toBeVisible(); await expect(collapsed.getByText(/No directly held/)).toBeVisible();
  await expect(page.locator('.summary.primary strong')).toHaveText('$4,500.00');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('orders overview markets by net value and collapses confirmed empty markets and zero personal vault deposits', async ({ page }) => {
  const fixture = structuredClone(example);
  const position = (id: string, supplied: number, debt = 0) => ({ id, label: id, suppliedUsd: supplied, debtUsd: debt, healthFactor: debt ? 2 : null, risk: debt ? 'lower' as const : 'no-debt' as const, notes: [], assets: [{ address: '0x1111111111111111111111111111111111111111', symbol: 'USDC', supplied, borrowed: debt, priceUsd: 1, collateral: true, liquidationThreshold: .9, liquidationPriceUsd: null, supplyRate: { apr: .12, note: '' }, borrowRate: { apr: .06, note: '' } }] });
  const protocol = (id: string, name: string, positions: ReturnType<typeof position>[], chain: 'Ethereum' | 'Arbitrum' | 'Base' = 'Ethereum') => ({ id, name, chain, status: 'ok' as const, coverage: '', positions });
  const managed = { ...position('Managed zero vault', 0), vault: { address: '0x2222222222222222222222222222222222222222', version: 1 as const, roles: [{ role: 'curator' as const, source: 'api' as const }], totalAssets: 1000000, totalAssetsUsd: 1000000 } };
  fixture.protocols = [protocol('morpho', 'Morpho', [managed, position('Small market', 100)]), protocol('aave-v3', 'Aave v3', []), protocol('compound', 'Compound', [position('Middle market', 6000, 1000)], 'Base'), protocol('fluid', 'Fluid', [position('Smaller Fluid market', 2000), position('Largest Fluid market', 10000, 1000)], 'Arbitrum')];
  fixture.wallets = [];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const overview = page.getByRole('region', { name: 'Wallet results', exact: true }), active = overview.locator('.active-markets');
  await expect(active.locator('.protocol-heading h2')).toHaveText(['Fluid · Arbitrum', 'Compound · Base', 'Morpho · Ethereum']);
  await expect(active.locator('article.fluid .position-title h3')).toHaveText(['Largest Fluid market', 'Smaller Fluid market']);
  const collapsed = overview.locator('.zero-supply-markets'); await expect(collapsed).not.toHaveAttribute('open'); await expect(collapsed.locator('.protocol-heading h2')).toHaveCount(2);
  await expect(collapsed.getByRole('heading', { name: 'Aave v3 · Ethereum' })).toBeHidden();
  await expect(overview.getByRole('heading', { name: 'Managed zero vault', exact: true })).toBeHidden();
  await expect(page.locator('.summary.primary strong')).toHaveText('$16,100.00'); const total = await page.locator('.total-npl > strong').textContent();
  await collapsed.locator('summary').first().click(); await expect(collapsed.getByRole('heading', { name: 'Aave v3 · Ethereum' })).toBeVisible(); await expect(collapsed.getByRole('heading', { name: 'Managed zero vault', exact: true })).toBeVisible();
  await expect(page.locator('.summary.primary strong')).toHaveText('$16,100.00'); await expect(page.locator('.total-npl > strong')).toHaveText(total!);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('collapses lower-liquidity alternatives while keeping enough, equal and unknown capacity visible', async ({ page }) => {
  const fixture = structuredClone(example), protocol = fixture.protocols[0]; fixture.protocols = [protocol]; protocol.positions = [protocol.positions[0]];
  const position = protocol.positions[0]; position.assets[0].address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; position.assets[1].address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; position.assets[0].symbol = 'WETH'; position.assets[1].symbol = 'USDC'; position.assets[1].borrowed = 1000; position.debtUsd = 1000; position.assets[1].borrowRate = { apr: .06, note: '' };
  let reads = 0;
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/recommendations', route => {
    reads++; const t = route.request().postDataJSON().targets[0];
    const specs = reads === 1 ? [['Enough liquidity', 2000, .04], ['Exact liquidity', 1000, .035], ['Small liquidity', 999, .01], ['No liquidity', 0, 0], ['Unknown liquidity', null, .045]] as const : [['Small liquidity', 999, .01], ['No liquidity', 0, 0]] as const;
    const alternatives = specs.map(([label, amount, borrowApr], i) => ({ targetId: t.id, protocol: 'Morpho', network: 'arbitrum', market: `0x${String(i + 1).repeat(64)}`, label, supplyApr: 0, borrowApr, lltv: .86, block: '100', url: 'https://app.morpho.org/', note: '', liquidity: amount === null ? null : { amount, symbol: 'USDC', token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', note: 'Available USDC.' } }));
    return route.fulfill({ json: { alternatives, coverage: [], checkedAt: new Date().toISOString() } });
  });
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const total = await page.locator('.total-npl > strong').textContent();
  await page.getByRole('button', { name: 'Recommendations', exact: true }).click();
  const pair = page.getByRole('region', { name: 'Alternatives for WETH - USDC', exact: true });
  await expect(pair.getByRole('table', { name: 'Better rates for WETH - USDC' }).locator('tbody tr')).toHaveCount(3);
  await expect(pair.getByRole('link', { name: 'Enough liquidity' })).toBeVisible(); await expect(pair.getByRole('link', { name: 'Exact liquidity' })).toBeVisible(); await expect(pair.getByRole('link', { name: 'Unknown liquidity' })).toBeVisible();
  await expect(pair.locator('.refinance-amount')).toHaveText('Amount to refinance: 1,000 USDC');
  await expect(page.locator('.borrowed-refinance-amount')).toHaveText('1,000 USDC to refinance');
  await expect(pair.locator('.best-alternative-rate strong')).toHaveText('Best verified Borrow APR: ≈ 3.50%');
  const low = pair.locator('.insufficient-liquidity'); await expect(low).not.toHaveAttribute('open'); await expect(low.getByText('Small liquidity', { exact: true })).toBeHidden();
  await low.locator('summary').first().click();
  await expect(low.getByText('Small liquidity', { exact: true })).toBeVisible(); await expect(low.getByText('No liquidity', { exact: true })).toBeVisible(); await expect(low.locator('tbody tr').first()).toContainText('999 USDC');
  await expect(low.locator('p').first()).toHaveText('Available liquidity is below your borrowed balance of 1,000 USDC.');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Refresh alternative rates', exact: true }).click();
  await expect(pair.getByText('All better-rate alternatives have less liquidity than your borrowed balance.', { exact: true })).toBeVisible();
  await expect(pair.locator('.best-alternative-rate')).toHaveCount(0); await expect(pair.locator('.insufficient-liquidity')).not.toHaveAttribute('open');
  await page.getByRole('button', { name: 'Wallet Overview', exact: true }).click(); await expect(page.locator('.total-npl > strong')).toHaveText(total!);
});
test('values a supplied-only Fluid vault and includes its full monthly earnings in position and portfolio NPL', async ({ page }) => {
  const fixture = structuredClone(example), fluid = fixture.protocols.find(p => p.id === 'fluid')!;
  fluid.chain = 'Plasma'; fluid.status = 'partial'; fluid.message = 'Collateral value estimated from Fluid’s oracle and the configured USDT0 reference price.';
  fluid.positions = [{ id: 'fluid-nft-3015', label: 'Vault 36 · sUSDai / no debt · NFT 3015', marketAddress: '0xA9FF23CfF9439c418DA08CE7954a92E46311761e', suppliedUsd: 3402.09487, debtUsd: 0, healthFactor: null, risk: 'no-debt', notes: [], assets: [{ address: '0x0B2b2B2076d95dda7817e785989fE353fe955ef9', symbol: 'sUSDai', supplied: 3022.74, borrowed: 0, collateral: true, priceUsd: 1.1255, priceSource: 'fluid-oracle', liquidationThreshold: .9, liquidationPriceUsd: null, supplyRate: { apr: 0, note: 'No protocol interest on collateral.' }, intrinsicSupplyRate: { apr: .0795, estimated: true, note: 'Verified intrinsic savings yield.', source: { chain: 'Ethereum', oracle: '0x0fBE44B96320EBD455FF9CCE0781fA9A83Ddee7a' } } }] }];
  fixture.protocols = [fluid]; fixture.wallets = [];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const p = page.locator('article.fluid .position');
  await expect(p.locator('.position-stats strong')).toHaveText(['$3,402.09', '$0.00', '$3,402.09', '≈ $22.54', '≈ 7.95%', '—']);
  await expect(p.getByText('No borrowing', { exact: true })).toBeVisible();
  await expect(p.locator('tbody tr')).toHaveCount(1); await expect(p.getByText('Fluid oracle estimate', { exact: true })).toBeVisible();
  await expect(p.locator('tbody td').nth(8)).toContainText('20.0257 sUSDai / month'); await expect(p.locator('tbody td').nth(8)).toContainText('$22.54 / month');
  const interest = p.getByRole('region', { name: 'Fluid vault monthly interest', exact: true }); await expect(interest.locator('.protocol-net-value')).toHaveText('Net value: $3,402.09'); await expect(interest.locator('.protocol-monthly-npl')).toHaveText('Monthly NPL: ≈ $22.54 / month');
  await expect(page.locator('.summary.primary strong')).toHaveText('$3,402.09'); await expect(page.locator('.total-npl > strong')).toHaveText('≈ $22.54'); await expect(page.locator('.portfolio-apr > strong')).toHaveText('≈ 7.95%');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.locator('.total-npl > strong')).toHaveText('≈ $22.54');
});
test('keeps Plasma Aave eMode GHO collateral in overview, totals and recommendations instead of Bad Debt', async ({ page }) => {
  const fixture = structuredClone(example), aave = fixture.protocols.find(p => p.id === 'aave-v3')!;
  const gho = '0xb77E872A68C62CfC0dFb02C067Ecc3DA23B4bbf3', usdt = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb';
  aave.chain = 'Plasma'; aave.positions = [{ id: 'aave-main', label: 'Plasma main market', marketAddress: '0x925a2A7214Ed92428B5b1B090F80b25700095e12', suppliedUsd: 48580.73, collateralValueUsd: 48580.73, debtUsd: 46174.86, healthFactor: 1.01, risk: 'high', liquidationModel: 'unavailable', notes: ['Efficiency mode is enabled.'], assets: [
    { address: usdt, symbol: 'USDT0', supplied: 0, borrowed: 46174.86, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, borrowRate: { apr: .0432, note: '' } },
    { address: gho, symbol: 'GHO', supplied: 48580.73, borrowed: 0, priceUsd: 1, collateral: true, lltv: .96, liquidationThreshold: null, liquidationPriceUsd: null, supplyRate: { apr: .0409, note: 'Current eMode reserve APR.' } },
  ] }];
  fixture.protocols = [aave]; fixture.wallets = [];
  const requests: any[] = [];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/recommendations', route => { requests.push(route.request().postDataJSON()); return route.fulfill({ json: { alternatives: [], coverage: [], checkedAt: new Date().toISOString() } }); });
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.getByRole('region', { name: 'Wallet results', exact: true }).locator('article.aave-v3');
  await expect(card.getByRole('heading', { name: 'Plasma main market', exact: true })).toBeVisible(); await expect(card.getByText('High risk', { exact: true })).toBeVisible();
  const row = card.locator('tbody tr').filter({ hasText: 'GHO' }); await expect(row.getByText('Collateral', { exact: true })).toBeVisible(); await expect(row.getByText('96.00%', { exact: true })).toBeVisible();
  await expect(page.locator('.summary.primary strong')).toHaveText('$2,405.87');
  await expect(page.locator('.summary-grid .summary').nth(1).locator('strong')).toHaveText('$48,580.73'); await expect(page.locator('.summary-grid .summary').nth(2).locator('strong')).toHaveText('$46,174.86');
  await expect(page.locator('.total-npl > strong')).toHaveText('≈ -$0.65');
  await page.getByRole('button', { name: 'Recommendations', exact: true }).click(); await expect(page.locator('.recommendation-card')).toHaveCount(1);
  await expect.poll(() => requests.length).toBe(1); expect(requests[0].targets[0]).toMatchObject({ network: 'plasma', supplied: gho, borrowed: usdt });
  await page.getByRole('button', { name: 'Risk Assessment', exact: true }).click(); await expect(page.getByRole('region', { name: 'Risk Assessment', exact: true }).getByText(/No checked positions match/)).toBeVisible();
});
test('separates Bad Debt from overview, totals and recommendation requests, and restores positions after a successful oracle refresh', async ({ page }) => {
  let reads = 0; const requests: any[] = [];
  const id = '0x23a7d0ff682b323363fb8ba58327ed87001f6306e09b7fd7413bbe4698e749c8';
  const loan = { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC' };
  await page.route('**/api/portfolio/*', route => {
    const fixture = structuredClone(example); reads++;
    const good = { id: 'morpho-vault-safe', label: 'Healthy USDC deposit', suppliedUsd: 1000, debtUsd: 0, healthFactor: null, risk: 'no-debt' as const, notes: [], assets: [{ ...loan, supplied: 1000, borrowed: 0, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, supplyRate: { apr: .12, note: '' } }] };
    const bad = { ...structuredClone(good), id: `morpho-market-${id}`, label: 'Morpho lending deposit · USDC · msY / USDC', suppliedUsd: 6000000, morphoMarket: { loanAsset: loan, collateralAsset: { address: '0x890A5122Aa1dA30fEC4286DE7904Ff808F0bd74A', symbol: 'msY' }, supplyOnly: true }, collateralOracleChecks: [{ asset: 'msY', oracle: '0xB0b6Fc449CcF81Ff4129A86ddc814412E3Cd9Aa4', status: reads === 1 ? 'unavailable' as const : 'ok' as const }], assets: [{ ...good.assets[0], supplied: 6000000, supplyRate: { apr: 8, note: '' } }] };
    const euler = { ...structuredClone(good), id: 'euler-bad', label: 'Euler failed collateral oracle', collateralOracleChecks: [{ asset: 'WETH', oracle: loan.address, status: 'zero' as const }] };
    const underwater = { ...structuredClone(good), id: 'aave-underwater', label: 'Aave underwater loan', suppliedUsd: 500, debtUsd: 600, assets: [{ ...good.assets[0], supplied: 500, borrowed: 600, collateral: true }] };
    const base = fixture.protocols[0];
    fixture.protocols = [{ ...base, id: 'morpho', name: 'Morpho', status: 'ok', positions: [bad, good] }, { ...base, id: 'euler', name: 'Euler', status: 'ok', positions: [euler] }, { ...base, positions: [underwater], status: 'ok' }];
    fixture.wallets = [{ chain: 'Ethereum', status: 'ok', pricedValueUsd: 100, unpricedCount: 0, coverage: '', tokens: [{ address: 'native', symbol: 'ETH', balance: .1, priceUsd: 1000, valueUsd: 100 }] }];
    return route.fulfill({ json: fixture });
  });
  await page.route('**/api/recommendations', route => { requests.push(route.request().postDataJSON()); return route.fulfill({ json: { alternatives: [], coverage: [], checkedAt: new Date().toISOString() } }); });
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const nav = page.getByRole('navigation', { name: 'Dashboard sections' });
  const topLevel = nav.locator(':scope > button');
  await expect(topLevel).toHaveCount(3);
  for (const [i, name] of ['Wallet Overview', 'Recommendations', 'Risk Assessment'].entries()) await expect(topLevel.nth(i)).toHaveAccessibleName(name);
  await expect(nav.getByRole('group', { name: 'Recommendations subsections' }).getByRole('button', { name: 'Cookbook' })).toBeVisible();
  await expect(page.locator('.summary.primary strong')).toHaveText('$1,100.00');
  await expect(page.locator('.summary-grid .summary').nth(1).locator('strong')).toHaveText('$1,000.00');
  await expect(page.locator('.summary-grid .summary').nth(2).locator('strong')).toHaveText('$0.00');
  await expect(page.locator('.total-npl > strong')).toHaveText('≈ $10.00'); await expect(page.locator('.portfolio-apr > strong')).toHaveText('≈ 10.91%');
  const overview = page.getByRole('region', { name: 'Wallet results', exact: true }); await expect(overview.getByRole('heading', { name: /msY/ })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Recommendations', exact: true }).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(1); await expect.poll(() => requests.length).toBe(1); expect(requests[0].targets).toHaveLength(1); expect(requests[0].targets[0].id).not.toContain(id);
  await nav.getByRole('button', { name: 'Risk Assessment', exact: true }).click();
  const risk = page.getByRole('region', { name: 'Risk Assessment', exact: true }); await expect(risk).toBeVisible();
  await expect(risk.locator('.position')).toHaveCount(3); await expect(risk.getByText('msY collateral oracle could not return a price.', { exact: true })).toBeVisible();
  await expect(risk.getByText('WETH collateral oracle returned zero.', { exact: true })).toBeVisible(); await expect(risk.getByText('Wallet borrowing value exceeds the value of its supplied collateral.', { exact: true })).toBeVisible();
  await expect(risk.locator('.position-market-links a').first()).toHaveAttribute('href', `https://app.morpho.org/ethereum/market/${id}`);
  await expect(risk.locator('.vault-interest-note')).toContainText('Excluded from overview totals and Total NPL');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/defimon-risk-assessment-mobile.png', fullPage: true });
  await nav.getByRole('button', { name: 'Wallet Overview', exact: true }).click(); await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(overview.getByRole('heading', { name: /msY/ })).toBeVisible(); await expect(page.locator('.summary.primary strong')).toHaveText('$6,001,100.00');
  await nav.getByRole('button', { name: 'Risk Assessment', exact: true }).click(); await expect(risk.locator('.position')).toHaveCount(2);
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
test('shows known zero overview balances when every readable position is excluded by the Bad Debt rules', async ({ page }) => {
  const fixture = structuredClone(example), morpho = fixture.protocols.find(p => p.id === 'morpho')!;
  morpho.status = 'partial'; morpho.positions = [morpho.positions[0]];
  morpho.positions[0].collateralOracleChecks = [{ asset: 'Collateral', oracle: 'oracle', status: 'unavailable' }];
  fixture.protocols = [morpho]; fixture.wallets = [];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.locator('.summary.primary strong')).toHaveText('$0.00');
  await expect(page.locator('.summary-grid .summary').nth(1).locator('strong')).toHaveText('$0.00');
  await expect(page.locator('.total-npl > strong')).toHaveText('≈ $0.00');
  await expect(page.locator('.portfolio-apr > strong')).toHaveText('Unavailable');
  await page.getByRole('button', { name: 'Risk Assessment', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Risk Assessment', exact: true }).locator('.position')).toHaveCount(1);
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
  await expect(card.locator('.position').filter({ has: page.getByRole('heading', { name: 'Aave v4 · MAIN', exact: true }) }).locator('.position-stats').getByText('0.90', { exact: true })).toBeVisible();
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

test('shows all five networks sorted by net value, refreshes all, and fits on mobile', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/portfolio/*', route => {
    expect(new URL(route.request().url()).searchParams.get('chain')).toBe('all'); reads++;
    return route.fulfill({ json: { ...combinedExample, updatedAt: new Date().toISOString(), networks: [
      { chain: 'Ethereum', status: 'ok', blockNumber: String(900 + reads), updatedAt: new Date().toISOString() },
      { chain: 'Plasma', status: 'ok', blockNumber: String(1900 + reads), updatedAt: new Date().toISOString() },
      { chain: 'Arbitrum', status: 'ok', blockNumber: String(2900 + reads), updatedAt: new Date().toISOString() },
      { chain: 'Base', status: 'ok', blockNumber: String(3900 + reads), updatedAt: new Date().toISOString() },
      { chain: 'Binance Smart Chain', status: 'ok', blockNumber: String(4900 + reads), updatedAt: new Date().toISOString() },
    ] } });
  });
  await page.goto('/');
  await expect(page.getByLabel('Blockchain')).toHaveCount(0);
  await page.getByLabel('Wallet address').fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.getByText(/Coverage: 22 of 22 protocol readers completed on Ethereum \+ Plasma \+ Arbitrum/)).toBeVisible();
  await expect(page.locator('article.protocol')).toHaveCount(22);
  await expect(page.locator('article.protocol .protocol-name h2')).toHaveText(['Aave v3 · Ethereum', 'Compound · Ethereum', 'Aave v4 · Ethereum', 'Morpho · Ethereum', 'Aave v3 · Plasma', 'Fluid · Ethereum', 'Fluid · Plasma', 'Aave v3 · Arbitrum', 'Compound · Arbitrum', 'Fluid · Arbitrum', 'Morpho · Arbitrum', 'Aave v3 · Base', 'Aave v3 · Binance Smart Chain', 'Morpho · Base', 'Compound · Base', 'Fluid · Base', 'Fluid · Binance Smart Chain', 'Euler · Ethereum', 'Euler · Plasma', 'Euler · Arbitrum', 'Euler · Base', 'Euler · Binance Smart Chain']);
  await expect(page.getByText(/Ethereum · Block 901/)).toBeVisible();
  await expect(page.getByText(/Plasma · Block 1901/)).toBeVisible();
  await expect(page.getByText(/Arbitrum · Block 2901/)).toBeVisible();
  await expect(page.getByText(/Base · Block 3901/)).toBeVisible();
  await expect(page.getByText(/Binance Smart Chain · Block 4901/)).toBeVisible();
  await expect(page.getByText('$47,000.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText(/Ethereum · Block 902/)).toBeVisible();
  await expect(page.getByText(/Plasma · Block 1902/)).toBeVisible();
  await expect(page.getByText(/Arbitrum · Block 2902/)).toBeVisible();
  await expect(page.getByText(/Base · Block 3902/)).toBeVisible();
  await expect(page.getByText(/Binance Smart Chain · Block 4902/)).toBeVisible();
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
  await expect(page.locator('article.protocol')).toHaveCount(22);
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
  await expect(page.locator('.wallet-network .protocol-name h2')).toHaveText(['Wallet tokens · Ethereum', 'Wallet tokens · Plasma', 'Wallet tokens · Arbitrum', 'Wallet tokens · Base', 'Wallet tokens · Binance Smart Chain']);
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
  await expect(page.locator('.wallet-network')).toHaveCount(5);
  await page.getByText('Add another token', { exact: true }).click();
  await page.getByLabel('Token network').selectOption('plasma');
  await page.getByLabel('Token contract address').fill('0x2222222222222222222222222222222222222222');
  await page.getByRole('button', { name: 'Add token', exact: true }).click();
  await expect(page.locator('.wallet-network')).toHaveCount(5);
  expect(queries.at(-1)).toBe('plasma:0x2222222222222222222222222222222222222222');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('.wallet-network')).toHaveCount(5);
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
  await expect(page.getByRole('region', { name: 'Protocol monthly interest', exact: true })).toHaveCount(8);
  await page.locator('.zero-supply-markets > summary').click();
  await expect(page.getByRole('region', { name: 'Protocol monthly interest', exact: true })).toHaveCount(17);
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
    second.id = 'fluid-nft-second'; second.label = 'Vault 22'; second.suppliedUsd = 6000; second.debtUsd = 6000;
    Object.assign(second.assets[0], { supplied: 2, supplyRate: { apr: .02, note: '' } });
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
  await expect(total.locator('strong')).toHaveText('≈ $41.46');
  await expect(total).toContainText('partial');
  await expect(total.getByText(/Unknown components are excluded/)).toBeVisible();
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
  await page.getByRole('button', { name: 'Risk Assessment', exact: true }).click();
  const aaveBorrow = page.locator('#risk-assessment-panel article.aave-v4 tbody tr').first().locator('td').nth(4);
  await expect(aaveBorrow.locator('.asset-rate')).toContainText('≈ 4.95%');
  await expect(aaveBorrow.getByText('Merkl rebate: −1.05%', { exact: true })).toBeVisible();
  await aaveBorrow.getByText('Merkl reward details', { exact: true }).click();
  await expect(aaveBorrow.getByText(/Estimated eligible share: 60.00%/)).toBeVisible();
  await page.getByRole('button', { name: 'Wallet Overview', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Total monthly NPL', exact: true }).locator('strong')).toHaveText('≈ $13.16');
  await expect(page.locator('.summary.primary strong')).toHaveText('$2,000.00');
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
  await expect(total).toHaveText('≈ $13.16');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(total).toHaveText('≈ -$7.50');
  await expect(page.locator('.merkl-apr-notice')).toContainText('exclude unverified Merkl incentives');
  await expect(page.locator('article.fluid tbody tr').first().locator('td').nth(4).locator('.asset-rate')).toContainText('6.00%');
  await expect(page.locator('.summary.primary strong')).toHaveText('$2,000.00');
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

test('portfolio APR guards zero net value and uses known partial NPL when a borrowing rate is missing', async ({ page }) => {
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
  await expect(page.getByRole('region', { name: 'Total monthly NPL', exact: true }).locator('strong')).toHaveText('≈ $87.50');
  await expect(apr.locator('strong')).toHaveText('≈ 8.75%');
  await expect(apr).toContainText('partial');
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
  await page.locator('.zero-supply-markets > summary').click();
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
  await expect(page.locator('.morpho-network-note')).toContainText('Plasma and Binance Smart Chain discovery are unsupported');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await empty.screenshot({ path: '/tmp/defimon-morpho-zero-vault-mobile.png' });
});

test('shows partial total NPL and Portfolio APR with protocol, network, vault and missing rate', async ({ page }) => {
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
  await expect(page.locator('.total-npl > strong')).not.toHaveText('Unavailable');
  await expect(page.locator('.total-npl')).toContainText('partial');
  await expect(page.locator('.portfolio-apr > strong')).not.toHaveText('Unavailable');
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
  await page.locator('.zero-supply-markets > summary').click();
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
  await page.locator('.zero-supply-markets > summary').click();
  const vaults = page.locator('.morpho-vault-position');
  await expect(vaults).toHaveCount(3);
  for (const vault of await vaults.all()) {
    await expect(vault.getByText('Borrowed', { exact: true })).toHaveCount(0);
    await expect(vault.getByText('Net value', { exact: true })).toHaveCount(0);
    await expect(vault.getByRole('columnheader', { name: 'Monthly interest earned', exact: true })).toBeVisible();
    await expect(vault.getByRole('columnheader', { name: 'Borrow APR', exact: true })).toHaveCount(0);
  }
  await expect(vaults.nth(0).locator('tbody td').last()).toHaveText('≈ 12 USDC / month≈ $24.00 / month');
  await expect(vaults.nth(2).locator('tbody td').last()).toHaveText('≈ 0 USDC / month≈ $0.00 / month');
  await expect(vaults.nth(1).locator('tbody td').last()).toHaveText('≈ 3 USDC / month≈ $3.00 / month');
  await expect(page.locator('.total-npl > strong')).toHaveText('≈ $27.00');
  await expect(page.locator('.summary.primary > strong')).toHaveText('$3,000.00');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await vaults.first().screenshot({ path: '/tmp/defimon-morpho-vault-interest-mobile.png' });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(vaults.nth(1).locator('tbody td').last()).toHaveText('Unavailable');
  await expect(page.locator('.total-npl > strong')).toHaveText('≈ $24.00');
  await expect(page.locator('.total-npl')).toContainText('partial');
});

test('shows supply-only Morpho msY and PT markets as USDC deposits without loan fields or invented collateral', async ({ page }) => {
  const fixture = structuredClone(example), morpho = fixture.protocols.find(p => p.id === 'morpho')!;
  const ids = ['0x23a7d0ff682b323363fb8ba58327ed87001f6306e09b7fd7413bbe4698e749c8', '0x2afd063a5af8e050069cfad4da95c81768b85b140bea2bd89e00407b15ce82c8'];
  const collaterals = ['msY', 'PT-jrUSDe-2APR2026'], loan = { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC' };
  morpho.positions = ids.map((id, i) => ({ id: `morpho-market-${id}`, label: `Morpho lending deposit · USDC · ${collaterals[i]} / USDC · ${id.slice(0, 10)}…`, suppliedUsd: i === 0 ? 1000 : 1200, debtUsd: 0, healthFactor: null, risk: 'no-debt', notes: [], morphoMarket: { loanAsset: loan, collateralAsset: { address: `0x${String(i + 1).repeat(40)}`, symbol: collaterals[i] }, supplyOnly: true }, assets: [{ ...loan, supplied: i === 0 ? 1000 : 1200, borrowed: 0, collateral: false, priceUsd: 1, liquidationThreshold: null, liquidationPriceUsd: null, supplyRate: { apr: i === 0 ? 8 : .12, note: 'Current on-chain market APR.' } }] }));
  morpho.status = 'ok'; fixture.protocols = [morpho]; fixture.wallets = [];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/markets', route => route.fulfill({ json: { alternatives: [], coverage: [], checkedAt: new Date().toISOString() } }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const deposits = page.locator('.morpho-vault-position'); await expect(deposits).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const deposit = deposits.filter({ has: page.getByRole('heading', { name: new RegExp(collaterals[i]) }) });
    await expect(deposit.getByRole('columnheader')).toHaveText(['Asset', 'Supplied', 'Supply APR', 'Current price', 'Monthly interest earned']);
    await expect(deposit.getByRole('region', { name: 'Morpho market deposit information' })).toContainText(`Market collateral: ${collaterals[i]}`);
    await expect(deposit.locator('tbody tr')).toHaveCount(1); await expect(deposit.locator('tbody td').first()).toHaveText('USDC');
    for (const field of ['Borrowed', 'Net value', 'Health factor ⓘ', 'Borrow APR', 'Est. liquidation price']) await expect(deposit.getByText(field, { exact: true })).toHaveCount(0);
    await expect(deposit.locator('.position-market-links a')).toHaveAttribute('href', `https://app.morpho.org/ethereum/market/${ids[i]}`);
  }
  await expect(page.locator('.summary.primary strong')).toHaveText('$2,200.00'); await expect(page.locator('.total-npl > strong')).toHaveText('≈ $678.67');
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Recommendations' }).click();
  const cards = page.locator('.recommendation-card'); await expect(cards).toHaveCount(2);
  for (const card of await cards.all()) { await expect(card.getByRole('columnheader')).toHaveText(['Supplied asset', 'Supply APR']); await expect(card.locator('.recommendation-kind')).toHaveText('Market deposit'); }
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
  await expect(first.locator('tbody tr').first().locator('td')).toHaveText(['WETH', /^3\.50%Rate details/, 'USDC18,000 USDC to refinance', /^5\.50%Rate details/]);
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
    if (reads++ > 0) { morpho.positions[1].assets[0].symbol = 'USDT'; morpho.positions[1].assets[0].supplyRate = undefined; morpho.positions[0].assets[1].borrowed = 2000; morpho.positions[0].debtUsd = 2000; }
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
  await expect(section.locator('.borrowed-refinance-amount')).toHaveText(['2,500 USDC to refinance', '2,500 USDC to refinance']);
  await expect(section.locator('.refinance-amount')).toHaveText(['Amount to refinance: 2,500 USDC', 'Amount to refinance: 2,500 USDC']);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(section.locator('.vault-recommendation tbody td').first()).toHaveText('USDT');
  await expect(section.locator('.borrowed-refinance-amount')).toHaveText(['2,000 USDC to refinance', '2,000 USDC to refinance']);
  await expect(section.locator('.refinance-amount')).toHaveText(['Amount to refinance: 2,000 USDC', 'Amount to refinance: 2,000 USDC']);
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
  await expect(loan.getByText('0 GHO', { exact: true })).toBeHidden();
  await loan.getByText('Lower liquidity markets (1)', { exact: true }).click();
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
  Object.assign(loop.assets[1], { address: '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb', symbol: 'USDT0', supplied: 2000, borrowed: 1200, collateral: true, priceUsd: 1, supplyRate: { apr: .02, note: '' }, borrowRate: { apr: .04, note: '' } });
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

test('shows Pendle wallet holdings, accounting-asset prices, APYs, TVL and exact UTC/Kyiv expiry without double counting', async ({ page }) => {
  const fixture = structuredClone(combinedExample);
  const market = '0x13285bcbc27f92b47b4edb99d744c07b48c977c0', pt = '0xecfafdc7741323a945a163ed068b5a3c43483957', yt = '0xa8bd3b21291ace53927b35563fc80615919e63d7';
  const info = { kind: 'PT' as const, name: 'PT reUSD (USDC)', marketAddress: market, syAddress: '0x9487bd5a3b16ecb5f3184453e3ee75b800141648', quoteAsset: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC' }, oraclePrice: .99, quoteValue: 99, impliedApy: .12, underlyingApy: .07, tvlUsd: 5000000, expiry: Date.parse('2026-12-10T00:00:00Z') / 1000, matured: false, oracleAddress: '0x5542be50420E88dd7D5B4a3D488FA6ED82F6DAc2', blockNumber: '123', marketUpdatedAt: '2026-11-17T10:00:00Z', notes: ['Current pool-implied oracle rate; no guaranteed sale price.'] };
  fixture.wallets![0].tokens.push({ address: pt, symbol: 'PT-reUSD-10DEC2026', balance: 100, priceUsd: .99 * .98, valueUsd: 99 * .98, pendle: info });
  fixture.wallets![0].tokens.push({ address: yt, symbol: 'YT-reUSD-expired', balance: 50, priceUsd: 0, valueUsd: 0, pendle: { ...info, kind: 'YT', name: 'Expired YT reUSD', oraclePrice: 0, quoteValue: 0, impliedApy: null, underlyingApy: null, matured: true, expiry: Date.parse('2026-09-24T00:00:00Z') / 1000 } });
  fixture.wallets![0].pricedValueUsd! += 99 * .98;
  fixture.wallets!.forEach(w => { w.pendle = { status: 'ok', coverage: 'PT/YT held directly. Values counted once in wallet totals. Claimable interest is separate.', marketCount: 12, blockNumber: '123' }; });
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const section = page.getByRole('region', { name: 'Pendle positions' });
  await expect(section.locator('.pendle-active .protocol-heading h2')).toHaveText(['Pendle · Ethereum']);
  await expect(section.locator('.pendle-inactive')).not.toHaveAttribute('open');
  await expect(section.getByText('Not applicable · expired', { exact: true }).first()).toBeHidden();
  await section.locator('.pendle-inactive > summary').click();
  await expect(section.locator('.pendle-collapsed-networks .protocol-heading h2')).toHaveText(['Pendle · Ethereum', 'Pendle · Plasma', 'Pendle · Arbitrum', 'Pendle · Base', 'Pendle · Binance Smart Chain']);
  const position = section.locator('.pendle-position').filter({ has: page.getByRole('heading', { name: 'PT reUSD (USDC) ↗' }) });
  await expect(position.getByText('99 USDC', { exact: true })).toBeVisible();
  await expect(position.getByText('0.99 USDC', { exact: true })).toBeVisible();
  await expect(position.getByText('12.00%', { exact: true })).toBeVisible(); await expect(position.getByText('7.00%', { exact: true })).toBeVisible();
  await expect(position.getByText('$5,000,000.00', { exact: true })).toBeVisible();
  await expect(position.locator('time')).toHaveText('2026-12-10 00:00:00 UTC');
  await expect(position.locator('.pendle-expiry small')).toContainText('02:00:00');
  await expect(position.getByRole('heading').getByRole('link')).toHaveAttribute('href', `https://app.pendle.finance/trade/markets/${market}/swap?view=pt&chain=ethereum`);
  await expect(section.getByText('Not applicable · expired', { exact: true })).toHaveCount(2);
  await expect(page.locator('.summary.primary strong')).toHaveText('$47,097.02');
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/defimon-pendle-mobile.png', fullPage: true });
});

test('shows sUSDat PT and YT market metrics including zero underlying APY', async ({ page }) => {
  const fixture = structuredClone(combinedExample), market = '0xb6fe0f0811931a38aa97534bac3c147437223e38';
  const info = { name: '', kind: 'PT' as const, marketAddress: market, syAddress: '0x8917f8c7feb840b5837edc7e128123baa2f289f9', quoteAsset: { address: '0x23238f20b894f29041f48d88ee91131c395aaa71', symbol: 'USDat' }, oraclePrice: .9725, quoteValue: 97.25, impliedApy: .14162075, underlyingApy: 0, tvlUsd: 1409156.50, expiry: Date.parse('2027-01-14T00:00:00Z') / 1000, matured: false, oracleAddress: '0x5542be50420E88dd7D5B4a3D488FA6ED82F6DAc2', blockNumber: '123', marketUpdatedAt: '2026-11-17T14:36:00Z', notes: [] };
  for (const [kind, address] of [['PT', '0x0b985c624bb2949432cce77cfd246f01390a0517'], ['YT', '0xc38901aa77112efc519a1f8bd501eb2f68055689']] as const) fixture.wallets![0].tokens.push({ address, symbol: `${kind}-sUSDat`, balance: 100, priceUsd: .97, valueUsd: 97, pendle: { ...info, kind, name: `${kind} sUSDat (USDat)` } });
  fixture.wallets![0].pendle = { status: 'ok', marketCount: 512, blockNumber: '123', coverage: 'PT/YT held directly.' };
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  for (const kind of ['PT', 'YT']) {
    const position = page.getByRole('region', { name: 'Pendle positions' }).locator('.pendle-position').filter({ has: page.getByRole('heading', { name: `${kind} sUSDat (USDat) ↗` }) });
    await expect(position.getByText('14.16%', { exact: true })).toBeVisible();
    await expect(position.getByText('0.00%', { exact: true })).toBeVisible();
    await expect(position.getByText('$1,409,156.50', { exact: true })).toBeVisible();
    await expect(position.getByRole('heading').getByRole('link')).toHaveAttribute('href', `https://app.pendle.finance/trade/markets/${market}/swap?view=${kind.toLowerCase()}&chain=ethereum`);
  }
});

test('keeps Pendle discovery errors distinct from a checked empty wallet', async ({ page }) => {
  const fixture = structuredClone(combinedExample);
  fixture.wallets![0].pendle = { status: 'error', marketCount: 0, blockNumber: '123', coverage: 'PT/YT wallet tokens', message: 'Pendle token discovery is unavailable. Holdings have not been checked.' };
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const section = page.getByRole('region', { name: 'Pendle positions' });
  await expect(section.getByText(/Holdings have not been checked/)).toBeVisible();
  await expect(section.getByText(/No directly held/)).toHaveCount(0);
  await expect(page.locator('.summary.primary strong')).toHaveText('$47,000.00');
});

test('uses PT Implied APY as Supply APR in monthly NPL, position APR and portfolio totals', async ({ page }) => {
  const pt = '0x1111111111111111111111111111111111111111';
  const position = { id: 'pt-loan', label: 'PT-USD3-17DEC2026 / USDC', suppliedUsd: 990, debtUsd: 500, healthFactor: 1.5, risk: 'lower' as const, notes: [], assets: [
    { symbol: 'PT-USD3-17DEC2026', address: pt, supplied: 1000, borrowed: 0, priceUsd: .99, collateral: true, liquidationThreshold: .9, liquidationPriceUsd: null, supplyRate: { apr: .1507, estimated: true, note: 'Pendle Implied APY used directly as Supply APR, without APY-to-APR conversion.', pendlePt: { network: 'ethereum' as const, marketAddress: '0x5555555555555555555555555555555555555555', expiry: 1797465600, updatedAt: '2026-11-17T10:00:00Z' } } },
    { symbol: 'USDC', address: '0x2222222222222222222222222222222222222222', supplied: 0, borrowed: 500, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, borrowRate: { apr: .06, note: 'Borrow APR' } },
  ] };
  const fixture = { ...structuredClone(example), wallets: [], protocols: [{ id: 'morpho', name: 'Morpho', status: 'ok', coverage: 'PT loan', positions: [position] }, { id: 'fluid', name: 'Fluid', status: 'ok', coverage: 'PT vault', positions: [{ ...position, id: 'fluid-pt-vault' }] }] };
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const positions = page.locator('.position');
  await expect(positions).toHaveCount(2);
  for (const card of await positions.all()) {
    await expect(card.locator('tbody tr').first().locator('.asset-rate')).toContainText('15.07%');
    await expect(card.locator('.position-monthly-npl strong')).toHaveText('≈ $9.93');
    await expect(card.locator('.position-net-apr strong')).toHaveText('≈ 24.33%');
    await card.locator('tbody tr').first().getByText('Estimate details', { exact: true }).click();
    await expect(card.getByRole('link', { name: /View PT Implied APY/ })).toHaveAttribute('href', 'https://app.pendle.finance/trade/markets/0x5555555555555555555555555555555555555555/swap?view=pt&chain=ethereum');
  }
  await expect(page.locator('.total-npl strong')).toHaveText('≈ $19.87');
  await expect(page.locator('.portfolio-apr strong')).toHaveText('≈ 24.33%');
});

test('includes Lido wstETH collateral APR in monthly earnings, NPL, position APR and portfolio APR', async ({ page }) => {
  const wsteth = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0';
  const position = { id: 'wsteth-loan', label: 'wstETH / GHO', suppliedUsd: 10000, debtUsd: 5000, healthFactor: 1.6, risk: 'lower' as const, notes: [], assets: [
    { symbol: 'wstETH', address: wsteth, supplied: 5, borrowed: 0, priceUsd: 2000, collateral: true, liquidationThreshold: .8, liquidationPriceUsd: null, supplyRate: { apr: 0, note: 'Protocol APR' }, intrinsicSupplyRate: { apr: .0234, estimated: true, note: 'Lido seven-day average net staking APR.', source: { chain: 'Ethereum' as const, oracle: '', kind: 'lido' as const, label: 'Lido stETH/wstETH staking APR (7-day average)', url: 'https://lido.fi/', windowDays: 7, startTimestamp: 1794313319, endTimestamp: 1794831719 } } },
    { symbol: 'GHO', address: '0x1111111111111111111111111111111111111111', supplied: 0, borrowed: 5000, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, borrowRate: { apr: .04, note: 'Borrow APR' } },
  ] };
  const fixture = { ...structuredClone(example), wallets: [], protocols: [{ id: 'aave-v4', name: 'Aave v4', status: 'ok', coverage: 'wstETH loan', positions: [position] }] };
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('.position');
  await expect(card.getByText('Lido staking APR: 2.34%', { exact: true })).toBeVisible();
  await expect(card.locator('tbody tr').first().locator('.asset-rate')).toContainText('2.34%');
  await expect(card.locator('tbody tr').first().getByText('≈ $19.50 / month', { exact: true })).toBeVisible();
  await expect(card.locator('.position-monthly-npl strong')).toHaveText('≈ $2.83');
  await expect(card.locator('.position-net-apr strong')).toHaveText('≈ 0.68%');
  await expect(page.locator('.total-npl strong')).toHaveText('≈ $2.83');
  await expect(page.locator('.portfolio-apr strong')).toHaveText('≈ 0.68%');
  await card.getByText('Intrinsic yield details', { exact: true }).click();
  await expect(card.getByRole('link', { name: 'View Lido staking APR ↗' })).toHaveAttribute('href', 'https://lido.fi/');
  await expect(card.getByText(/Rate observations:/)).toBeVisible();
  await expect(card.getByText(/Oracle observations:/)).toHaveCount(0);
});

test('groups wallet income tokens first, weights category APR and includes wallet earnings once in address NPL', async ({ page }) => {
  const fixture = structuredClone(example); fixture.protocols = [];
  const source = { chain: 'Ethereum' as const, oracle: '', label: 'Verified intrinsic rate' };
  fixture.wallets = [
    { chain: 'Ethereum', status: 'ok', pricedValueUsd: 6000, unpricedCount: 0, coverage: 'Wallet', interestDiscoveryComplete: true, tokens: [
      { address: '0x1111111111111111111111111111111111111111', symbol: 'sUSDai', category: 'Savings stablecoin', balance: 1000, priceUsd: 1, valueUsd: 1000, intrinsicSupplyRate: { apr: .12, note: 'Same verified 30-day oracle rate as lending', estimated: true, source } },
      { address: '0x2222222222222222222222222222222222222222', symbol: 'reUSD', category: 'Savings stablecoin', balance: 3000, priceUsd: 1, valueUsd: 3000, intrinsicSupplyRate: { apr: .04, note: 'Verified intrinsic APR', estimated: true, source } },
      { address: '0x3333333333333333333333333333333333333333', symbol: 'wstETH', category: 'Other', interestBearing: true, balance: 1, priceUsd: 1000, valueUsd: 1000, intrinsicSupplyRate: { apr: .024, note: 'Lido APR', estimated: true, source: { ...source, kind: 'lido' } } },
      { address: 'native', symbol: 'ETH', balance: 1, priceUsd: 1000, valueUsd: 1000 },
    ] },
    { chain: 'Plasma', status: 'ok', pricedValueUsd: 1000, unpricedCount: 0, coverage: 'Wallet', interestDiscoveryComplete: true, tokens: [
      { address: '0x4444444444444444444444444444444444444444', symbol: 'PT-USDC', interestBearing: true, balance: 1000, priceUsd: 1, valueUsd: 1000, intrinsicSupplyRate: { apr: .06, note: 'Pendle Implied APY used as APR', estimated: true, source: { ...source, kind: 'pendle', url: 'https://app.pendle.finance/' } } },
    ] },
  ];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const section = page.getByRole('region', { name: 'Interest bearing tokens', exact: true });
  await expect(page.locator('.wallet-category>h3')).toHaveText(['Interest bearing tokens', 'Other tokens']);
  await expect(section.locator('.wallet-category-stats strong')).toHaveText(['$6,000.00', '≈ 5.40%', '≈ $27.00 / month']);
  await expect(section.locator('.wallet-network').first().locator('tbody td:first-child strong')).toHaveText(['reUSD', 'sUSDai', 'wstETH']);
  await expect(page.getByRole('region', { name: 'Other tokens', exact: true }).locator('tbody td:first-child strong')).toHaveText(['ETH']);
  await expect(page.locator('.summary.primary strong')).toHaveText('$7,000.00');
  await expect(page.locator('.total-npl strong')).toHaveText('≈ $27.00');
  await expect(page.locator('.portfolio-apr strong')).toHaveText('≈ 4.63%');
  await page.getByRole('button', { name: /Refresh/ }).click();
  await expect(page.locator('.total-npl strong')).toHaveText('≈ $27.00');
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/defimon-wallet-income-mobile.png', fullPage: true });
});

test('shows unknown wallet yield instead of inventing a zero APR or a complete address NPL', async ({ page }) => {
  const fixture = structuredClone(example); fixture.protocols = [];
  fixture.wallets = [{ chain: 'Ethereum', status: 'ok', pricedValueUsd: 1000, unpricedCount: 0, coverage: 'Wallet', interestDiscoveryComplete: true, tokens: [{ address: '0x1111111111111111111111111111111111111111', symbol: 'sUSDai', category: 'Savings stablecoin', balance: 1000, priceUsd: 1, valueUsd: 1000 }] }];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.locator('.total-npl strong')).toHaveText('Unavailable'); await expect(page.locator('.portfolio-apr strong')).toHaveText('Unavailable');
  await expect(page.getByRole('region', { name: 'Missing interest data' })).toContainText('intrinsic APR unavailable');
  await expect(page.getByRole('region', { name: 'Interest bearing tokens', exact: true }).locator('.wallet-category-stats strong').last()).toHaveText('Unavailable');
});

test('shows Spark savings as a deposit with NPL and supply recommendations', async ({ page }) => {
  const fixture = structuredClone(example);
  fixture.protocols = [{ id: 'spark', name: 'Spark', chain: 'Arbitrum', status: 'ok', coverage: 'Spark savings; no Spark borrowing market on Arbitrum.', balanceDiscoveryComplete: true, positions: [{ id: 'spark-vault-test', label: 'Spark savings · spUSDT', marketAddress: '0x45d91340B3B7B96985A72b5c678F7D9e8D664b62', receiptTokens: ['0x45d91340B3B7B96985A72b5c678F7D9e8D664b62'], depositOnly: true, suppliedUsd: 1200, debtUsd: 0, healthFactor: null, risk: 'no-debt', assets: [{ symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', supplied: 1200, borrowed: 0, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, supplyRate: { apr: .06, note: 'Verified Spark APR' } }], notes: [] }] }];
  fixture.wallets = [];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/recommendations', route => route.fulfill({ json: { targetIds: route.request().postDataJSON().targets.map((t: any) => t.id), checkedAt: new Date().toISOString(), alternatives: [], coverage: [] } }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const spark = page.locator('article.protocol.spark');
  await expect(spark.getByRole('heading', { name: 'Spark · Arbitrum' })).toBeVisible();
  await expect(spark.locator('.vault-stats')).toContainText('$1,200.00');
  await expect(spark.locator('.vault-stats')).toContainText('6.00%');
  await expect(spark.locator('.vault-stats')).toContainText('$6.00');
  await expect(spark.getByRole('columnheader', { name: 'Borrowed', exact: true })).toHaveCount(0);
  await expect(spark.getByRole('link', { name: 'Spark savings · spUSDT' })).toHaveAttribute('href', 'https://app.spark.finance/savings');
  await expect(page.locator('.total-npl > strong')).toContainText('$6.00');
  await page.getByRole('button', { name: 'Recommendations', exact: true }).click();
  await expect(page.locator('.recommendations')).toContainText('Spark');
  await expect(page.locator('.recommendations')).toContainText('USDT');
});

test('Cookbook renders JSON snapshots with wallet and time, refreshes without duplicates, and leaves wallet totals unchanged', async ({ page }) => {
  const { emptyCookbook, updateCookbook } = await import('../src/cookbook');
  const { snapshot } = await import('../tests/fixtures/cookbook');
  let saved = updateCookbook(emptyCookbook(), snapshot(.3)); let recommendationSearches = 0;
  await page.route('**/api/cookbook', route => route.fulfill({ json: { data: saved, persistence: { mode: 'local', synced: false, message: 'Automatic saving to GitHub is not configured. New snapshots are saved locally.' } } }));
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: example }));
  await page.route('**/api/rewards/*', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/recommendations', route => { recommendationSearches++; return route.fulfill({ json: { alternatives: [], coverage: [] } }); });
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const net = await page.locator('.summary.primary strong').textContent(), npl = await page.locator('.total-npl > strong').textContent();
  const nav = page.getByRole('navigation', { name: 'Dashboard sections' });
  await nav.getByRole('button', { name: 'Cookbook', exact: true }).click();
  const cookbook = page.getByRole('region', { name: 'Cookbook', exact: true });
  await expect(cookbook.locator('.cookbook-entry')).toHaveCount(1);
  await expect(cookbook.locator('.cookbook-summary strong')).toHaveText(['1', '1', '1', '$500.00', '30.00%', '14%']);
  await expect(cookbook.locator('.cookbook-wallet')).toHaveText(/0x1111111111111111111111111111111111111111/);
  await expect(cookbook.locator('time')).toHaveAttribute('datetime', '2026-11-20T10:00:00.000Z');
  await expect(cookbook.locator('.cookbook-apr')).toHaveText('30.00% APR');
  await expect(cookbook.locator('.cookbook-persistence')).toContainText('saved locally');
  saved = updateCookbook(saved, snapshot(.4, '2026-11-20T11:00:00.000Z'));
  await cookbook.getByRole('button', { name: 'Reload snapshots' }).click();
  await expect(cookbook.locator('.cookbook-entry')).toHaveCount(1);
  await expect(cookbook.locator('.cookbook-apr')).toHaveText('40.00% APR');
  await expect(cookbook.locator('.cookbook-summary strong')).toHaveText(['1', '1', '1', '$500.00', '40.00%', '14%']);
  await expect(cookbook.locator('time')).toHaveAttribute('datetime', '2026-11-20T11:00:00.000Z');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/defimon-cookbook-mobile.png', fullPage: true });
  saved = updateCookbook(saved, snapshot(.1, '2026-11-20T12:00:00.000Z'));
  await cookbook.getByRole('button', { name: 'Reload snapshots' }).click();
  await expect(cookbook.locator('.cookbook-entry')).toHaveCount(0);
  await expect(cookbook.locator('.cookbook-summary strong')).toHaveText(['0', '0', '0', '$0.00', '—', '14%']);
  await expect(cookbook).toContainText('No saved positions currently meet');
  await nav.getByRole('button', { name: 'Wallet Overview', exact: true }).click();
  await expect(page.locator('.summary.primary strong')).toHaveText(net!); await expect(page.locator('.total-npl > strong')).toHaveText(npl!);
  expect(recommendationSearches).toBe(0);
});

test('Cookbook works without a wallet lookup and falls back to the GitHub JSON when the API is down', async ({ page }) => {
  const { emptyCookbook, updateCookbook } = await import('../src/cookbook');
  const { snapshot } = await import('../tests/fixtures/cookbook');
  const saved = updateCookbook(emptyCookbook(), snapshot(.2));
  await page.route('**/api/cookbook', route => route.fulfill({ status: 503, json: {} }));
  await page.route('https://raw.githubusercontent.com/Sberex/DeFiMon/main/analysis/cookbook.json', route => route.fulfill({ json: saved }));
  await page.goto('/'); await page.getByRole('button', { name: 'Cookbook', exact: true }).click();
  const cookbook = page.getByRole('region', { name: 'Cookbook', exact: true });
  await expect(cookbook.locator('.cookbook-entry')).toHaveCount(1);
  await expect(cookbook.locator('.cookbook-persistence')).toContainText('Showing snapshots saved in the GitHub JSON file');
});

test('collapses tokens below one cent in both wallet categories without changing value or income totals', async ({ page }) => {
  const fixture = structuredClone(example); fixture.protocols = [];
  const source = { chain: 'Ethereum' as const, oracle: '', kind: 'erc4626' as const, label: 'Test rate' };
  const token = (n: number, symbol: string, valueUsd: number, interest: boolean, apr = .12) => ({ address: `0x${n.toString(16).padStart(40, '0')}`, symbol, balance: valueUsd, priceUsd: 1, valueUsd, category: interest ? 'Savings stablecoin' as const : 'Other' as const, ...(interest ? { intrinsicSupplyRate: { apr, note: 'Test intrinsic APR', source } } : {}) });
  fixture.wallets = [{ chain: 'Ethereum', status: 'ok', pricedValueUsd: 101.0349, unpricedCount: 0, coverage: 'Wallet', interestDiscoveryComplete: true, tokens: [
    token(1, 'YIELD_BIG', 100, true), token(2, 'YIELD_CENT', .01, true), token(3, 'YIELD_TINY', .0099, true, 12), token(4, 'YIELD_ZERO', 0, true),
    token(5, 'OTHER_BIG', 1, false), token(6, 'OTHER_CENT', .01, false), token(7, 'OTHER_TINY', .005, false), token(8, 'OTHER_ZERO', 0, false),
  ] }];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/rewards/*', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const interest = page.getByRole('region', { name: 'Interest bearing tokens', exact: true }), other = page.getByRole('region', { name: 'Other tokens', exact: true });
  await expect(interest.locator('.wallet-network > .position tbody td:first-child strong')).toHaveText(['YIELD_BIG', 'YIELD_CENT']);
  await expect(other.locator('.wallet-network > .position tbody td:first-child strong')).toHaveText(['OTHER_BIG', 'OTHER_CENT']);
  await expect(interest.locator('.wallet-category-stats strong').first()).toHaveText('$100.02');
  await expect(page.locator('.summary.primary strong')).toHaveText('$101.03');
  await expect(page.locator('.total-npl > strong')).toHaveText('≈ $1.01');
  const stats = await interest.locator('.wallet-category-stats').textContent(), apr = await page.locator('.portfolio-apr > strong').textContent();
  for (const [section, tiny, zero] of [[interest, 'YIELD_TINY', 'YIELD_ZERO'], [other, 'OTHER_TINY', 'OTHER_ZERO']] as const) {
    const collapsed = section.locator('.small-wallet-tokens');
    await expect(collapsed).not.toHaveAttribute('open');
    await expect(collapsed.locator(':scope > summary')).toHaveText('Tokens below $0.01 (2)');
    await expect(collapsed.getByText(tiny, { exact: true })).toBeHidden();
    await collapsed.locator(':scope > summary').click();
    await expect(collapsed.locator('tbody td:first-child strong')).toHaveText([tiny, zero]);
  }
  await expect(page.locator('.summary.primary strong')).toHaveText('$101.03');
  await expect(page.locator('.total-npl > strong')).toHaveText('≈ $1.01');
  await expect(interest.locator('.wallet-category-stats')).toHaveText(stats!);
  await expect(page.locator('.portfolio-apr > strong')).toHaveText(apr!);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('keeps unpriced wallet tokens visible rather than treating unknown USD values as dust', async ({ page }) => {
  const fixture = structuredClone(example); fixture.protocols = [];
  fixture.wallets = [{ chain: 'Arbitrum', status: 'partial', pricedValueUsd: .001, unpricedCount: 2, coverage: 'Wallet', tokens: [
    { address: '0x1111111111111111111111111111111111111111', symbol: 'UNKNOWN_YIELD', category: 'Savings stablecoin', balance: 1, priceUsd: null, valueUsd: null },
    { address: '0x2222222222222222222222222222222222222222', symbol: 'UNKNOWN_OTHER', balance: 1, priceUsd: null, valueUsd: null },
    { address: '0x3333333333333333333333333333333333333333', symbol: 'SMALL_OTHER', balance: .001, priceUsd: 1, valueUsd: .001 },
  ] }];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/rewards/*', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.getByText('UNKNOWN_YIELD', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('UNKNOWN_OTHER', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('SMALL_OTHER', { exact: true })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Interest bearing tokens', exact: true }).locator('.small-wallet-tokens')).toHaveCount(0);
});


test('Cookbook summary totals positions across wallets and counts each source address once', async ({ page }) => {
  const { emptyCookbook, updateCookbook } = await import('../src/cookbook');
  const { snapshot } = await import('../tests/fixtures/cookbook');
  const first = snapshot(.3), secondPosition = snapshot(.2).protocols[0].positions[0];
  secondPosition.id = 'second-loan'; first.protocols[0].positions.push(secondPosition);
  const otherAddress = '0x4444444444444444444444444444444444444444';
  let saved = updateCookbook(updateCookbook(emptyCookbook(), first), snapshot(.5, first.updatedAt, otherAddress));
  await page.route('**/api/cookbook', route => route.fulfill({ json: { data: saved, persistence: { mode: 'github', synced: true } } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Cookbook', exact: true }).click();
  const cookbook = page.getByRole('region', { name: 'Cookbook', exact: true });
  const summary = cookbook.getByRole('region', { name: 'Cookbook summary', exact: true });
  await expect(summary.locator('.summary > span')).toHaveText(['Number of positions', 'Number of collateral assets', 'Number of addresses', 'Total Net Value', 'Highest APR', 'Threshold minimum APR']);
  await expect(summary.locator('strong')).toHaveText(['3', '1', '2', '$1,500.00', '50.00%', '14%']);
  await summary.screenshot({ path: '/tmp/defimon-cookbook-summary-desktop.png' });
  saved = updateCookbook(saved, snapshot(.25, '2026-11-20T11:00:00.000Z'));
  await cookbook.getByRole('button', { name: 'Reload snapshots' }).click();
  await expect(summary.locator('strong')).toHaveText(['2', '1', '2', '$1,000.00', '50.00%', '14%']);
  const closed = snapshot(.5, '2026-11-20T12:00:00.000Z', otherAddress); closed.protocols[0].positions = [];
  saved = updateCookbook(saved, closed);
  await cookbook.getByRole('button', { name: 'Reload snapshots' }).click();
  await expect(summary.locator('strong')).toHaveText(['1', '1', '1', '$500.00', '25.00%', '14%']);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await summary.screenshot({ path: '/tmp/defimon-cookbook-summary-mobile.png' });
});

test('shows Binance Smart Chain balances, monthly NPL, BscScan links and BSC alternatives', async ({ page }) => {
  const fixture = structuredClone(example);
  fixture.chain = 'Binance Smart Chain';
  const position = structuredClone(fixture.protocols[0].positions[0]);
  Object.assign(position, { id: 'bsc-aave', marketAddress: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB', label: 'Binance Smart Chain main market', suppliedUsd: 6000, debtUsd: 1000, healthFactor: 4.8, risk: 'lower' });
  position.assets = [
    { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB', supplied: 2, borrowed: 0, priceUsd: 3000, collateral: true, liquidationThreshold: .8, liquidationPriceUsd: 625, supplyRate: { apr: .02, note: 'Current Binance Smart Chain supply APR' } },
    { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', supplied: 0, borrowed: 1000, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, borrowRate: { apr: .06, note: 'Current Binance Smart Chain borrow APR' } },
  ];
  fixture.protocols = [{ id: 'aave-v3', name: 'Aave v3', chain: 'Binance Smart Chain', status: 'ok', coverage: 'Binance Smart Chain main market', positions: [position] }];
  fixture.wallets = [{ chain: 'Binance Smart Chain', status: 'ok', pricedValueUsd: 300, unpricedCount: 0, coverage: 'Binance Smart Chain wallet tokens', tokens: [{ address: 'native', symbol: 'BNB', balance: .1, priceUsd: 3000, valueUsd: 300 }] }];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/recommendations', route => {
    const { targets } = route.request().postDataJSON();
    expect(targets[0].network).toBe('bsc');
    return route.fulfill({ json: { checkedAt: new Date().toISOString(), coverage: [{ protocol: 'Euler', network: 'bsc', status: 'ok' }], alternatives: [{ targetId: targets[0].id, protocol: 'Euler', network: 'bsc', market: '0x9999999999999999999999999999999999999999', label: 'Binance Smart Chain USDT vault', supplyApr: .02, borrowApr: .03, borrowApy: .0304545, lltv: .8, block: '56000', url: 'https://app.euler.finance/', note: 'Binance Smart Chain rate quote', liquidity: { amount: 500000, symbol: 'USDT', token: position.assets[1].address, note: 'Binance Smart Chain vault liquidity' } }] } });
  });
  await page.goto('/');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address);
  await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.locator('article.aave-v3[data-chain="Binance Smart Chain"] .position-monthly-npl strong')).toHaveText('≈ $5.00');
  await expect(page.locator('article.aave-v3[data-chain="Binance Smart Chain"] .position-net-apr strong')).toHaveText('≈ 1.20%');
  await expect(page.locator('.wallet-network[data-chain="Binance Smart Chain"]')).toContainText('BNB');
  await expect(page.locator('article.aave-v3 .position-market-links a')).toHaveAttribute('href', 'https://bscscan.com/address/0x6807dc923806fE8Fd134338EABCA509979a7e0cB');
  await expect(page.locator('.summary.primary strong')).toHaveText('$5,300.00');
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Recommendations', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Alternatives for WBNB - USDT', exact: true }).getByText('Euler · Binance Smart Chain', { exact: true })).toBeVisible();
  await expect(page.getByText('500,000 USDT', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('shows Lista DAO loans and Earn deposits across Ethereum and BSC with NPL, links and alternatives', async ({ page }) => {
  const fixture = structuredClone(example); fixture.wallets = [];
  const market = `0x${'1'.repeat(64)}`, vault = '0x6666666666666666666666666666666666666666';
  const loan = { ...fixture.protocols[0].positions[0], id: `lista-market-${market}`, label: 'Lista DAO Moolah · WETH / USDC', suppliedUsd: 600, debtUsd: 200, healthFactor: 2.4, risk: 'lower' as const, notes: ['Native Lista core valuation'], morphoMarket: { loanAsset: { address: '0x2222222222222222222222222222222222222222', symbol: 'USDC' }, collateralAsset: { address: '0x3333333333333333333333333333333333333333', symbol: 'WETH' }, supplyOnly: false }, assets: [
    { address: '0x3333333333333333333333333333333333333333', symbol: 'WETH', supplied: .2, borrowed: 0, priceUsd: 3000, collateral: true, liquidationThreshold: .8, liquidationPriceUsd: 1250, supplyRate: { apr: 0, note: 'Collateral earns no protocol lending yield.' } },
    { address: '0x2222222222222222222222222222222222222222', symbol: 'USDC', supplied: 0, borrowed: 200, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, borrowRate: { apr: .06, note: 'Current Lista borrow APR' } },
  ] };
  const deposit = { ...loan, id: `lista-vault-${vault}`, label: 'Lista DAO Earn · USDC', depositOnly: true, suppliedUsd: 500, debtUsd: 0, risk: 'no-debt' as const, healthFactor: null, morphoMarket: undefined, vault: { address: vault, version: 1 as const, roles: [], totalAssets: 100000, totalAssetsUsd: 100000 }, assets: [{ ...loan.assets[1], supplied: 500, borrowed: 0, borrowRate: undefined, supplyRate: { apr: .06, note: 'Allocation-weighted net vault APR' } }] };
  fixture.protocols = [{ id: 'lista', name: 'Lista DAO', chain: 'Ethereum', coverage: 'Lista Moolah lending', status: 'ok', positions: [loan] }, { id: 'lista', name: 'Lista DAO', chain: 'Binance Smart Chain', coverage: 'Lista Earn vaults', status: 'ok', positions: [deposit] }];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/recommendations', route => {
    const { targets } = route.request().postDataJSON();
    return route.fulfill({ json: { checkedAt: new Date().toISOString(), coverage: [{ protocol: 'Lista DAO', network: 'ethereum', status: 'ok' }], alternatives: targets.map((t: { id: string; borrowed?: string }) => ({ targetId: t.id, protocol: 'Lista DAO', network: 'ethereum', market: t.borrowed ? `0x${'9'.repeat(64)}` : '0x7777777777777777777777777777777777777777', label: t.borrowed ? 'Alternative Lista loan' : 'Alternative Lista Earn', supplyApr: t.borrowed ? 0 : .08, borrowApr: t.borrowed ? .03 : null, lltv: t.borrowed ? .8 : null, block: '123', url: 'https://lista.org/lending/earn', note: 'Verified current Lista rate', liquidity: t.borrowed ? { amount: 50000, symbol: 'USDC', token: t.borrowed, note: 'Market loan liquidity' } : null })) } });
  });
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.locator('.summary.primary strong')).toHaveText('$900.00');
  await expect(page.locator('.total-npl > strong')).toHaveText('≈ $1.50');
  await expect(page.locator('article.lista[data-chain="Ethereum"] .position-monthly-npl strong')).toHaveText('≈ -$1.00');
  await expect(page.locator('article.lista[data-chain="Binance Smart Chain"] .morpho-vault-position')).toHaveCount(1);
  await expect(page.locator('article.lista[data-chain="Binance Smart Chain"] .position-market-links a')).toHaveAttribute('href', `https://lista.org/lending/vault/bsc/${vault}`);
  await expect(page.locator('article.lista[data-chain="Ethereum"] .position-market-links a')).toHaveAttribute('href', `https://lista.org/lending/market/ethereum/${market}`);
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: 'Recommendations', exact: true }).click();
  await expect(page.getByText('Alternative Lista loan', { exact: false })).toBeVisible();
  await expect(page.getByText('Alternative Lista Earn', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('shows the Lista broker loan for the reported wallet while keeping unrelated unverified PT yield explicit', async ({ page }) => {
  const fixture = structuredClone(example); fixture.address = '0xc6dd9976066f3364b4d6a72cd4f1fa0468327aa7'; fixture.wallets = [];
  const market = '0x95f93825819b67a64610e6adb9ac5f70d5108f5121b9df6551e23a4a7a801b5b';
  const loan = { id: `lista-market-${market}`, label: 'Lista DAO Moolah · slisBNB / USD1', suppliedUsd: 86049.46, debtUsd: 49888.07, healthFactor: 1.483, risk: 'lower' as const, notes: ['Full broker debt verified at the snapshot block'], assets: [
    { address: '0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B', symbol: 'slisBNB', supplied: 144.95, borrowed: 0, priceUsd: 593.65, collateral: true, liquidationThreshold: .86, liquidationPriceUsd: 400, supplyRate: { apr: 0, note: 'No protocol collateral lending interest' } },
    { address: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d', symbol: 'USD1', supplied: 0, borrowed: 49943, priceUsd: .9989, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, borrowRate: { apr: .0299836, estimated: true, note: '3.00% fixed contract APR. Full broker debt includes accrued interest; current interest charges fixed principal only.' } },
  ] };
  const dust = { ...loan, id: 'lista-market-unverified-pt', label: 'Residual PT-sUSDE collateral', suppliedUsd: 1e-18, debtUsd: 0, healthFactor: null, risk: 'no-debt' as const, assets: [{ ...loan.assets[0], address: '0x7EB92A12a15E8a019A26A8b344F1e59b14cb8Ad3', symbol: 'PT-sUSDE-9APR2026-(PLASMA)', supplied: 1e-18, priceUsd: 1, supplyRate: { apr: null, note: 'Pendle PT yield is unverified.' } }] };
  fixture.protocols = [{ id: 'lista', name: 'Lista DAO', chain: 'Binance Smart Chain', status: 'ok', balanceDiscoveryComplete: true, coverage: 'Lista Moolah and LendingBroker', positions: [loan, dust] }];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/recommendations', route => route.fulfill({ json: { alternatives: [], coverage: [], checkedAt: new Date().toISOString() } }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(fixture.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.lista');
  await expect(card.getByRole('heading', { name: 'Lista DAO Moolah · slisBNB / USD1', exact: true })).toBeVisible();
  await expect(card.locator('.position').first().getByText('$49,888.07', { exact: true })).toBeVisible();
  await expect(card.locator('.position-monthly-npl').first()).not.toContainText('Unavailable');
  await expect(card.locator('.position-market-links a').first()).toHaveAttribute('href', `https://lista.org/lending/market/bsc/${market}`);
  await expect(page.getByText('Positions could not be fully checked.', { exact: false })).toHaveCount(0);
  await expect(page.locator('.total-npl > strong')).not.toHaveText('Unavailable');
  await expect(page.locator('.total-npl')).toContainText('partial');
});

test('shows 0% for an expired bridged Lista PT absent from Pendle catalog and calculates total NPL', async ({ page }) => {
  const { applyPtCollateralRates } = await import('../server/pendle-collateral');
  const fixture = structuredClone(example); fixture.chain = 'Binance Smart Chain'; fixture.wallets = [];
  const pt = '0x7EB92A12a15E8a019A26A8b344F1e59b14cb8Ad3', usd1 = '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d';
  const position = { ...fixture.protocols[0].positions[0], id: 'lista-market-0xc1264ae84203b5660478bba5cfe15d9f579aa98402fb073bff65c31040f12f1a', label: 'Lista DAO · expired PT-sUSDE / USD1', suppliedUsd: 1000, debtUsd: 500, healthFactor: 1.8, risk: 'lower' as const, assets: [
    { address: pt, symbol: 'PT-sUSDE-9APR2026-(PLASMA)', supplied: 1000, borrowed: 0, priceUsd: 1, collateral: true, liquidationThreshold: .9, liquidationPriceUsd: .56, supplyRate: { apr: null, note: 'Previously unavailable' } },
    { address: usd1, symbol: 'USD1', supplied: 0, borrowed: 500, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, borrowRate: { apr: .06, note: 'Current borrowing APR' } },
  ] };
  const client = { getBlock: async () => ({ timestamp: BigInt(Date.parse('2026-11-20T00:00:00Z') / 1000) }), readContract: async () => 1775692800n } as unknown as import('../server/rpc').ChainClient;
  fixture.protocols = await applyPtCollateralRates([{ id: 'lista', name: 'Lista DAO', chain: 'Binance Smart Chain', status: 'ok', balanceDiscoveryComplete: true, coverage: 'Lista Moolah', positions: [position] }], client, 'bsc', 123n, async () => []);
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/recommendations', route => route.fulfill({ json: { alternatives: [], coverage: [], checkedAt: new Date().toISOString() } }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.lista'), row = card.locator('tbody tr').filter({ hasText: 'PT-sUSDE-9APR2026-(PLASMA)' });
  await expect(row.locator('.asset-rate').first()).toHaveText(/^0\.00%/);
  await expect(page.locator('.total-npl > strong')).toHaveText('≈ -$2.50');
  await expect(page.locator('.portfolio-apr > strong')).toHaveText('≈ -6.00%');
  await expect(card.locator('.position-monthly-npl strong')).toHaveText('≈ -$2.50');
  await expect(page.getByText('Supply APR unavailable', { exact: false })).toHaveCount(0);
});

test('includes slisBNB native staking APR in collateral income and position and wallet NPL', async ({ page }) => {
  const { applySlisBnbRates, createSlisBnbRateService, SLISBNB, SLISBNB_MARKET } = await import('../server/slisbnb-rates');
  const fixture = structuredClone(example); fixture.wallets = [];
  fixture.protocols = [{ id: 'lista', name: 'Lista DAO', chain: 'Binance Smart Chain', status: 'ok', balanceDiscoveryComplete: true, coverage: 'Lista Moolah', positions: [{
    id: `lista-market-${SLISBNB_MARKET}`, label: 'Lista DAO Moolah · slisBNB / USD1', suppliedUsd: 85469.03, debtUsd: 49887.23, healthFactor: 1.47, risk: 'lower', notes: [], assets: [
      { address: SLISBNB, symbol: 'slisBNB', supplied: 144.95, borrowed: 0, priceUsd: 85469.03 / 144.95, collateral: true, liquidationThreshold: .86, liquidationPriceUsd: 400.2, supplyRate: { apr: 0, note: 'No protocol lending interest' } },
      { address: '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d', symbol: 'USD1', supplied: 0, borrowed: 49887.23, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, borrowRate: { apr: .03, note: 'Borrow APR' } },
    ],
  }] }];
  fixture.protocols = await applySlisBnbRates(fixture.protocols, 'bsc', createSlisBnbRateService((async () => Response.json({ code: '000000000', timestamp: Date.now(), data: { marketId: SLISBNB_MARKET, chain: 'bsc', collateralToken: SLISBNB, collateralNativeApy: '0.01519' } })) as any));
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/recommendations', route => route.fulfill({ json: { alternatives: [], coverage: [], checkedAt: new Date().toISOString() } }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill('0xc6dd9976066f3364b4d6a72cd4f1fa0468327aa7'); await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.lista'), collateral = card.locator('tr').filter({ hasText: 'slisBNB staking APR' });
  await expect(collateral).toContainText('1.52%');
  await expect(collateral).toContainText('$108.19');
  await expect(card.locator('.position-monthly-npl')).toContainText('-$16.53');
  await expect(page.locator('.total-npl > strong')).toContainText('-$16.53');
  await expect(card.locator('.position')).toContainText('-0.56%');
  await collateral.getByText('Intrinsic yield details', { exact: true }).click();
  await expect(collateral.getByRole('link', { name: 'View Lista slisBNB staking APR' })).toHaveAttribute('href', 'https://lista.org/liquid-staking/BNB');
});

test('restores address NPL and APR with verified mHYPER growth and non-yield iUSD stablecoin', async ({ page }) => {
  const fixture = structuredClone(example); fixture.protocols = []; fixture.address = '0xE16BE042f9433779909a972669bE3A2003956348';
  const mhApr = (1.14224794 - 1.13482542) * 365 / (30 * 1.13482542);
  fixture.wallets = [{ chain: 'Ethereum', status: 'ok', pricedValueUsd: 4.404902455456117, unpricedCount: 0, interestDiscoveryComplete: true, coverage: 'Wallet', tokens: [
    { address: '0x9b5528528656dbc094765e2abb79f293c21191b9', symbol: 'mHYPER', category: 'Savings stablecoin', interestBearing: true, balance: 3.8540620944124493, priceUsd: 1.14224794, valueUsd: 4.402294487974706, intrinsicSupplyRate: { apr: mhApr, estimated: true, note: 'Verified 30-day NAV oracle growth', source: { chain: 'Ethereum', kind: 'chainlink', oracle: '0x43881B05C3BE68B2d33eb70aDdF9F666C5005f68', label: 'Midas mHYPER/USD native NAV oracle', startTimestamp: 1792587371, endTimestamp: 1795179371, startRate: 1.13482542, endRate: 1.14224794, windowDays: 30 } } },
    { address: '0x48f9e38f3070ad8945dfeae3fa70987722e3d89c', symbol: 'iUSD', category: 'Stablecoin', balance: .002610186822595611, priceUsd: .9991497385681763, valueUsd: .0026079674814105036 },
  ] }];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(fixture.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const section = page.getByRole('region', { name: 'Interest bearing tokens', exact: true });
  await expect(section.locator('tbody tr').filter({ hasText: 'mHYPER' }).first()).toContainText('7.96%');
  await expect(page.locator('.total-npl strong')).toHaveText('≈ $0.03');
  await expect(page.locator('.portfolio-apr strong')).toHaveText('≈ 7.95%');
  await expect(page.getByRole('region', { name: 'Missing interest data' })).toHaveCount(0);
  const other = page.getByRole('region', { name: 'Other tokens', exact: true });
  await other.locator('details').filter({ has: page.locator('summary', { hasText: /\$0.01/ }) }).locator('summary').first().click();
  await expect(other.locator('tbody tr').filter({ hasText: 'iUSD' }).first()).toContainText('Stablecoin');
  await expect(section.getByText('iUSD', { exact: true })).toHaveCount(0);
});

test('restores saved collateral assumptions and saves only on Calculate across checks, edits and wallet changes', async ({ page }) => {
  const fixture = structuredClone(example);
  const address = fixture.address.toLowerCase(), btc = '0x1111111111111111111111111111111111111111', usdt = '0x2222222222222222222222222222222222222222';
  const secondWallet = '0x3333333333333333333333333333333333333333';
  const protocol = fixture.protocols.find(p => p.id === 'aave-v3')!; fixture.protocols = [protocol];
  const p = protocol.positions[0]; p.debtUsd = 30000; p.suppliedUsd = 70000; p.healthFactor = 1.8;
  const eth = p.assets[0]; eth.liquidationThreshold = .8;
  p.assets.push({ ...eth, address: btc, symbol: 'WBTC', supplied: .5, priceUsd: 50000, liquidationThreshold: .75 });
  p.assets.push({ ...eth, address: usdt, symbol: 'USDT', supplied: 15000, priceUsd: 1, liquidationThreshold: .9 });
  const entries: Record<string, any> = { [address]: { address, lastCheckedAt: '2026-11-21T10:00:00.000Z', manualLiquidationPrices: [
    { network: 'ethereum', protocol: 'aave-v3', positionId: p.id, updatedAt: '2026-11-21T09:00:00.000Z', pricesUsd: { [btc]: 30000, [usdt]: .8 } },
    { network: 'arbitrum', protocol: 'aave-v3', positionId: p.id, updatedAt: '2026-11-21T10:00:00.000Z', pricesUsd: { [btc]: 40000, [usdt]: .9 } },
  ] } };
  let writes = 0, fail = false, debtUsd = 30000;
  await page.route('**/api/portfolio/*', route => {
    const wallet = new URL(route.request().url()).pathname.split('/').at(-1)!.toLowerCase();
    const current = structuredClone(fixture); current.protocols[0].positions[0].debtUsd = debtUsd;
    return route.fulfill({ json: { ...current, address: wallet, walletHistory: { wallet: entries[wallet] ?? { address: wallet, lastCheckedAt: '2026-11-21T10:00:00.000Z', manualLiquidationPrices: [] }, persistence: { mode: 'github', synced: true } } } });
  });
  await page.route('**/api/wallet-history/*/liquidation-prices', route => {
    writes++;
    if (fail) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    const wallet = new URL(route.request().url()).pathname.split('/').at(-2)!.toLowerCase();
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({ network: 'ethereum', protocol: 'aave-v3', positionId: p.id });
    expect(input.pricesUsd).not.toHaveProperty(eth.address.toLowerCase());
    const entry = entries[wallet]; entry.manualLiquidationPrices[0] = { ...input, updatedAt: '2026-11-21T11:00:00.000Z' };
    return route.fulfill({ json: { wallet: entry, persistence: { mode: 'github', synced: true } } });
  });
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(fixture.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const card = page.locator('article.aave-v3');
  await expect(card.getByLabel('WBTC liquidation price (USD)')).toHaveValue('30000');
  await expect(card.getByLabel('USDT liquidation price (USD)')).toHaveValue('0.8');
  await expect(card.locator('.calculated-price strong')).toHaveText('$993.75'); expect(writes).toBe(0);
  await card.getByLabel('USDT liquidation price (USD)').fill('0'); expect(writes).toBe(0);
  await expect(card.locator('.calculated-price strong')).toHaveText('—');
  await card.getByRole('button', { name: 'Calculate', exact: true }).click();
  await expect(card.locator('.liquidation-save-message')).toHaveText('Collateral price assumptions saved.');
  expect(writes).toBe(1); expect(entries[address].manualLiquidationPrices[0].pricesUsd[usdt]).toBe(0);
  await expect(card.locator('.calculated-price strong')).toHaveText('$2,343.75');
  debtUsd = 32000;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(card.getByLabel('USDT liquidation price (USD)')).toHaveValue('0');
  await expect(card.locator('.calculated-price strong')).toHaveText('$2,593.75'); expect(writes).toBe(1);
  await card.getByLabel('USDT liquidation price (USD)').fill('invalid'); await card.getByRole('button', { name: 'Calculate', exact: true }).click(); expect(writes).toBe(1);
  await card.getByLabel('USDT liquidation price (USD)').fill('0.7'); fail = true;
  await card.getByRole('button', { name: 'Calculate', exact: true }).click();
  await expect(card.locator('.liquidation-save-message')).toContainText('could not be saved');
  await expect(card.locator('.calculated-price strong')).not.toHaveText('—');
  await page.getByLabel('Wallet address', { exact: true }).fill(secondWallet); await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(card.getByLabel('USDT liquidation price (USD)')).toHaveValue('');
  await expect(card.getByLabel('WBTC liquidation price (USD)')).toHaveValue('');
  await expect(card.locator('.calculated-price strong')).toHaveText('—');
  entries[secondWallet] = { address: secondWallet, lastCheckedAt: '2026-11-21T12:00:00.000Z', manualLiquidationPrices: [{ network: 'ethereum', protocol: 'aave-v3', positionId: p.id, updatedAt: '2026-11-21T12:00:00.000Z', pricesUsd: { [btc]: 30000 } }] };
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(card.getByLabel('WBTC liquidation price (USD)')).toHaveValue('30000');
  await expect(card.getByLabel('USDT liquidation price (USD)')).toHaveValue('');
  await expect(card.locator('.calculated-price strong')).toHaveText('—');
});

test('shows known partial NPL and APR during wallet and protocol failures and restores complete totals on refresh', async ({ page }) => {
  let complete = false;
  await page.route('**/api/portfolio/*', route => {
    const fixture = structuredClone(example), a = fixture.protocols[0].positions[0].assets[0];
    fixture.protocols = [{ id: 'aave-v3', name: 'Aave v3', chain: 'Ethereum', status: 'ok', coverage: 'Main market', positions: [{ id: 'partial-test', label: 'USDC loan', suppliedUsd: 10000, debtUsd: 4000, healthFactor: 2, risk: 'lower', notes: [], assets: [{ ...a, symbol: 'USDC', supplied: 10000, borrowed: 4000, priceUsd: 1, collateral: true, liquidationThreshold: .8, supplyRate: { apr: .012, note: '' }, borrowRate: { apr: .06, note: '' } }] }] }, { id: 'morpho', name: 'Morpho', chain: 'Arbitrum', status: complete ? 'ok' : 'error', coverage: '', positions: [] }];
    fixture.wallets = [{ chain: 'Ethereum', status: complete ? 'ok' : 'partial', pricedValueUsd: 3000, unpricedCount: 0, coverage: 'Wallet', interestDiscoveryComplete: complete, tokens: [
      { address: '0x1111111111111111111111111111111111111111', symbol: 'Known saving', category: 'Savings stablecoin', balance: 2000, valueUsd: 2000, priceUsd: 1, intrinsicSupplyRate: { apr: .12, note: '', source: { chain: 'Ethereum', oracle: '' } } },
      { address: '0x2222222222222222222222222222222222222222', symbol: 'Unknown saving', category: 'Savings stablecoin', balance: 1000, valueUsd: 1000, priceUsd: 1, intrinsicSupplyRate: { apr: complete ? .06 : null, note: '', source: { chain: 'Ethereum', oracle: '' } } },
    ] }];
    return route.fulfill({ json: fixture });
  });
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  await expect(page.locator('.summary.primary > strong')).toHaveText('$9,000.00');
  await expect(page.locator('.total-npl > strong')).toHaveText('≈ $10.00');
  await expect(page.locator('.portfolio-apr > strong')).toHaveText('≈ 1.33%');
  await expect(page.locator('.total-npl > span')).toHaveText('Total NPL · partial');
  await expect(page.locator('.portfolio-apr > span')).toHaveText('Portfolio APR · partial');
  const issues = page.getByRole('region', { name: 'Missing interest data' });
  await expect(issues).toContainText('Wallet tokens'); await expect(issues).toContainText('Unknown saving'); await expect(issues).toContainText('Morpho · Arbitrum');
  await expect(issues).toContainText('Unknown balances, rates, prices and unreadable holdings are excluded');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  complete = true; await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('.total-npl > strong')).toHaveText('≈ $15.00');
  await expect(page.locator('.portfolio-apr > strong')).toHaveText('≈ 2.00%');
  await expect(page.locator('.total-npl > span')).toHaveText('Total NPL');
  await expect(issues).toHaveCount(0);
});

test('Cookbook lists supplied assets below its summary with intrinsic and PT rates, refreshing the list with snapshots', async ({ page }) => {
  const { emptyCookbook, updateCookbook } = await import('../src/cookbook');
  const { snapshot } = await import('../tests/fixtures/cookbook');
  const fixture = snapshot(.3), position = fixture.protocols[0].positions[0];
  position.assets[0].symbol = 'Savings';
  position.assets[0].intrinsicSupplyRate = { apr: .08, note: '', source: { chain: 'Ethereum', oracle: '' } };
  position.assets.push({ ...position.assets[0], address: '0x5555555555555555555555555555555555555555', symbol: 'PT-Test', intrinsicSupplyRate: undefined, supplyRate: { apr: .15, note: '', pendlePt: { network: 'ethereum', marketAddress: null, expiry: null, updatedAt: null } } });
  position.assets.push({ ...position.assets[0], address: '0x6666666666666666666666666666666666666666', symbol: 'Plain', intrinsicSupplyRate: undefined });
  let saved = updateCookbook(emptyCookbook(), fixture);
  await page.route('**/api/cookbook', route => route.fulfill({ json: { data: saved, persistence: { mode: 'github', synced: true } } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Cookbook', exact: true }).click();
  const cookbook = page.getByRole('region', { name: 'Cookbook', exact: true });
  const assets = cookbook.getByRole('region', { name: 'Cookbook supplied assets', exact: true });
  await expect(assets.locator('tbody tr')).toHaveCount(3);
  await expect(assets.locator('tbody tr').filter({ hasText: 'Savings' }).locator('td').last()).toHaveText('8.00%');
  await expect(assets.locator('tbody tr').filter({ hasText: 'PT-Test' }).locator('td').last()).toHaveText('15.00%');
  await expect(assets.locator('tbody tr').filter({ hasText: 'Plain' }).locator('td').last()).toHaveText('0%');
  await expect(assets.getByRole('link').first()).toHaveAttribute('href', /etherscan.io\/token\/0x/);
  const count = cookbook.getByRole('region', { name: 'Cookbook summary' }).locator('.summary').filter({ hasText: 'Number of collateral assets' });
  await expect(count.locator('strong')).toHaveText('3');
  expect((await assets.boundingBox())!.y).toBeGreaterThan((await cookbook.getByRole('region', { name: 'Cookbook summary' }).boundingBox())!.y);
  await assets.screenshot({ path: '/tmp/cookbook-assets-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await assets.screenshot({ path: '/tmp/cookbook-assets-mobile.png' });
  fixture.updatedAt = '2026-11-20T12:00:00.000Z'; fixture.protocols[0].positions = [];
  saved = updateCookbook(saved, fixture);
  await cookbook.getByRole('button', { name: 'Reload snapshots' }).click();
  await expect(assets.locator('tbody tr')).toHaveCount(0);
  await expect(assets).toContainText('No supplied assets');
  await expect(count.locator('strong')).toHaveText('0');
});

test('Cookbook counts configured cross-chain collateral once, expands used networks, and sorts by intrinsic APR', async ({ page }) => {
  const { emptyCookbook, updateCookbook } = await import('../src/cookbook');
  const { snapshot } = await import('../tests/fixtures/cookbook');
  const first = snapshot(.3), arb = snapshot(.3, '2026-11-20T11:00:00.000Z', '0x4444444444444444444444444444444444444444'), plasma = snapshot(.3, '2026-11-20T09:00:00.000Z');
  arb.chain = 'Arbitrum'; plasma.chain = 'Plasma';
  for (const [portfolio, chain, rate] of [[first, 'Ethereum', .08], [arb, 'Arbitrum', .082], [plasma, 'Plasma', .079]] as const) {
    const asset = portfolio.protocols[0].positions[0].assets[0];
    Object.assign(asset, { address: '0x0B2b2B2076d95dda7817e785989fE353fe955ef9', symbol: 'sUSDai', intrinsicSupplyRate: { apr: rate, note: '', source: { chain, oracle: '' } } });
  }
  const collateral = first.protocols[0].positions[0].assets[0];
  first.protocols[0].positions[0].assets.push({ ...collateral, address: '0x5555555555555555555555555555555555555555', symbol: 'Higher yield', intrinsicSupplyRate: { apr: .15, note: '', source: { chain: 'Ethereum', oracle: '' } } });
  first.protocols[0].positions[0].assets.push({ ...collateral, address: '0x6666666666666666666666666666666666666666', symbol: 'Plain', intrinsicSupplyRate: undefined });
  let saved = updateCookbook(updateCookbook(updateCookbook(emptyCookbook(), first), arb), plasma);
  await page.route('**/api/cookbook', route => route.fulfill({ json: { data: saved, persistence: { mode: 'github', synced: true } } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Cookbook', exact: true }).click();
  const cookbook = page.getByRole('region', { name: 'Cookbook', exact: true });
  const assets = cookbook.getByRole('region', { name: 'Cookbook supplied assets', exact: true });
  await expect(assets.locator('tbody > tr > td:first-child > strong')).toHaveText(['Higher yield', 'sUSDai', 'Plain']);
  await expect(assets.locator('tbody > tr > td:last-child')).toHaveText(['15.00%', '8.20%', '0%']);
  const count = cookbook.getByRole('region', { name: 'Cookbook summary' }).locator('.summary').filter({ hasText: 'Number of collateral assets' }).locator('strong');
  await expect(count).toHaveText('3');
  const row = assets.locator('tbody > tr').filter({ has: page.locator('td:first-child > strong', { hasText: 'sUSDai' }) });
  await expect(row.locator('td').nth(1)).toHaveText('Arbitrum');
  const extra = row.locator('details');
  await expect(extra.locator('li').first()).toBeHidden();
  await extra.getByText('Additional networks (2)', { exact: true }).click();
  await expect(extra.locator('li')).toHaveCount(2);
  await expect(extra.locator('li').nth(0)).toContainText('Ethereum');
  await expect(extra.locator('li').nth(0)).toContainText('8.00%');
  await expect(extra.locator('li').nth(1)).toContainText('Plasma');
  await expect(extra.locator('li').nth(1)).toContainText('7.90%');
  await expect(extra.locator('a').nth(1)).toHaveAttribute('href', /plasmascan.to\/token\//);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await assets.screenshot({ path: '/tmp/cookbook-grouped-assets-mobile.png' });
  arb.updatedAt = '2026-11-20T12:00:00.000Z'; arb.protocols[0].positions = [];
  saved = updateCookbook(saved, arb);
  await cookbook.getByRole('button', { name: 'Reload snapshots' }).click();
  await expect(count).toHaveText('3');
  await expect(row.locator('td').nth(1)).toHaveText('Ethereum');
  await expect(extra.locator('summary')).toHaveText('Additional networks (1)');
});

test('shows Ethereum Horizon alongside the Aave main market with its own balances, health, link and recommendations', async ({ page }) => {
  const fixture = structuredClone(example); fixture.address = '0xE16BE042f9433779909a972669bE3A2003956348'; fixture.wallets = [];
  const aave = fixture.protocols.find(p => p.id === 'aave-v3')!;
  fixture.protocols = [aave];
  const horizon = structuredClone(aave.positions[0]);
  Object.assign(horizon, { id: 'aave-horizon-main', label: 'Ethereum Horizon market', marketAddress: '0xAe05Cd22df81871bc7cC2a04BeCfb516bFe332C8', suppliedUsd: 138514.76, debtUsd: 97273.63, collateralValueUsd: 138349.45, healthFactor: 1.14, liquidationModel: 'unavailable', risk: 'watch' });
  horizon.assets = [
    { address: '0x7433806912Eae67919e66aea853d46Fa0aef98A8', symbol: 'mGLOBAL', supplied: 134602.56, borrowed: 0, priceUsd: 1.0278, collateral: true, liquidationThreshold: null, liquidationPriceUsd: null, supplyRate: { apr: 0, note: 'Horizon collateral has no protocol lending interest' } },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', supplied: 165.3392, borrowed: 1.2695, priceUsd: .99986, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, supplyRate: { apr: .04, note: 'Horizon liquidity APR' }, borrowRate: { apr: .059, note: 'Horizon variable debt APR' } },
    { address: '0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD', symbol: 'RLUSD', supplied: .0018, borrowed: 97272.31, priceUsd: .99962, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, supplyRate: { apr: .03, note: 'Horizon liquidity APR' }, borrowRate: { apr: .041, note: 'Horizon variable debt APR' } },
  ];
  aave.positions.push(horizon);
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: fixture }));
  await page.route('**/api/recommendations', route => route.fulfill({ json: { checkedAt: fixture.updatedAt, alternatives: [], coverage: [], targetIds: [] } }));
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(fixture.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const position = page.locator('.position').filter({ has: page.getByRole('heading', { name: 'Ethereum Horizon market' }) });
  await expect(position).toBeVisible();
  await expect(position.getByRole('link', { name: 'Ethereum Horizon market' })).toHaveAttribute('href', 'https://app.aave.com/?marketName=proto_horizon_v3');
  await expect(position.locator('.position-stats')).toContainText('$138,514.76');
  await expect(position.locator('.position-stats')).toContainText('$97,273.63');
  await expect(position.locator('.position-stats')).toContainText('1.14');
  await expect(position.locator('tbody')).toContainText('mGLOBAL');
  await expect(position.locator('tbody')).toContainText('RLUSD');
  await expect(page.locator('.summary.primary > strong')).toHaveText(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(aave.positions.reduce((sum, p) => sum + p.suppliedUsd! - p.debtUsd!, 0)));
  await page.screenshot({ path: '/tmp/horizon-dashboard.png', fullPage: true });
  await page.getByRole('button', { name: 'Recommendations', exact: true }).click();
  await expect(page.locator('#recommendations-panel')).toContainText('Ethereum Horizon market');
});

test('Alerts saves and restores active loan and deposit preferences independently of other wallet data', async ({ page }) => {
  const { mergeWalletHistory } = await import('../src/wallet-history');
  const fixture = structuredClone(example); fixture.wallets = [];
  const loan = fixture.protocols[0].positions[0];
  const deposit = { ...structuredClone(loan), id: 'deposit-only', label: 'Pure USDC deposit', depositOnly: true, debtUsd: 0, collateralValueUsd: 0, healthFactor: null, risk: 'no-debt' as const, assets: [{ ...loan.assets[0], symbol: 'USDC', supplied: 100, borrowed: 0, priceUsd: 1, collateral: false }] };
  const bad = { ...structuredClone(loan), id: 'bad-loan', label: 'Excluded Bad Debt', debtUsd: 50000, suppliedUsd: 10, collateralValueUsd: 10 };
  fixture.protocols = [{ ...fixture.protocols[0], positions: [loan, deposit, bad, { ...deposit, id: 'empty', label: 'Empty market', suppliedUsd: 0, assets: [] }] }];
  let wallet = { address: fixture.address.toLowerCase(), lastCheckedAt: '2026-11-22T10:00:00.000Z', manualLiquidationPrices: [{ network: 'ethereum' as const, protocol: 'aave-v3', positionId: 'saved-manual', updatedAt: '2026-11-22T09:00:00.000Z', pricesUsd: { '0x1111111111111111111111111111111111111111': 990 } }] } as import('../src/wallet-history').SavedWallet;
  const writes: any[] = [];
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: { ...fixture, walletHistory: { wallet, persistence: { mode: 'github', synced: true } } } }));
  await page.route('**/api/wallet-history/*/alerts', async route => {
    const input = route.request().postDataJSON(); writes.push(input);
    wallet = mergeWalletHistory({ version: 1, wallets: [wallet] }, { version: 1, wallets: [{ address: wallet.address, lastCheckedAt: wallet.lastCheckedAt, manualLiquidationPrices: [], alerts: [{ ...input, updatedAt: new Date(Date.parse('2026-11-22T11:00:00.000Z') + writes.length * 1000).toISOString() }] }] }).wallets[0];
    await route.fulfill({ json: { wallet, persistence: { mode: 'github', synced: true } } });
  });
  await page.goto('/'); await page.getByLabel('Wallet address', { exact: true }).fill(fixture.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const nav = page.getByRole('navigation', { name: 'Dashboard sections' });
  await nav.getByRole('group', { name: 'Wallet Overview subsections' }).getByRole('button', { name: 'Alerts', exact: true }).click();
  const alerts = page.getByRole('region', { name: 'Alerts', exact: true });
  await expect(alerts.locator('.alert-position')).toHaveCount(2);
  await expect(alerts).not.toContainText('Empty market'); await expect(alerts).not.toContainText('Excluded Bad Debt');
  const form = alerts.getByRole('form', { name: `Alert rules for ${loan.label}`, exact: true });
  await form.getByRole('checkbox', { name: 'Borrow APR higher than supply APR' }).check();
  await form.getByRole('checkbox', { name: 'New liquidity added to the market' }).check();
  await form.getByRole('checkbox', { name: 'Utilization ratio higher than' }).check();
  await form.getByLabel('Utilization threshold (%)').fill('90');
  await form.getByRole('checkbox', { name: 'Health factor is lower than 1.01' }).check();
  await form.getByRole('checkbox', { name: 'Position total APR is lower than' }).check();
  await form.getByLabel('Position APR threshold (%)').fill('-1.5');
  await form.getByRole('button', { name: 'Save alerts', exact: true }).click();
  await expect(form.getByRole('status')).toHaveText('Alerts saved to GitHub.');
  await expect(alerts.getByRole('region', { name: 'Liquidity monitoring status' })).toContainText('no scheduled run has been recorded');
  await expect(alerts.getByRole('region', { name: 'Utilization monitoring status' })).toContainText('no scheduled run has been recorded');
  await expect(alerts.getByRole('link', { name: 'Utilization notifications JSON' })).toHaveAttribute('href', 'https://github.com/Sberex/DeFiMon/blob/main/analysis/utilization-alert-notifications.json');
  expect(writes[0]).toMatchObject({ network: 'ethereum', protocol: fixture.protocols[0].id, positionId: loan.id, rules: { borrowAprAboveSupplyApr: true, newLiquidityAdded: true, utilizationAbove: { enabled: true, thresholdPercent: 90 }, healthFactorBelow: { enabled: true, threshold: 1.01 }, positionAprBelow: { enabled: true, thresholdPercent: -1.5 } } });
  await nav.getByRole('button', { name: 'Wallet Overview', exact: true }).click(); await nav.getByRole('button', { name: 'Alerts', exact: true }).click();
  await expect(form.getByRole('checkbox', { name: 'Borrow APR higher than supply APR' })).toBeChecked();
  await expect(form.getByLabel('Utilization threshold (%)')).toHaveValue('90');
  await expect(form.getByRole('checkbox', { name: 'New liquidity added to the market' })).toBeChecked();
  await form.getByLabel('Utilization threshold (%)').fill('95');
  const depositForm = alerts.getByRole('form', { name: 'Alert rules for Pure USDC deposit', exact: true });
  await depositForm.getByRole('checkbox', { name: 'Position total APR is lower than' }).check();
  await depositForm.getByLabel('Position APR threshold (%)').fill('2');
  await depositForm.getByRole('button', { name: 'Save alerts', exact: true }).click();
  await expect(depositForm.getByRole('status')).toContainText('saved to GitHub');
  await expect(form.getByLabel('Utilization threshold (%)')).toHaveValue('95');
  await form.getByRole('button', { name: 'Save alerts', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('saved to GitHub');
  expect(wallet.alerts).toHaveLength(2); expect(wallet.manualLiquidationPrices[0].pricesUsd).toEqual({ '0x1111111111111111111111111111111111111111': 990 });
  expect(wallet.alerts?.find(a => a.positionId === loan.id)?.rules.utilizationAbove.thresholdPercent).toBe(95);
  await page.getByRole('button', { name: 'Check wallet', exact: true }).click();
  await expect(form.getByLabel('Utilization threshold (%)')).toHaveValue('95');
  await expect(depositForm.getByLabel('Position APR threshold (%)')).toHaveValue('2');
  await expect(form.getByRole('checkbox', { name: 'New liquidity added to the market' })).toBeChecked();
  await expect(form.locator('time')).toHaveAttribute('datetime', '2026-11-22T11:00:03.000Z');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await alerts.screenshot({ path: '/tmp/defimon-alerts-mobile.png' });
  const other = '0x4444444444444444444444444444444444444444';
  await page.getByLabel('Wallet address', { exact: true }).fill(other);
  await page.unroute('**/api/portfolio/*');
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: { ...fixture, address: other, walletHistory: { wallet: { address: other, lastCheckedAt: wallet.lastCheckedAt, manualLiquidationPrices: [] }, persistence: { mode: 'github', synced: true } } } }));
  await page.getByRole('button', { name: 'Check wallet', exact: true }).click();
  await expect(form.getByRole('checkbox', { name: 'Borrow APR higher than supply APR' })).not.toBeChecked();
  await expect(form.getByLabel('Utilization threshold (%)')).toHaveValue('');
  await expect(form.getByRole('checkbox', { name: 'New liquidity added to the market' })).not.toBeChecked();
});

test('Alerts retains selections after failed saves, validates thresholds, and never saves example preferences', async ({ page }) => {
  await page.route('**/api/portfolio/*', route => route.fulfill({ json: example }));
  let writes = 0;
  await page.route('**/api/wallet-history/*/alerts', route => { writes++; return route.fulfill({ status: 503, json: {} }); });
  await page.goto('/'); await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  const alerts = page.getByRole('region', { name: 'Alerts', exact: true }); await expect(alerts).toContainText('Check a wallet address');
  await page.getByLabel('Wallet address', { exact: true }).fill(example.address); await page.getByRole('button', { name: 'Check wallet' }).click();
  const form = alerts.getByRole('form').first();
  await form.getByRole('checkbox', { name: 'Utilization ratio higher than' }).check(); await form.getByLabel('Utilization threshold (%)').fill('101');
  await form.getByRole('button', { name: 'Save alerts', exact: true }).click(); expect(writes).toBe(0);
  await form.getByLabel('Utilization threshold (%)').fill('90'); await form.getByRole('button', { name: 'Save alerts', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('could not be saved'); await expect(form.getByLabel('Utilization threshold (%)')).toHaveValue('90');
  await page.unroute('**/api/wallet-history/*/alerts');
  await page.route('**/api/wallet-history/*/alerts', route => {
    writes++;
    return route.fulfill({ json: { wallet: { address: example.address.toLowerCase(), lastCheckedAt: '2026-11-22T10:00:00.000Z', manualLiquidationPrices: [], alerts: [{ ...route.request().postDataJSON(), updatedAt: '2026-11-22T11:00:00.000Z' }] }, persistence: { mode: 'github', synced: false, message: 'GitHub sync is pending.' } } });
  });
  await form.getByRole('button', { name: 'Save alerts', exact: true }).click();
  await expect(alerts.locator('.notice')).toContainText('GitHub sync is pending.');
  await page.getByRole('button', { name: 'Wallet Overview', exact: true }).click(); await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await expect(alerts.locator('.notice')).toContainText('GitHub sync is pending.');
  await expect(form.getByLabel('Utilization threshold (%)')).toHaveValue('90');
  await page.getByRole('button', { name: 'Explore an example' }).click();
  await expect(alerts.getByRole('button', { name: 'Save alerts', exact: true }).first()).toBeDisabled(); expect(writes).toBe(2);
});
