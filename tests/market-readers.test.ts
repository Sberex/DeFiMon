import { expect, it } from 'vitest';
import { expandTargets, readAaveMarkets, readCompoundMarkets } from '../server/market-readers';
import { searchMarkets } from '../server/market-search';
import type { ChainClient } from '../server/rpc';
const supply = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', borrow = '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f';
const targets = expandTargets([{ id: 'loan', network: 'ethereum', supplied: supply, borrowed: borrow }], 'ethereum');
it('Aave reads pair reserve rates at one block and excludes paused, frozen and isolation-ineligible reserves', async () => {
  let paused = false, isolated = false, borrowableInIsolation = false;
  const client = { readContract: async (args: any) => {
    expect(args.blockNumber).toBe(100n);
    switch (args.functionName) {
      case 'getPoolDataProvider': case 'getPool': return '0x1111111111111111111111111111111111111111';
      case 'getAllReservesTokens': return [{ tokenAddress: supply }, { tokenAddress: borrow }];
      case 'getReserveConfigurationData': return [18n, 8000n, 8500n, 0n, 0n, true, true, false, true, false];
      case 'getReserveData': return [0n, 0n, 0n, 0n, 0n, 2n * 10n ** 25n, 3n * 10n ** 25n];
      case 'getConfiguration': return { data: (paused ? 1n << 60n : 0n) | (isolated && args.args[0] === supply ? 1n << 212n : 0n) | (borrowableInIsolation ? 1n << 61n : 0n) | 1n << 252n };
    }
    throw new Error(args.functionName);
  } } as unknown as ChainClient;
  const options = await readAaveMarkets(client, 'ethereum', 100n, targets, () => {});
  expect(options).toHaveLength(1); expect(options[0]).toMatchObject({ supplyApr: .02, borrowApr: .03, lltv: .85 });
  paused = true; expect(await readAaveMarkets(client, 'ethereum', 100n, targets, () => {})).toEqual([]);
  paused = false; isolated = true; expect(await readAaveMarkets(client, 'ethereum', 100n, targets, () => {})).toEqual([]);
  borrowableInIsolation = true; expect(await readAaveMarkets(client, 'ethereum', 100n, targets, () => {})).toHaveLength(1);
});
it('Compound matches only base-token borrowing against configured collateral, not arbitrary tokens', async () => {
  const client = { readContract: async ({ functionName }: any) => {
    switch (functionName) {
      case 'isSupplyPaused': case 'isWithdrawPaused': return false;
      case 'baseToken': return borrow;
      case 'getUtilization': return 50n;
      case 'numAssets': return 1;
      case 'getSupplyRate': return 1000000000n;
      case 'getBorrowRate': return 2000000000n;
      case 'getAssetInfo': return { asset: supply, borrowCollateralFactor: 800000000000000000n, liquidateCollateralFactor: 850000000000000000n, supplyCap: 1n };
    }
  } } as unknown as ChainClient;
  const result = await readCompoundMarkets(client, 'ethereum', 100n, targets, () => {});
  expect(result).toHaveLength(2); expect(result[0].supplyApr).toBe(0); expect(result[0].borrowApr).toBeCloseTo(.063072);
  expect(await readCompoundMarkets(client, 'ethereum', 100n, [{ ...targets[0], borrows: [supply] }], () => {})).toEqual([]);
});
it('isolates unavailable sources and networks while retaining verified alternatives with explicit coverage', async () => {
  const clientFor = (network: string) => ({ getChainId: async () => network === 'ethereum' ? 1 : network === 'plasma' ? 9745 : 42161, getBlockNumber: async () => 100n } as unknown as ChainClient);
  const sources = Object.fromEntries(['aave-v3', 'aave-v4', 'compound', 'fluid', 'morpho'].map(id => [id, { name: id, read: async () => { if (id === 'morpho') throw new Error('private-provider-key'); return []; } }]));
  const result = await searchMarkets([{ id: 'loan', network: 'ethereum', supplied: supply, borrowed: borrow }], clientFor, sources);
  expect(result.coverage).toHaveLength(9);
  expect(result.coverage.filter(c => c.status === 'error')).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain('private-provider-key');
});
