import { beforeEach, expect, it, vi } from 'vitest';
import type { ChainClient } from '../server/rpc';
import type { ProtocolResult } from '../src/types';
const mocks = vi.hoisted(() => ({ lend: vi.fn(), morpho: vi.fn() }));
vi.mock('../server/adapters/aave', () => ({ readAave: mocks.lend }));
vi.mock('../server/adapters/morpho', () => ({ readMorpho: mocks.morpho }));
vi.mock('../server/wallet-prices', () => ({ walletPrices: async () => new Map([['0x1111111111111111111111111111111111111111', .99]]) }));
import { readSpark, deduplicateSparkPositions } from '../server/adapters/spark';
import { sparkVaults, SPARK_LEND } from '../server/deployments/spark';
import { sparkSavingsApr, sparkVaultRate } from '../server/spark';
import { protocolMonthlyInterest } from '../src/monthly-interest';
import { recommendationPositions } from '../src/recommendations';
import { positionLinks } from '../src/position-links';
const wallet = '0x2222222222222222222222222222222222222222';
const asset = '0x1111111111111111111111111111111111111111';
const ray = 10n ** 27n;
function fixture(failRate = false, failBalance = false) {
  return { readContract: vi.fn(async ({ address, functionName, blockNumber }: any) => {
    expect(blockNumber).toBe(123n);
    switch (functionName) {
      case 'balanceOf': if (failBalance) throw Error('private-provider-secret'); return address === sparkVaults.ethereum[0].address ? 10n ** 18n : 0n;
      case 'asset': return asset;
      case 'name': return 'Spark Savings USDC';
      case 'convertToAssets': return 10_000_000n;
      case 'symbol': return 'USDC';
      case 'decimals': return 6;
      case 'vsr': if (failRate) throw Error('secret'); return ray + 10n ** 18n;
    }
    throw Error(functionName);
  }) } as unknown as ChainClient;
}
beforeEach(() => {
  mocks.lend.mockReset().mockResolvedValue({ id: 'spark', name: 'Spark', status: 'ok', positions: [] });
  mocks.morpho.mockReset().mockResolvedValue({ id: 'morpho', name: 'Morpho', status: 'ok', positions: [] });
});
it('values Spark vault shares in underlying units and includes earned interest in NPL once', async () => {
  const result = await readSpark(fixture(), wallet, 123n);
  expect(mocks.lend).toHaveBeenCalledWith(expect.anything(), wallet, 123n, 'ethereum', expect.objectContaining({ provider: SPARK_LEND.provider, legacyEMode: true }));
  expect(result).toMatchObject({ id: 'spark', status: 'ok', balanceDiscoveryComplete: true });
  expect(result.positions).toHaveLength(1);
  expect(result.positions[0]).toMatchObject({ suppliedUsd: 9.9, debtUsd: 0, depositOnly: true, receiptTokens: [sparkVaults.ethereum[0].address] });
  expect(result.positions[0].assets[0].supplyRate?.apr).toBeCloseTo(.031536);
  expect(protocolMonthlyInterest(result).nplUsd).toBeCloseTo(9.9 * .031536 / 12);
  expect(recommendationPositions([result])[0]).toMatchObject({ protocol: 'Spark', deposit: true });
  expect(positionLinks('spark', 'Ethereum', result.positions[0])[0]).toMatchObject({ address: sparkVaults.ethereum[0].address, url: 'https://app.spark.finance/savings' });
});
it('preserves supply values when a savings rate is unavailable, without assuming zero earnings', async () => {
  const result = await readSpark(fixture(true), wallet, 123n);
  expect(result.status).toBe('partial'); expect(result.balanceDiscoveryComplete).toBe(true);
  expect(result.positions[0].suppliedUsd).toBe(9.9);
  expect(result.positions[0].assets[0].supplyRate?.apr).toBeNull();
  expect(protocolMonthlyInterest(result).nplUsd).toBeNull();
});
it('retains vault deposits when SparkLend fails and keeps unread balances unknown', async () => {
  mocks.lend.mockRejectedValueOnce(Error('private-provider-secret'));
  const result = await readSpark(fixture(), wallet, 123n);
  expect(result.positions).toHaveLength(2); expect(result.balanceDiscoveryComplete).toBe(false);
  expect(result.positions[1].suppliedUsd).toBe(9.9);
  expect(protocolMonthlyInterest(result).nplUsd).toBeNull();
  expect(JSON.stringify(result)).not.toContain('private-provider-secret');
  const failed = await readSpark(fixture(false, true), wallet, 123n);
  expect(failed.balanceDiscoveryComplete).toBe(false);
  expect(failed.positions.every(p => p.suppliedUsd === null)).toBe(true);
});
it('reads savings only on Arbitrum, never reuses the Ethereum pool there, and rejects Plasma', async () => {
  const result = await readSpark(fixture(), wallet, 123n, 'arbitrum');
  expect(mocks.lend).not.toHaveBeenCalled(); expect(mocks.morpho).not.toHaveBeenCalled();
  expect(result.coverage).toContain('no borrowing'); expect(result.positions).toEqual([]);
  await expect(readSpark(fixture(), wallet, 123n, 'plasma')).rejects.toThrow('unsupported');
});
it('verifies the configured SSR oracle and subtracts ray before converting to floating point', async () => {
  expect(sparkSavingsApr(ray)).toBe(0);
  expect(sparkSavingsApr(ray + 10n ** 18n)).toBeCloseTo(.031536);
  expect(() => sparkSavingsApr(ray - 1n)).toThrow();
  const vault = sparkVaults.base[0];
  const client = { readContract: async ({ functionName, address }: any) => functionName === 'rateProvider' ? vault.oracle : address === vault.oracle ? ray + 10n ** 18n : 0n } as unknown as ChainClient;
  expect((await sparkVaultRate(client, 'base', 123n, vault, asset)).apr).toBeCloseTo(.031536);
  const wrong = { readContract: async () => asset } as unknown as ChainClient;
  expect((await sparkVaultRate(wrong, 'base', 123n, vault, asset)).apr).toBeNull();
});
it('keeps shared Morpho positions once under Spark and retains Morpho if Spark could not verify a balance', async () => {
  const spark = await readSpark(fixture(), wallet, 123n);
  spark.positions[0].id = 'morpho-market-0x123';
  const morpho: ProtocolResult = { ...structuredClone(spark), id: 'morpho', name: 'Morpho' };
  const filtered = deduplicateSparkPositions([morpho, spark]);
  expect(filtered[0].positions).toHaveLength(0); expect(filtered[1].positions).toHaveLength(1);
  expect(protocolMonthlyInterest(filtered[0]).nplUsd).toBe(0);
  spark.positions[0].assets = [];
  expect(deduplicateSparkPositions([morpho, spark])[0].positions).toHaveLength(1);
});
