import { decodeFunctionData, encodeFunctionResult, parseAbi } from 'viem';
import { expect, it } from 'vitest';
import { readCompound } from '../server/adapters/compound';
import { networks } from '../server/networks';
import type { ChainClient } from '../server/rpc';
const wallet = '0x1111111111111111111111111111111111111111';
const token = '0x2222222222222222222222222222222222222222';
const multi = parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])']);
const abi = parseAbi(['function accrueAccount(address)', 'function balanceOf(address) view returns (uint256)', 'function borrowBalanceOf(address) view returns (uint256)', 'function getUtilization() view returns (uint256)']);
function fixture(failed?: string) {
  const addresses = new Set<string>();
  const client = {
    call: async ({ to, data, blockNumber }: any) => {
      expect(blockNumber).toBe(42161n);
      const calls = decodeFunctionData({ abi: multi, data }).args[0];
      return { data: encodeFunctionResult({ abi: multi, functionName: 'aggregate3', result: calls.map(call => {
        addresses.add(call.target);
        const fn = decodeFunctionData({ abi, data: call.callData }).functionName;
        return { success: true, returnData: fn === 'accrueAccount' ? '0x' : encodeFunctionResult({ abi, functionName: fn, result: fn === 'balanceOf' ? 100_000000n : fn === 'getUtilization' ? 5n * 10n ** 17n : 0n }) };
      }) }) };
    },
    readContract: async ({ functionName, address, blockNumber }: any) => {
      expect(blockNumber).toBe(42161n);
      if (address.toLowerCase() === failed?.toLowerCase()) throw new Error('private-provider-key');
      if (functionName === 'baseToken' || functionName === 'baseTokenPriceFeed') return token;
      if (functionName === 'numAssets') return 0;
      if (functionName === 'symbol') return 'USDC';
      if (functionName === 'decimals') return 6;
      if (functionName === 'getPrice') return 100000000n;
      if (functionName === 'getSupplyRate') return 1000000000n;
      if (functionName === 'getBorrowRate') return 2000000000n;
      throw new Error('Unsupported read');
    },
  } as unknown as ChainClient;
  return { client, addresses };
}
it('reads all four official Arbitrum Comet markets, with current APRs and no Ethereum market calls', async () => {
  const f = fixture();
  const result = await readCompound(f.client, wallet, 42161n, 'arbitrum');
  expect(result.status).toBe('ok'); expect(result.positions).toHaveLength(4);
  expect(result.positions.map(p => p.label)).toEqual(['USDC market', 'USDC.e market', 'USDT market', 'WETH market']);
  expect([...f.addresses].map(a => a.toLowerCase()).sort()).toEqual(networks.arbitrum.compoundMarkets.map(m => m.address.toLowerCase()).sort());
  expect(result.positions[0].assets[0].supplyRate?.apr).toBeCloseTo(0.031536);
  expect(result.positions[0].suppliedUsd).toBe(100);
  expect(result.coverage).toContain('Arbitrum');
});
it('keeps verified Arbitrum markets when another market fails, rather than losing all Compound balances', async () => {
  const f = fixture(networks.arbitrum.compoundMarkets[1].address);
  const result = await readCompound(f.client, wallet, 42161n, 'arbitrum');
  expect(result.status).toBe('partial');
  expect(result.positions.filter(p => p.suppliedUsd === 100)).toHaveLength(3);
  expect(result.positions[1]).toMatchObject({ suppliedUsd: null, debtUsd: null, risk: 'unknown' });
  expect(JSON.stringify(result)).not.toContain('private-provider-key');
});
