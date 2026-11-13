import { decodeFunctionData, encodeFunctionResult, encodeAbiParameters, keccak256, parseAbiParameters } from 'viem';
import { expect, it } from 'vitest';
import { createMorphoRates, morphoSupplyApr } from '../server/morpho-rates';
import { morphoCoreAbi as core, morphoIrmAbi as irmAbi, morphoMulticallAbi as multi } from '../server/abis/morpho';
import { MORPHO_BLUE } from '../server/morpho-discovery';
import type { ChainClient } from '../server/rpc';
const address = '0x1111111111111111111111111111111111111111';
const adapter = '0x2222222222222222222222222222222222222222';
const zero = '0x0000000000000000000000000000000000000000';
const params = { loanToken: address, collateralToken: zero, oracle: address, irm: address, lltv: 0n } as const;
const market = { totalSupplyAssets: 999n, totalSupplyShares: 999000000n, totalBorrowAssets: 800n, totalBorrowShares: 1000000n, lastUpdate: 123n, fee: 10n ** 17n };
const id = keccak256(encodeAbiParameters(parseAbiParameters('address,address,address,address,uint256'), [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv]));
function client(extra: Record<string, any> = {}) {
  return {
    readContract: async ({ functionName, args }: any) => {
      if (functionName in extra) { const value = extra[functionName]; return typeof value === 'function' ? value(args) : value; }
      if (functionName === 'idToMarketParams') return params;
      if (functionName === 'asset') return address;
      if (functionName === 'MORPHO') return MORPHO_BLUE;
      if (functionName === 'totalAssets') return 1000n;
      if (functionName === 'withdrawQueueLength') return 1n;
      if (functionName === 'withdrawQueue') return id;
      if (functionName === 'fee') return 10n ** 17n;
      if (functionName === 'position') return { supplyShares: 500000000n, borrowShares: 0n, collateral: 0n };
      throw new Error('unsupported');
    },
    call: async ({ data, blockNumber }: any) => {
      expect(blockNumber).toBe(123n);
      const calls = decodeFunctionData({ abi: multi, data }).args[0];
      expect(decodeFunctionData({ abi: core, data: calls[0].callData }).functionName).toBe('accrueInterest');
      const target = calls[1].target;
      const result = target.toLowerCase() === MORPHO_BLUE.toLowerCase()
        ? encodeFunctionResult({ abi: core, functionName: 'market', result: market })
        : encodeFunctionResult({ abi: irmAbi, functionName: 'borrowRateView', result: 1000000000n });
      return { data: encodeFunctionResult({ abi: multi, functionName: 'aggregate3', result: [{ success: true, returnData: '0x' }, { success: true, returnData: result }] }) };
    },
  } as unknown as ChainClient;
}
it('uses an IRM view after simulated accrual, and applies utilization and the market fee to supply APR', async () => {
  const result = await createMorphoRates(client(), 123n).market(params, market);
  expect(result.borrowRate.apr).toBeCloseTo(0.031536);
  expect(result.supplyRate.apr).toBeCloseTo(0.0227286486486);
  expect(morphoSupplyApr(0.1, 1000n, 800n, 10n ** 17n)).toBeCloseTo(0.072);
});
it('distinguishes an interest-free market from an unavailable IRM', async () => {
  const free = await createMorphoRates(client(), 123n).market({ ...params, irm: zero }, market);
  expect(free.borrowRate.apr).toBe(0);
  const failed = await createMorphoRates({ call: async () => { throw new Error('private-rpc'); } } as unknown as ChainClient, 123n).market(params, market);
  expect(failed.borrowRate.apr).toBeNull(); expect(failed.supplyRate.apr).toBeNull();
});
it('weights V1 allocated lending and idle cash, and deducts the vault performance fee', async () => {
  const interest = await createMorphoRates(client(), 123n).vault(address, 1, address);
  expect(interest.apr).toBeCloseTo(0.0102278918919); expect(interest.estimated).toBe(true);
  expect(interest.note).toContain('idle cash');
});
it('reports zero for a funded idle V1 vault and unknown for an unreadable active allocation', async () => {
  expect((await createMorphoRates(client({ withdrawQueueLength: 0n }), 123n).vault(address, 1, address)).apr).toBe(0);
  expect((await createMorphoRates(client({ withdrawQueue: () => { throw new Error('secret'); } }), 123n).vault(address, 1, address)).apr).toBeNull();
});
it('applies V2 distribution caps and enabled fees, rather than showing a historical APY', async () => {
  const interest = await createMorphoRates(client({ adaptersLength: 0n, balanceOf: 1100n, performanceFee: 10n ** 17n, managementFee: 0n, maxRate: 1000000000n, performanceFeeRecipient: address, managementFeeRecipient: address, canReceiveShares: true }), 123n).vault(address, 2, address);
  expect(interest.apr).toBeCloseTo(0.0283824); expect(interest.note).toContain('distribution-rate cap');
});
it('includes current management-fee drag for idle V2 capital', async () => {
  const interest = await createMorphoRates(client({ adaptersLength: 0n, balanceOf: 1000n, performanceFee: 0n, managementFee: 10000000n, maxRate: 1000000000n, performanceFeeRecipient: address, managementFeeRecipient: address, canReceiveShares: true }), 123n).vault(address, 2, address);
  expect(interest.apr).toBeCloseTo(-0.00031536);
});
it('reports an unknown V2 rate when a funded adapter has an unsupported interface', async () => {
  const interest = await createMorphoRates(client({ adaptersLength: 1n, adapters: adapter, balanceOf: 0n, parentVault: address, realAssets: 1000n }), 123n).vault(address, 2, address);
  expect(interest.apr).toBeNull(); expect(interest.note).toContain('No historical average');
});

it('computes V2 direct-market adapter rates only when all current allocation is accounted for', async () => {
  const extra = { adaptersLength: 1n, adapters: adapter, balanceOf: 0n, parentVault: address, realAssets: 1000n, morpho: MORPHO_BLUE, marketIdsLength: 1n, marketIds: id, expectedSupplyAssets: 1000n, performanceFee: 0n, managementFee: 0n, maxRate: 100000000000n, performanceFeeRecipient: address, managementFeeRecipient: address };
  expect((await createMorphoRates(client(extra), 123n).vault(address, 2, address)).apr).toBeCloseTo(0.0227286486486);
  expect((await createMorphoRates(client({ ...extra, expectedSupplyAssets: 900n }), 123n).vault(address, 2, address)).apr).toBeNull();
});

it('supports a V2 adapter allocating to V1 without requiring the V1 adapter to expose asset()', async () => {
  const nested = '0x3333333333333333333333333333333333333333';
  const base = client({ adaptersLength: 1n, adapters: adapter, balanceOf: 0n, parentVault: address, realAssets: 1000n, morphoVaultV1: nested, performanceFee: 0n, managementFee: 0n, maxRate: 100000000000n, performanceFeeRecipient: address, managementFeeRecipient: address });
  const wrapped = { ...base, readContract: async (args: any) => {
    if (args.address === adapter && args.functionName === 'asset') throw new Error('This adapter has no asset getter');
    return base.readContract(args);
  } } as unknown as ChainClient;
  expect((await createMorphoRates(wrapped, 123n).vault(address, 2, address)).apr).toBeCloseTo(0.0102278918919);
});
