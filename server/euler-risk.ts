import type { Address } from 'viem';
import type { Position } from '../src/types.js';
import type { ChainClient } from './rpc.js';
import { eulerVaultAbi, eulerOracleAbi, eulerOracleConfigAbi } from './abis/euler.js';
import { eulerAddress } from './euler.js';
/** Check native Euler collateral routes even if independent USD prices exist. */
export async function readEulerCollateralOracles(client: ChainClient, market: Address, heldCollateral: Address[] | undefined, blockNumber: bigint, vault: (address: Address) => Promise<{ symbol: string; decimals: number }>): Promise<NonNullable<Position['collateralOracleChecks']>> {
  let collaterals: Address[];
  try {
    collaterals = heldCollateral ?? (await client.readContract({ address: market, abi: eulerVaultAbi, functionName: 'LTVList', blockNumber })).map(eulerAddress);
    if (collaterals.length > 256) throw new Error('Unsupported collateral count');
    if (!heldCollateral) collaterals = (await Promise.all(collaterals.map(async address => (await client.readContract({ address: market, abi: eulerVaultAbi, functionName: 'LTVLiquidation', args: [address], blockNumber })) > 0 ? address : null))).filter((a): a is Address => a !== null);
  } catch { return [{ asset: 'Euler market collateral', oracle: market, status: 'unavailable' }]; }
  if (!collaterals.length) return [];
  let oracle: Address, unit: Address;
  try {
    [oracle, unit] = await Promise.all([
      client.readContract({ address: market, abi: eulerOracleConfigAbi, functionName: 'oracle', blockNumber }),
      client.readContract({ address: market, abi: eulerOracleConfigAbi, functionName: 'unitOfAccount', blockNumber }),
    ]);
  } catch { return [{ asset: 'Euler market collateral', oracle: market, status: 'unavailable' }]; }
  return Promise.all([...new Set(collaterals)].map(async address => {
    let symbol: string = address;
    try {
      const info = await vault(address); symbol = info.symbol;
      if (address.toLowerCase() === unit.toLowerCase()) return { asset: symbol, oracle, status: 'ok' as const };
      if (/^0x0{40}$/i.test(oracle)) throw new Error('No oracle');
      const price = await client.readContract({ address: oracle, abi: eulerOracleAbi, functionName: 'getQuote', args: [10n ** BigInt(info.decimals), address, unit], blockNumber });
      return { asset: symbol, oracle, status: price > 0n ? 'ok' as const : 'zero' as const };
    } catch { return { asset: symbol, oracle, status: 'unavailable' as const }; }
  }));
}
