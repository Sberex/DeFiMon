import { expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeFunctionResult, keccak256, parseAbiParameters } from 'viem';
import { createLiquidityAlertReader, type LiquidityWatch } from '../server/liquidity-alert-reader';
import { morphoCoreAbi, morphoMulticallAbi, morphoIrmAbi } from '../server/abis/morpho';
import type { ChainClient } from '../server/rpc';
const token = '0x1111111111111111111111111111111111111111', zero = '0x0000000000000000000000000000000000000000';
const params = { loanToken: token, collateralToken: token, oracle: token, irm: zero, lltv: 800000000000000000n } as const;
const id = keccak256(encodeAbiParameters(parseAbiParameters('address,address,address,address,uint256'), [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv]));
const watch: LiquidityWatch = { address: token, network: 'ethereum', protocol: 'morpho', positionId: `morpho-market-${id}`, ruleUpdatedAt: '2026-11-22T10:00:00.000Z' };
function fixture(fail = false, inactive = false) {
  const call = vi.fn(async ({ blockNumber }: any) => {
    expect(blockNumber).toBe(100n); if (fail) throw Error('private-provider-url');
    const state = { totalSupplyAssets: 1000000000n, totalSupplyShares: 1000000000n, totalBorrowAssets: 700000000n, totalBorrowShares: 700000000n, lastUpdate: 1n, fee: 0n };
    return { data: encodeFunctionResult({ abi: morphoMulticallAbi, functionName: 'aggregate3', result: [{ success: true, returnData: '0x' }, { success: true, returnData: encodeFunctionResult({ abi: morphoCoreAbi, functionName: 'market', result: state }) }] }) };
  });
  const client = { getChainId: async () => 1, getBlockNumber: async () => 100n, call, readContract: async ({ functionName, blockNumber }: any) => {
    expect(blockNumber).toBe(100n);
    if (functionName === 'position') return { supplyShares: inactive ? 0n : 1n, borrowShares: 0n, collateral: 0n };
    if (functionName === 'idToMarketParams') return params;
    if (functionName === 'symbol') return 'USDC'; if (functionName === 'decimals') return 6;
    throw Error('Unexpected read');
  } } as unknown as ChainClient;
  return { client, call };
}
it('reads pinned, accrued Morpho liquidity exactly and shares market reads across watched wallets', async () => {
  const f = fixture(), reader = createLiquidityAlertReader(() => f.client);
  const first = await reader(watch), second = await reader({ ...watch, address: '0x2222222222222222222222222222222222222222' });
  expect(first.status).toBe('ok'); expect(first.readings[0]).toMatchObject({ rawAmount: '300000000', decimals: 6, market: id, symbol: 'USDC', label: 'USDC / USDC', borrowApr: 0 });
  expect(second.readings).toEqual(first.readings); expect(f.call).toHaveBeenCalledTimes(1);
});
it('separates unreadable liquidity and inactive positions from real zero and never leaks RPC details', async () => {
  expect((await createLiquidityAlertReader(() => fixture(false, true).client)(watch)).status).toBe('inactive');
  const failure = await createLiquidityAlertReader(() => fixture(true).client)(watch);
  expect(failure.status).toBe('error'); expect(failure.readings).toEqual([]); expect(JSON.stringify(failure)).not.toContain('private-provider-url');
});

it('reads Fluid vault availability while verifying NFT ownership', async () => {
  const market = '0x2222222222222222222222222222222222222222';
  const client = { getChainId: async () => 1, getBlockNumber: async () => 100n, readContract: async ({ functionName, blockNumber }: any) => {
    expect(blockNumber).toBe(100n);
    if (functionName === 'positionByNftId') return [{ owner: token, supply: 1n, borrow: 1n }, { vault: market, isSmartDebt: false, constantVariables: { vaultId: 7n, borrow: market, borrowToken: { token0: token, token1: zero } }, limitsAndAvailability: { borrowable: 123456789n } }];
    if (functionName === 'decimals') return 6; if (functionName === 'symbol') return 'USDC'; throw Error('Unexpected read');
  } } as unknown as ChainClient;
  const reader = createLiquidityAlertReader(() => client);
  expect((await reader({ ...watch, protocol: 'fluid', positionId: 'fluid-nft-7' })).readings[0]).toMatchObject({ market, rawAmount: '123456789', decimals: 6 });
  expect((await reader({ ...watch, address: market, protocol: 'fluid', positionId: 'fluid-nft-7' })).status).toBe('inactive');
});
it('monitors Aave reserve liquidity with its virtual accounting and remaining borrow cap', async () => {
  const market = '0x2222222222222222222222222222222222222222';
  const client = { getChainId: async () => 1, getBlockNumber: async () => 100n, readContract: async ({ functionName, blockNumber }: any) => {
    expect(blockNumber).toBe(100n);
    switch (functionName) {
      case 'getPool': case 'getPoolDataProvider': case 'getPriceOracle': return market;
      case 'getUserAccountData': return [100000000n, 50000000n, 0n, 8500n, 8000n, 1700000000000000000n];
      case 'getUserEMode': return 0n;
      case 'getAllReservesTokens': return [{ symbol: 'USDC', tokenAddress: token }];
      case 'BASE_CURRENCY_UNIT': return 100000000n;
      case 'getUserReserveData': return [1000000n, 0n, 500000n, 0n, 0n, 0n, 0n, 0n, true];
      case 'getReserveConfigurationData': return [6n, 8000n, 8500n, 10500n, 1000n, true, true, false, true, false];
      case 'getAssetPrice': return 100000000n;
      case 'getConfiguration': return { data: (500n << 80n) | (1n << 56n) | (1n << 58n) };
      case 'getReserveData': return [0n, 0n, 0n, 0n, 100000000n, 0n, 0n, 0n, 0n, 0n, 0n, 1n];
      case 'getReserveTokensAddresses': return [market, market, market];
      case 'balanceOf': return 1000000000n;
      case 'getVirtualUnderlyingBalance': return 800000000n;
      case 'decimals': return 6;
      case 'symbol': return 'USDC';
      default: throw Error('Unsupported read');
    }
  } } as unknown as ChainClient;
  const result = await createLiquidityAlertReader(() => client)({ ...watch, protocol: 'aave-v3', positionId: 'aave-main' });
  expect(result.status).toBe('ok'); expect(result.readings[0]).toMatchObject({ market, rawAmount: '400000000' });
});

it('captures Morpho instantaneous borrowing APR at the liquidity block and keeps liquidity readable if its rate fails', async () => {
  for (const unavailable of [false, true]) {
    const f = fixture(), marketParams = { ...params, irm: token } as const;
    const marketId = keccak256(encodeAbiParameters(parseAbiParameters('address,address,address,address,uint256'), [marketParams.loanToken, marketParams.collateralToken, marketParams.oracle, marketParams.irm, marketParams.lltv]));
    const originalRead = f.client.readContract;
    f.client.readContract = (async (args: any) => args.functionName === 'idToMarketParams' ? marketParams : originalRead(args)) as any;
    f.call.mockImplementationOnce(f.call.getMockImplementation()!).mockImplementationOnce(async ({blockNumber}:any) => {
      expect(blockNumber).toBe(100n); if (unavailable) throw Error('private-provider-url');
      return {data: encodeFunctionResult({abi:morphoMulticallAbi,functionName:'aggregate3',result:[{success:true,returnData:'0x'},{success:true,returnData:encodeFunctionResult({abi:morphoIrmAbi,functionName:'borrowRateView',result:1000000000n})}]})};
    });
    const reader=createLiquidityAlertReader(()=>f.client), result=await reader({...watch,positionId:`morpho-market-${marketId}`});
    expect(result.status).toBe('ok');expect(result.readings[0]).toMatchObject({rawAmount:'300000000',borrowApr:unavailable?null:.031536});
    expect(f.call).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('private-provider-url');
  }
});
