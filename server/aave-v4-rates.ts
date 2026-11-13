import { parseAbi, type Address } from 'viem';
import type { ChainClient } from './rpc.js';
import { rate, rayApr, unavailableRate } from './rates.js';
const hubAbi = parseAbi([
  'function getAsset(uint256 assetId) view returns ((uint120 liquidity,uint120 realizedFees,uint8 decimals,uint120 addedShares,uint120 swept,int200 premiumOffsetRay,uint120 drawnShares,uint120 premiumShares,uint16 liquidityFee,uint120 drawnIndex,uint96 drawnRate,uint40 lastUpdateTimestamp,address underlying,address irStrategy,address reinvestmentController,address feeReceiver,uint200 deficitRay))',
  'function getAddedAssets(uint256 assetId) view returns (uint256)',
  'function getAssetDrawnIndex(uint256 assetId) view returns (uint256)',
  'function getAssetDrawnRate(uint256 assetId) view returns (uint256)',
]);
export function v4SupplyApr(baseApr: number, interestAssets: number, addedAssets: bigint, feeBps: number) {
  if (feeBps < 0 || feeBps > 10000) throw new Error('Invalid hub fee');
  // V4 share conversion includes 1e6 virtual assets and shares.
  return baseApr * interestAssets / Number(addedAssets + 1_000_000n) * (1 - feeBps / 10000);
}
export async function readV4HubRates(client: ChainClient, hub: Address, assetId: bigint, underlying: Address, blockNumber: bigint) {
  try {
    const [asset, added, index, rawRate] = await Promise.all([
      client.readContract({ address: hub, abi: hubAbi, functionName: 'getAsset', args: [assetId], blockNumber }),
      client.readContract({ address: hub, abi: hubAbi, functionName: 'getAddedAssets', args: [assetId], blockNumber }),
      client.readContract({ address: hub, abi: hubAbi, functionName: 'getAssetDrawnIndex', args: [assetId], blockNumber }),
      client.readContract({ address: hub, abi: hubAbi, functionName: 'getAssetDrawnRate', args: [assetId], blockNumber }),
    ]);
    if (asset.underlying.toLowerCase() !== underlying.toLowerCase() || index <= 0n) throw new Error('Invalid hub identity/index');
    const baseApr = rayApr(rawRate);
    const interestAssets = Number(asset.drawnShares + asset.premiumShares) * Number(index) / 1e27;
    return { baseApr, index, supplyRate: rate(v4SupplyApr(baseApr, interestAssets, added, asset.liquidityFee), 'Current Hub interest APR after liquidity fees, including premium interest. Excludes reinvestment income and external reward tokens.', asset.swept > 0n) };
  } catch { return null; }
}
export function v4BorrowRate(hub: Awaited<ReturnType<typeof readV4HubRates>>, user: { drawnShares: bigint; premiumShares: bigint }, totalDebt: bigint) {
  if (!hub || totalDebt <= 0n) return unavailableRate();
  const interestAssets = Number(user.drawnShares + user.premiumShares) * Number(hub.index) / 1e27;
  return rate(hub.baseApr * interestAssets / Number(totalDebt), 'Current effective borrowing APR on total debt, including the wallet’s stored risk-premium shares.', true);
}
