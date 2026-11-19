import { expect, it } from 'vitest';
import type { ChainClient } from '../server/rpc';
import { readSparkMarkets } from '../server/market-spark';
import { expandTargets } from '../server/market-readers';
import { SPARK_LEND } from '../server/deployments/spark';
const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const targets = expandTargets([{ id: 'loan', network: 'ethereum', supplied: weth, borrowed: usdc }], 'ethereum');
it('uses SparkLend provider, APRs, and cash liquidity without requiring Aave virtual accounting', async () => {
  const providers: string[] = [];
  const client = { readContract: async (a: any) => {
    expect(a.blockNumber).toBe(100n);
    switch (a.functionName) {
      case 'getPool': case 'getPoolDataProvider': providers.push(a.address); return SPARK_LEND.pool;
      case 'getAllReservesTokens': return [{ tokenAddress: weth }, { tokenAddress: usdc }];
      case 'getReserveConfigurationData': return [a.args[0] === usdc ? 6n : 18n, 8000n, 8500n, 0n, 0n, true, true, false, true, false];
      case 'getReserveData': return [0n, 0n, 0n, 0n, 0n, 2n * 10n ** 25n, 3n * 10n ** 25n];
      case 'getConfiguration': return { data: 0n };
      case 'getReserveTokensAddresses': return [SPARK_LEND.pool, SPARK_LEND.pool, SPARK_LEND.pool];
      case 'balanceOf': return 1_000_000_000n;
      case 'decimals': return 6;
      case 'symbol': return 'USDC';
      case 'getFacilitatorBucket': return [0n, 0n];
      case 'getVirtualUnderlyingBalance': throw Error('Spark does not implement this');
    }
    throw Error(a.functionName);
  } } as unknown as ChainClient;
  const warnings: string[] = [];
  const result = await readSparkMarkets(client, 'ethereum', 100n, targets, message => warnings.push(message));
  expect(result).toHaveLength(1); expect(providers).toEqual([SPARK_LEND.provider, SPARK_LEND.provider]);
  expect(result[0]).toMatchObject({ protocol: 'Spark', market: SPARK_LEND.pool, supplyApr: .02, borrowApr: .03, liquidity: { amount: 1000, symbol: 'USDC' }, url: 'https://app.spark.finance/borrow' });
  expect(warnings).toEqual([]);
});
it('does not invent Spark borrowing alternatives on Arbitrum', async () => {
  const client = { readContract: async () => { throw Error('No reads expected'); } } as unknown as ChainClient;
  const result = await readSparkMarkets(client, 'arbitrum', 100n, targets, () => {});
  expect(result).toEqual([]);
});

it('lists shared Spark/Morpho alternatives once, retaining Morpho if Spark search fails', async () => {
  const { searchMarkets } = await import('../server/market-search');
  let failSpark = false;
  const market = '0x1111111111111111111111111111111111111111';
  const client = () => ({ getChainId: async () => 1, getBlockNumber: async () => 100n }) as unknown as ChainClient;
  const resultFor = (protocol: string) => ({ targetId: 'loan', protocol, network: 'ethereum' as const, market, label: '', supplyApr: 0, borrowApr: .03, lltv: .8, block: '100', url: '', note: '' });
  const sources = Object.fromEntries(['aave-v3', 'aave-v4', 'morpho', 'fluid', 'compound', 'euler', 'spark'].map(id => [id, { name: id, read: async () => {
    if (id === 'spark' && failSpark) throw Error('private-provider-secret');
    return id === 'morpho' ? [resultFor('Morpho')] : id === 'spark' ? [resultFor('Spark')] : [];
  } }]));
  const discover = async () => ({ matches: {}, reports: [] });
  const inputs = [{ id: 'loan', network: 'ethereum' as const, supplied: weth, borrowed: usdc }];
  const result = await searchMarkets(inputs, client, sources, discover);
  expect(result.alternatives).toHaveLength(1); expect(result.alternatives[0].protocol).toBe('Spark');
  failSpark = true;
  const fallback = await searchMarkets(inputs, client, sources, discover);
  expect(fallback.alternatives).toHaveLength(1); expect(fallback.alternatives[0].protocol).toBe('Morpho');
  expect(JSON.stringify(fallback)).not.toContain('private-provider-secret');
});
