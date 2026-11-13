import { expect, it } from 'vitest';
import { readAave } from '../server/adapters/aave';
import type { ChainClient } from '../server/rpc';
const wallet = '0x1111111111111111111111111111111111111111';
const token = '0x2222222222222222222222222222222222222222';
function fixture(emode = 0n) {
  const blocks: bigint[] = [];
  const addresses: string[] = [];
  const client = { readContract: async ({ functionName, blockNumber, address }: { functionName: string; blockNumber: bigint; address: string }) => {
    blocks.push(blockNumber); addresses.push(address);
    switch (functionName) {
      case 'getPool': case 'getPriceOracle': case 'getPoolDataProvider': return token;
      case 'getUserAccountData': return [3000000000000n, 1500000000000n, 0n, 8500n, 8000n, 1700000000000000000n];
      case 'getUserEMode': return emode;
      case 'getAllReservesTokens': return [{ symbol: 'WETH', tokenAddress: token }];
      case 'BASE_CURRENCY_UNIT': return 100000000n;
      case 'getUserReserveData': return [10n * 10n ** 18n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, true];
      case 'getReserveConfigurationData': return [18n, 8000n, 8500n, 10500n, 1000n, true, true, false, true, false];
      case 'getAssetPrice': return 300000000000n;
      default: throw new Error(functionName);
    }
  } } as unknown as ChainClient;
  return { client, blocks, addresses };
}
it('normalizes balances, uses authoritative health, and pins all reads to one block', async () => {
  const { client, blocks } = fixture();
  const result = await readAave(client, wallet, 100n);
  expect(result.status).toBe('ok');
  expect(result.positions[0].suppliedUsd).toBe(30000);
  expect(result.positions[0].debtUsd).toBe(15000);
  expect(result.positions[0].healthFactor).toBe(1.7);
  expect(result.positions[0].assets[0].liquidationPriceUsd).toBeCloseTo(1764.705882);
  expect(blocks.every(b => b === 100n)).toBe(true);
});
it('withholds per-asset liquidation prices in efficiency mode while retaining native health', async () => {
  const { client } = fixture(1n);
  const result = await readAave(client, wallet, 100n);
  expect(result.positions[0].healthFactor).toBe(1.7);
  expect(result.positions[0].assets[0].liquidationPriceUsd).toBeNull();
  expect(result.positions[0].notes.join(' ')).toContain('Efficiency mode');
});

it('uses the official Plasma addresses provider with balances and liquidation calculations unchanged', async () => {
  const { client, addresses, blocks } = fixture();
  const result = await readAave(client, wallet, 777n, 'plasma');
  expect(addresses.slice(0, 3)).toEqual(Array(3).fill('0x061D8e131F26512348ee5FA42e2DF1bA9d6505E9'));
  expect(addresses).not.toContain('0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e');
  expect(result.coverage).toContain('Plasma'); expect(result.positions[0].label).toContain('Plasma');
  expect(result.positions[0].suppliedUsd).toBe(30000); expect(result.positions[0].healthFactor).toBe(1.7);
  expect(result.positions[0].assets[0].liquidationPriceUsd).toBeCloseTo(1764.705882);
  expect(blocks.every(b => b === 777n)).toBe(true);
});
