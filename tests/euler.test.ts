import { expect, it } from 'vitest';
import { readEuler, eulerSubaccounts } from '../server/adapters/euler';
import { readEulerMarkets } from '../server/market-euler';
import { createEulerReader, resolveEulerCap } from '../server/euler';
import { protocolMonthlyInterest, totalMonthlyInterest } from '../src/monthly-interest';
import { expandTargets } from '../server/market-readers';
import { eulerFixture, wallet, subaccount, collateral, debt, deposit, WETH, USDC } from './fixtures/euler';
it('derives all 256 EVC subaccounts without crossing the owner prefix', () => {
  const accounts = eulerSubaccounts(wallet);
  expect(new Set(accounts.map(a => a.toLowerCase())).size).toBe(256);
  expect(accounts.every(a => a.slice(0, -2).toLowerCase() === wallet.slice(0, -2))).toBe(true);
  expect(accounts.map(a => a.toLowerCase())).toContain(subaccount);
});
it.each(['ethereum', 'arbitrum', 'plasma'] as const)('reads isolated loans, collateral, passive deposits and instant rates on %s', async network => {
  const f = eulerFixture({ network });
  const result = await readEuler(f.client, wallet, 321n, network, f.prices);
  expect(result.status).toBe('ok'); expect(result.balanceDiscoveryComplete).toBe(true);
  expect(result.positions).toHaveLength(2);
  const loan = result.positions.find(p => p.marketAddress?.toLowerCase() === debt)!;
  expect(loan).toMatchObject({ suppliedUsd: 6000, debtUsd: 1000, healthFactor: 4.8, risk: 'lower' });
  expect(loan.assets.find(a => a.address.toLowerCase() === WETH)).toMatchObject({ supplied: 2, liquidationThreshold: .8, collateral: true });
  expect(loan.assets.find(a => a.address.toLowerCase() === USDC)?.borrowRate?.apr).toBeCloseTo(.031536);
  expect(loan.receiptTokens?.map(a => a.toLowerCase())).toEqual([debt, collateral]);
  expect(protocolMonthlyInterest(result).netValueUsd).toBe(5500);
  expect(f.calls.filter(c => c.name === 'getControllers')).toHaveLength(256);
  expect(f.calls.filter(c => c.name === 'getAccountOwner')).toHaveLength(1);
});
it('counts main-account collateral and direct deposit shares once without duplicating either in another position', async () => {
  const f = eulerFixture({ mainLoan: true });
  const result = await readEuler(f.client, wallet, 321n, 'ethereum', f.prices);
  expect(result.positions).toHaveLength(2);
  expect(result.positions.reduce((s, p) => s + p.suppliedUsd!, 0)).toBe(6500);
  expect(result.positions.reduce((s, p) => s + p.debtUsd!, 0)).toBe(1000);
  expect(result.positions.filter(p => p.receiptTokens?.some(a => a.toLowerCase() === collateral))).toHaveLength(1);
});
it('retains readable positions but withholds complete NPL when registry or wallet balance discovery fails', async () => {
  for (const options of [{ badBalance: true }, { missingSlice: true }, { badFactory: true }]) {
    const f = eulerFixture(options);
    const result = await readEuler(f.client, wallet, 321n, 'ethereum', f.prices);
    expect(result.status).toBe('partial'); expect(result.balanceDiscoveryComplete).toBe(false);
    expect(totalMonthlyInterest([result]).nplUsd).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private-provider-key');
  }
});
it('keeps balances and NPL when liquidation health is unknown, without inventing liquidation prices', async () => {
  const f = eulerFixture({ oracleFailure: true });
  const result = await readEuler(f.client, wallet, 321n, 'ethereum', f.prices);
  const loan = result.positions.find(p => p.marketAddress?.toLowerCase() === debt)!;
  expect(loan.risk).toBe('unknown'); expect(loan.healthFactor).toBeNull();
  expect(loan.assets.every(a => a.liquidationPriceUsd === null)).toBe(true);
  expect(totalMonthlyInterest([result]).nplUsd).not.toBeNull();
});
it('keeps unknown APRs unknown and uses only verified Euler USD-unit oracle routes as a price fallback', async () => {
  const f = eulerFixture({ rateFailure: true });
  const result = await readEuler(f.client, wallet, 321n, 'ethereum', f.prices);
  expect(result.positions[0].suppliedUsd).not.toBeNull(); expect(totalMonthlyInterest([result]).nplUsd).toBeNull();
  const fallback = eulerFixture({ usdOracle: true });
  const priced = await readEuler(fallback.client, wallet, 321n, 'ethereum', async () => new Map());
  expect(priced.positions[0].assets.every(a => a.priceSource === 'euler-oracle')).toBe(true);
  expect(priced.positions.find(p => p.marketAddress?.toLowerCase() === debt)?.suppliedUsd).toBe(6000);
});
it('resolves raw Euler caps and limits market liquidity to cash and borrowing headroom', async () => {
  expect(resolveEulerCap(0)).toBeNull(); expect(resolveEulerCap(1)).toBe(0n);
  expect(resolveEulerCap((100 << 6) | 6)).toBe(1000000n);
  const f = eulerFixture();
  const liquidity = await createEulerReader(f.client, 'ethereum', 321n).liquidity(debt);
  expect(liquidity).toMatchObject({ amount: 2000, symbol: 'USDC' });
});
it.each(['ethereum', 'arbitrum', 'plasma'] as const)('searches exact Euler pairs, deposits and hook restrictions on %s', async network => {
  const targets = expandTargets([{ id: 'loan', network, supplied: WETH, borrowed: USDC }, { id: 'supply', network, supplied: USDC }], network);
  const f = eulerFixture({ network }); const warnings: string[] = [];
  const result = await readEulerMarkets(f.client, network, 321n, targets, message => warnings.push(message));
  expect(warnings).toEqual([]);
  const loans = result.filter(r => r.targetId === 'loan');
  expect(loans).toHaveLength(1); expect(loans[0]).toMatchObject({ protocol: 'Euler', lltv: .8, market: expect.any(String), route: collateral, liquidity: { amount: 2000, symbol: 'USDC' } });
  expect(loans[0].borrowApr).toBeCloseTo(.031536);
  expect(loans[0].collateralVault?.address.toLowerCase()).toBe(collateral);
  expect(loans[0].collateralVault?.url.toLowerCase()).toBe(`https://app.euler.finance/vault/${collateral}?network=${network}`);
  expect(loans[0].url.toLowerCase()).toBe(`https://app.euler.finance/vault/${debt}?network=${network}`);
  expect(result.filter(r => r.targetId === 'supply')).toHaveLength(2);
  const paused = eulerFixture({ paused: true, network });
  expect(await readEulerMarkets(paused.client, network, 321n, targets, () => {})).toEqual([]);
});
