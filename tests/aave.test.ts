import { expect, it } from 'vitest';
import { readAave } from '../server/adapters/aave';
import type { ChainClient } from '../server/rpc';
import { badDebtReasons } from '../src/risk-assessment';
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

it('shows current supply APR and the wallet-weighted stable/variable borrowing APR', async () => {
  const f = fixture();
  const client = { ...f.client, readContract: async (args: any) => {
    if (args.functionName === 'getUserReserveData') return [10n * 10n ** 18n, 2n * 10n ** 18n, 3n * 10n ** 18n, 0n, 0n, 4n * 10n ** 25n, 3n * 10n ** 25n, 0n, true];
    if (args.functionName === 'getReserveData') return [0n, 0n, 0n, 0n, 0n, 3n * 10n ** 25n, 6n * 10n ** 25n, 0n, 0n, 0n, 0n, 1n];
    return f.client.readContract(args);
  } } as unknown as ChainClient;
  const result = await readAave(client, wallet, 100n);
  expect(result.positions[0].assets[0].supplyRate?.apr).toBeCloseTo(0.03);
  expect(result.positions[0].assets[0].borrowRate?.apr).toBeCloseTo(0.052);
});

it('keeps borrowing balances and native risk when a current rate lookup fails', async () => {
  const f = fixture();
  const client = { ...f.client, readContract: async (args: any) => {
    if (args.functionName === 'getUserReserveData') return [10n * 10n ** 18n, 0n, 5n * 10n ** 18n, 0n, 0n, 0n, 0n, 0n, true];
    if (args.functionName === 'getReserveData') throw new Error('https://private-provider/api-key');
    return f.client.readContract(args);
  } } as unknown as ChainClient;
  const result = await readAave(client, wallet, 100n);
  expect(result.positions[0].assets[0].borrowed).toBe(5);
  expect(result.positions[0].assets[0].borrowRate?.apr).toBeNull();
  expect(result.positions[0].healthFactor).toBe(1.7);
  expect(JSON.stringify(result)).not.toContain('api-key');
});

it('resolves Aave v3 through the official Arbitrum provider while preserving balances and risk', async () => {
  const { client, addresses, blocks } = fixture();
  const result = await readAave(client, wallet, 777n, 'arbitrum');
  expect(addresses.slice(0, 3)).toEqual(Array(3).fill('0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb'));
  expect(addresses).not.toContain('0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e');
  expect(result.coverage).toContain('Arbitrum'); expect(result.positions[0].label).toContain('Arbitrum');
  expect(result.positions[0].suppliedUsd).toBe(30000); expect(result.positions[0].healthFactor).toBe(1.7);
  expect(blocks.every(block => block === 777n)).toBe(true);
});

it('shows verified eMode LLTV only for category members and keeps native risk', async () => {
  const f = fixture(1n);
  for (const member of [true, false]) {
    const client = { ...f.client, readContract: async (args: any) => {
      if (args.functionName === 'getEModeCategoryCollateralConfig') return { liquidationThreshold: 9300, ltv: 9000, liquidationBonus: 10100 };
      if (args.functionName === 'getEModeCategoryCollateralBitmap') return member ? 8n : 0n;
      if (args.functionName === 'getReserveData') return { id: 3 };
      return f.client.readContract(args);
    } } as unknown as ChainClient;
    const p = (await readAave(client, wallet, 100n)).positions[0];
    expect(p.assets[0].lltv).toBe(member ? .93 : .85);
    expect(p.healthFactor).toBe(1.7);
    expect(p.assets[0].liquidationPriceUsd).toBeNull();
  }
});
it('recognizes eMode collateral with zero ordinary LLTV and uses native collateral value for Bad Debt checks', async () => {
  const f = fixture(1n);
  for (const mode of ['member', 'not-member', 'unreadable'] as const) {
    const client = { ...f.client, readContract: async (args: any) => {
      if (args.functionName === 'getEModeCategoryCollateralConfig') {
        if (mode === 'unreadable') throw new Error('private-provider-key');
        return { liquidationThreshold: 9600, ltv: 9500, liquidationBonus: 10100 };
      }
      if (args.functionName === 'getEModeCategoryCollateralBitmap') return mode === 'member' ? 8n : 0n;
      if (args.functionName === 'getReserveData') return { id: 3 };
      if (args.functionName === 'getReserveConfigurationData') return [18n, 0n, 0n, 0n, 1000n, false, true, false, true, false];
      return f.client.readContract(args);
    } } as unknown as ChainClient;
    const p = (await readAave(client, wallet, 100n, 'plasma')).positions[0];
    expect(p.assets[0].collateral).toBe(mode !== 'not-member');
    expect(p.assets[0].lltv).toBe(mode === 'member' ? .96 : mode === 'not-member' ? 0 : undefined);
    expect(p.collateralValueUsd).toBe(30000); expect(p.debtUsd).toBe(15000);
    expect(badDebtReasons('aave-v3', p)).toEqual([]);
    expect(p.healthFactor).toBe(1.7);
    expect(JSON.stringify(p)).not.toContain('private-provider-key');
  }
});
it('never treats a user-disabled eMode reserve as pledged collateral', async () => {
  const f = fixture(1n);
  const client = { ...f.client, readContract: async (args: any) => {
    if (args.functionName === 'getUserReserveData') return [10n * 10n ** 18n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, false];
    if (args.functionName === 'getEModeCategoryCollateralConfig') return { liquidationThreshold: 9600, ltv: 9500, liquidationBonus: 10100 };
    if (args.functionName === 'getEModeCategoryCollateralBitmap') return 8n;
    if (args.functionName === 'getReserveData') return { id: 3 };
    return f.client.readContract(args);
  } } as unknown as ChainClient;
  expect((await readAave(client, wallet, 100n)).positions[0].assets[0].collateral).toBe(false);
});

it('uses the Spark provider and verifies legacy eMode membership without borrowing Aave deployment addresses', async () => {
  const f = fixture(1n), provider = '0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE';
  const client = { ...f.client, readContract: async (args: any) => {
    if (args.functionName === 'getEModeCategoryData') return { liquidationThreshold: 9300 };
    if (args.functionName === 'getReserveEModeCategory') return 1n;
    return f.client.readContract(args);
  } } as unknown as ChainClient;
  const result = await readAave(client, wallet, 100n, 'ethereum', { id: 'spark', name: 'SparkLend', provider, legacyEMode: true });
  expect(f.addresses.slice(0, 3)).toEqual([provider, provider, provider]);
  expect(result).toMatchObject({ id: 'spark', name: 'SparkLend' });
  expect(result.positions[0].assets[0].lltv).toBe(.93);
  expect(result.positions[0].assets[0].supplyRate?.note).toContain('SparkLend');
  expect(result.positions[0].healthFactor).toBe(1.7);
});
