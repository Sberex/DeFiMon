import { expect, it } from 'vitest';
import { decodeFunctionData, encodeFunctionResult, parseAbi } from 'viem';
import { readCompound } from '../server/adapters/compound';
import type { ChainClient } from '../server/rpc';
const wallet = '0x1111111111111111111111111111111111111111';
const token = '0x2222222222222222222222222222222222222222';
const multiAbi = parseAbi(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)']);
const balanceAbi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function borrowBalanceOf(address) view returns (uint256)', 'function accrueAccount(address)']);
it('simulates accrual before balances, uses liquidation factors, and pins all reads', async () => {
  let simulations = 0;
  const blocks: bigint[] = [];
  const client = {
    call: async ({ data, blockNumber }: { data: `0x${string}`; blockNumber: bigint }) => {
      simulations++; blocks.push(blockNumber);
      const batch = decodeFunctionData({ abi: multiAbi, data });
      const calls = batch.args[0];
      const methods = calls.map(c => decodeFunctionData({ abi: balanceAbi, data: c.callData }).functionName);
      expect(methods).toEqual(['accrueAccount', 'balanceOf', 'borrowBalanceOf']);
      expect(calls.every(c => !c.allowFailure)).toBe(true);
      return { data: encodeFunctionResult({ abi: multiAbi, functionName: 'aggregate3', result: [
        { success: true, returnData: '0x' },
        { success: true, returnData: encodeFunctionResult({ abi: balanceAbi, functionName: 'balanceOf', result: 0n }) },
        { success: true, returnData: encodeFunctionResult({ abi: balanceAbi, functionName: 'borrowBalanceOf', result: 1000_000000n }) },
      ] }) };
    },
    readContract: async ({ functionName, blockNumber }: { functionName: string; blockNumber: bigint }) => {
      blocks.push(blockNumber);
      switch (functionName) {
        case 'baseToken': case 'baseTokenPriceFeed': return token;
        case 'numAssets': return 1;
        case 'symbol': return 'TEST';
        case 'decimals': return 6;
        case 'getPrice': return 100000000n;
        case 'getAssetInfo': return { asset: token, priceFeed: token, scale: 1000000n, borrowCollateralFactor: 500000000000000000n, liquidateCollateralFactor: 800000000000000000n };
        case 'collateralBalanceOf': return 2000_000000n;
        default: throw new Error(functionName);
      }
    },
  } as unknown as ChainClient;
  const result = await readCompound(client, wallet, 500n);
  expect(simulations).toBe(2);
  expect(result.positions).toHaveLength(2);
  expect(result.positions[0].suppliedUsd).toBe(2000);
  expect(result.positions[0].debtUsd).toBe(1000);
  expect(result.positions[0].healthFactor).toBeCloseTo(1.6);
  expect(result.positions[0].assets.find(a => a.collateral)?.liquidationPriceUsd).toBeCloseTo(.625);
  expect(blocks.every(b => b === 500n)).toBe(true);
});
