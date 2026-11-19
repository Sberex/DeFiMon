import { formatUnits, parseAbi, type Address } from 'viem';
import type { ChainClient } from './rpc.js';
import type { MarketLiquidity } from '../src/market-comparison.js';
export const liquidityTokenAbi = parseAbi(['function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function balanceOf(address) view returns (uint256)']);
export const minimum = (...values: bigint[]) => values.reduce((a, b) => a < b ? a : b);
export const remaining = (limit: bigint, used: bigint) => limit > used ? limit - used : 0n;
export function liquidityQuote(raw: bigint, decimals: number, symbol: string, token: string, note: string): MarketLiquidity {
  if (typeof raw !== 'bigint' || raw < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 36 || typeof symbol !== 'string' || !symbol.length || symbol.length > 128) throw new Error('Invalid liquidity metadata');
  const amount = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(amount)) throw new Error('Invalid liquidity amount');
  return { amount, symbol, token, note };
}
export async function tokenMetadata(client: ChainClient, token: Address, blockNumber: bigint) {
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address: token, abi: liquidityTokenAbi, functionName: 'decimals', blockNumber }),
    client.readContract({ address: token, abi: liquidityTokenAbi, functionName: 'symbol', blockNumber }),
  ]);
  return { decimals, symbol };
}
const v4Abi = parseAbi([
 'function getAssetLiquidity(uint256) view returns (uint256)',
 'function getSpoke(uint256,address) view returns ((uint120 drawnShares,uint120 premiumShares,int200 premiumOffsetRay,uint120 addedShares,uint40 addCap,uint40 drawCap,uint24 riskPremiumThreshold,bool active,bool halted,uint200 deficitRay))',
 'function getSpokeTotalOwed(uint256,address) view returns (uint256)',
]);
export async function v4Liquidity(client: ChainClient, hub: Address, assetId: bigint, spoke: Address, token: Address, blockNumber: bigint): Promise<MarketLiquidity | null> {
  try {
    const [cash, config, owed, metadata] = await Promise.all([
      client.readContract({ address: hub, abi: v4Abi, functionName: 'getAssetLiquidity', args: [assetId], blockNumber }),
      client.readContract({ address: hub, abi: v4Abi, functionName: 'getSpoke', args: [assetId, spoke], blockNumber }),
      client.readContract({ address: hub, abi: v4Abi, functionName: 'getSpokeTotalOwed', args: [assetId, spoke], blockNumber }),
      tokenMetadata(client, token, blockNumber),
    ]);
    const used = owed + (config.deficitRay + 10n ** 27n - 1n) / 10n ** 27n;
    const capacity = BigInt(config.drawCap) === (1n << 40n) - 1n ? cash : remaining(BigInt(config.drawCap) * 10n ** BigInt(metadata.decimals), used);
    const raw = !config.active || config.halted ? 0n : minimum(cash, capacity);
    return liquidityQuote(raw, metadata.decimals, metadata.symbol, token, 'Hub available liquidity, limited by this Spoke’s remaining draw cap including owed debt and deficit. Account collateral and risk-premium thresholds can limit borrowing further.');
  } catch { return null; }
}
const aaveLiquidityAbi = parseAbi(['function getReserveTokensAddresses(address) view returns (address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress)']);
const poolAbi = parseAbi(['function getVirtualUnderlyingBalance(address) view returns (uint128)']);
const ghoAbi = parseAbi(['function getFacilitatorBucket(address) view returns (uint256 bucketCapacity,uint256 bucketLevel)']);
export async function aaveLiquidity(client: ChainClient, data: Address, pool: Address, token: Address, bits: bigint, decimals: number, debt: bigint, blockNumber: bigint, virtualLiquidity = true): Promise<MarketLiquidity | null> {
  try {
    const addresses = await client.readContract({ address: data, abi: aaveLiquidityAbi, functionName: 'getReserveTokensAddresses', args: [token], blockNumber });
    const [cash, metadata, bucket] = await Promise.all([
      client.readContract({ address: token, abi: liquidityTokenAbi, functionName: 'balanceOf', args: [addresses[0]], blockNumber }),
      tokenMetadata(client, token, blockNumber),
      client.readContract({ address: token, abi: ghoAbi, functionName: 'getFacilitatorBucket', args: [addresses[0]], blockNumber }).catch(() => null),
    ]);
    if (metadata.decimals !== decimals) throw new Error('Token precision mismatch');
    const minting = bucket !== null && bucket[0] > 0n;
    let available = minting ? remaining(bucket[0], bucket[1]) : cash;
    if (!minting && virtualLiquidity) {
      const virtual = await client.readContract({ address: pool, abi: poolAbi, functionName: 'getVirtualUnderlyingBalance', args: [token], blockNumber });
      available = minimum(available, virtual);
    }
    const cap = (bits >> 80n) & ((1n << 36n) - 1n);
    if (cap > 0n) available = minimum(available, remaining(cap * 10n ** BigInt(decimals), debt));
    return liquidityQuote(available, decimals, metadata.symbol, token, minting ? 'Remaining GHO facilitator mint capacity, limited by the reserve borrow cap. This is not an aToken cash balance.' : virtualLiquidity ? 'Underlying cash available to the reserve, limited by its virtual liquidity accounting and remaining borrow-cap headroom.' : 'Underlying cash held by the SparkLend reserve, limited by remaining borrow-cap headroom. This deployment does not use virtual liquidity accounting.');
  } catch { return null; }
}
export async function compoundLiquidity(client: ChainClient, market: Address, token: Address, blockNumber: bigint): Promise<MarketLiquidity | null> {
  try {
    const [cash, metadata] = await Promise.all([
      client.readContract({ address: token, abi: liquidityTokenAbi, functionName: 'balanceOf', args: [market], blockNumber }), tokenMetadata(client, token, blockNumber),
    ]);
    return liquidityQuote(cash, metadata.decimals, metadata.symbol, token, 'Base-token cash held by this Comet market, available for withdrawals and borrowing. Individual collateral requirements still apply.');
  } catch { return null; }
}
