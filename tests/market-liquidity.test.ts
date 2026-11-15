import { expect, it } from 'vitest';
import type { ChainClient } from '../server/rpc';
import { aaveLiquidity, compoundLiquidity, liquidityQuote, v4Liquidity } from '../server/market-liquidity';
import { fluidMarketLiquidity, type FluidLiquidityInput } from '../server/fluid-market-liquidity';
const token = '0x1111111111111111111111111111111111111111', market = '0x2222222222222222222222222222222222222222';
const second = '0x3333333333333333333333333333333333333333';
const E6 = 10n ** 6n;
function client(values: Record<string, any>) {
  return { readContract: async ({ functionName, blockNumber }: any) => {
    expect(blockNumber).toBe(100n);
    if (!(functionName in values)) throw new Error('private-provider-url');
    const value = values[functionName]; if (value instanceof Error) throw value; return value;
  } } as unknown as ChainClient;
}
it('quotes actual token units, preserving true zero and rejecting invalid values', () => {
  expect(liquidityQuote(123456789n, 6, 'USDT0', token, '').amount).toBe(123.456789);
  expect(liquidityQuote(0n, 18, 'GHO', token, '').amount).toBe(0);
  expect(() => liquidityQuote(-1n, 6, 'USDT', token, '')).toThrow();
  expect(() => liquidityQuote(1n, 99, 'USDT', token, '')).toThrow();
});
it('Aave liquidity is bounded by token cash, virtual accounting and remaining borrow-cap headroom', async () => {
  const values = { decimals: 6, symbol: 'USDT', getReserveTokensAddresses: [market, market, market], balanceOf: 1000n * E6, getVirtualUnderlyingBalance: 800n * E6 };
  const bits = 500n << 80n;
  expect((await aaveLiquidity(client(values), market, market, token, bits, 6, 400n * E6, 100n))?.amount).toBe(100);
  expect((await aaveLiquidity(client(values), market, market, token, 0n, 6, 0n, 100n))?.amount).toBe(800);
  expect((await aaveLiquidity(client(values), market, market, token, bits, 6, 600n * E6, 100n))?.amount).toBe(0);
  expect(await aaveLiquidity(client({ ...values, getVirtualUnderlyingBalance: new Error('unreadable') }), market, market, token, 0n, 6, 0n, 100n)).toBeNull();
});
it('Aave GHO mint capacity is available even when aToken underlying cash is zero', async () => {
  const result = await aaveLiquidity(client({ decimals: 18, symbol: 'GHO', getReserveTokensAddresses: [market, market, market], balanceOf: 0n, getFacilitatorBucket: [1000n * 10n ** 18n, 750n * 10n ** 18n] }), market, market, token, 0n, 18, 0n, 100n);
  expect(result?.amount).toBe(250); expect(result?.note).toContain('mint capacity');
});
it('Aave v4 liquidity respects the exact Spoke cap including accrued owed debt and rounded deficit', async () => {
  const values = { decimals: 6, symbol: 'USDC', getAssetLiquidity: 1000n * E6, getSpokeTotalOwed: 300n * E6, getSpoke: { drawCap: 500, active: true, halted: false, deficitRay: E6 * 10n ** 27n + 1n } };
  const result = await v4Liquidity(client(values), market, 1n, market, token, 100n);
  expect(result?.amount).toBe(198.999999);
  expect((await v4Liquidity(client({ ...values, getSpoke: { ...values.getSpoke, drawCap: Number((1n << 40n) - 1n) } }), market, 1n, market, token, 100n))?.amount).toBe(1000);
  expect((await v4Liquidity(client({ ...values, getSpoke: { ...values.getSpoke, halted: true } }), market, 1n, market, token, 100n))?.amount).toBe(0);
});
it('Compound uses base cash, and missing reads remain unknown rather than zero', async () => {
  const result = await compoundLiquidity(client({ decimals: 6, symbol: 'USDC', balanceOf: 900n * E6 }), market, token, 100n);
  expect(result?.amount).toBe(900);
  expect(await compoundLiquidity(client({ decimals: 6, symbol: 'USDC' }), market, token, 100n)).toBeNull();
});
it('Fluid T1 uses resolver borrowable capacity and preserves an exhausted limit', async () => {
  const vault: FluidLiquidityInput = { isSmartDebt: false, constantVariables: { borrow: market, borrowToken: { token0: token, token1: second } }, limitsAndAvailability: { borrowable: 150n * E6 } };
  const rpc = client({ decimals: 6, symbol: 'USDT0' });
  expect((await fluidMarketLiquidity(rpc, 'plasma', 100n, vault)).get(token)?.amount).toBe(150);
  expect((await fluidMarketLiquidity(rpc, 'plasma', 100n, { ...vault, limitsAndAvailability: { borrowable: 0n } })).get(token)?.amount).toBe(0);
});
it('Fluid smart-debt liquidity converts shares proportionally and uses the tighter token limit for both sides', async () => {
  const vault: FluidLiquidityInput = { isSmartDebt: true, constantVariables: { borrow: market, borrowToken: { token0: token, token1: second } }, limitsAndAvailability: { borrowable: 100n * 10n ** 18n } };
  const rpc = client({ decimals: 6, symbol: 'TOKEN' });
  Object.assign(rpc, { simulateContract: async () => ({ result: { dex: market, constantViews: { token0: token, token1: second }, configs: { maxBorrowShares: 1000n * 10n ** 18n }, dexState: { totalBorrowShares: 100n * 10n ** 18n, token0PerBorrowShare: 2n * E6, token1PerBorrowShare: E6 }, limitsAndAvailability: { liquidityBorrowableToken0: 50n * E6, borrowableUntilUtilizationLimitToken0: 100n * E6, liquidityBorrowableToken1: 100n * E6, borrowableUntilUtilizationLimitToken1: 100n * E6 } } }) });
  const result = await fluidMarketLiquidity(rpc, 'ethereum', 100n, vault);
  expect(result.get(token)?.amount).toBe(50); expect(result.get(second)?.amount).toBe(25);
  expect(result.get(token)?.note).toContain('other pool token');
});
