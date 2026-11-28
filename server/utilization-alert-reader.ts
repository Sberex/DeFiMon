import { createCurveReader } from './curve-llamalend.js';
import { parseAbi, type Address, type Hex } from 'viem';
import type { ChainClient } from './rpc.js';
import type { NetworkId } from '../src/types.js';
import { createLiquidityAlertReader, type LiquidityWatch, type LiquidityObservation } from './liquidity-alert-reader.js';
import { accruedMorphoMarket } from './morpho-rates.js';
import { AAVE_HORIZON } from './deployments/aave-horizon.js';
import { SPARK_LEND } from './deployments/spark.js';
import { networks } from './networks.js';
import { fluidUtilizationAbi } from './abis/fluid-utilization.js';
export interface UtilizationWatch extends LiquidityWatch { thresholdPercent: number }
export interface UtilizationReading { market: string; marketAddress: string; token: string; symbol: string; label: string; utilizationPercent: number; note: string; borrowApr?: number | null }
export interface UtilizationObservation { watch: UtilizationWatch; checkedAt: string; blockNumber: string; status: 'ok' | 'error' | 'inactive' | 'unsupported'; readings: UtilizationReading[]; message?: string }
const abi = parseAbi([
  'function getUtilization() view returns(uint256)', 'function cash() view returns(uint256)', 'function totalBorrows() view returns(uint256)',
  'function getPoolDataProvider() view returns(address)', 'function getReserveTokensAddresses(address) view returns(address,address,address)',
  'function getReserveData(address) view returns(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40)',
  'function getVirtualUnderlyingBalance(address) view returns(uint128)', 'function balanceOf(address) view returns(uint256)',
  'function getAssetLiquidity(uint256) view returns(uint256)', 'function getAssetOwed(uint256) view returns(uint256,uint256)', 'function getAssetSwept(uint256) view returns(uint256)',
]);
export function utilizationPercent(borrowed: bigint, supplied: bigint) {
  if (borrowed < 0n || supplied < 0n || supplied === 0n && borrowed !== 0n) throw Error('Unavailable utilization denominator');
  const result = supplied === 0n ? 0 : Number(borrowed * 10n ** 14n / supplied) / 1e12;
  if (!Number.isFinite(result)) throw Error('Invalid utilization'); return result;
}
/** Verify active ownership using the existing market reader, then read utilization at that same block.
 * Borrow caps/withdrawal limits are never used as the utilization denominator. */
export function createUtilizationAlertReader(clientFor: (n: NetworkId) => ChainClient, now = Date.now, verify?: (watch: LiquidityWatch) => Promise<LiquidityObservation>) {
  const clients = new Map<NetworkId, ChainClient>();
  const client = (n: NetworkId) => { if (!clients.has(n)) clients.set(n, clientFor(n)); return clients.get(n)!; };
  const liquidity = verify ?? createLiquidityAlertReader(client, now), cache = new Map<string, Promise<UtilizationReading>>();
  return async (watch: UtilizationWatch): Promise<UtilizationObservation> => {
    const verified = await liquidity(watch);
    const base = { watch, checkedAt: verified.checkedAt, blockNumber: verified.blockNumber };
    if (verified.status !== 'ok') return { ...base, status: verified.status, readings: [], message: verified.status === 'inactive' ? 'Position is no longer active.' : 'Market utilization could not be verified; previous readings are retained.' };
    const block = BigInt(verified.blockNumber), c = client(watch.network);
    try {
      const readings: UtilizationReading[] = [];
      for (const q of verified.readings) {
        if (q.market.endsWith(':idle')) continue; // Unallocated vault cash has no lending utilization.
        const key = `${watch.network}:${watch.protocol}:${q.marketAddress}:${q.market}:${q.token}`;
        if (!cache.has(key)) cache.set(key, (async () => {
          const market = q.marketAddress as Address, token = q.token as Address;
          let percent: number, note: string;
          if (['morpho', 'lista', 'spark'].includes(watch.protocol) && /^0x[\da-f]{64}$/i.test(q.market)) {
            const { state } = await accruedMorphoMarket(c, market, q.market as Hex, block);
            percent = utilizationPercent(state.totalBorrowAssets, state.totalSupplyAssets); note = 'Accrued total loan assets borrowed / supplied × 100; excludes collateral TVL.';
          } else if (watch.protocol === 'aave-v3' || watch.protocol === 'spark' && watch.positionId === 'spark-main') {
            const spark = watch.protocol === 'spark';
            const provider = watch.positionId === 'aave-horizon-main' ? AAVE_HORIZON.provider : spark ? SPARK_LEND.provider : networks[watch.network].aaveProvider;
            const data = await c.readContract({ address: provider, abi, functionName: 'getPoolDataProvider', blockNumber: block });
            const reserve = await c.readContract({ address: data, abi, functionName: 'getReserveData', args: [token], blockNumber: block });
            let cash: bigint;
            if (spark) {
              const tokens = await c.readContract({ address: data, abi, functionName: 'getReserveTokensAddresses', args: [token], blockNumber: block });
              cash = await c.readContract({ address: token, abi, functionName: 'balanceOf', args: [tokens[0]], blockNumber: block });
            } else cash = await c.readContract({ address: market, abi, functionName: 'getVirtualUnderlyingBalance', args: [token], blockNumber: block });
            const debt = reserve[3] + reserve[4]; percent = utilizationPercent(debt, cash + debt); note = 'Reserve borrowing utilization: total stable and variable debt / (available underlying + debt) × 100. Borrow caps do not change utilization.';
          } else if (watch.protocol === 'euler') {
            const [cash, debt] = await Promise.all([c.readContract({ address: market, abi, functionName: 'cash', blockNumber: block }), c.readContract({ address: market, abi, functionName: 'totalBorrows', blockNumber: block })]);
            percent = utilizationPercent(debt, cash + debt); note = 'Euler total borrows / (cash + total borrows) × 100, before borrow caps.';
          } else if (watch.protocol === 'curve-llamalend') {
            const reader = createCurveReader(c, watch.network, block), catalog = await reader.catalog();
            const m = catalog.markets.find(m => m.controller.toLowerCase() === q.marketAddress.toLowerCase());
            if (!m) throw Error('Unknown Curve market');
            const stats = await reader.quote(m);
            percent = utilizationPercent(stats.debt, stats.total); note = 'Curve total outstanding loan debt / total lending vault assets × 100. Borrow caps do not change utilization.';
          } else if (watch.protocol === 'compound') {
            percent = Number(await c.readContract({ address: market, abi, functionName: 'getUtilization', blockNumber: block })) / 1e16; note = 'Compound Comet native on-chain utilization × 100.';
          } else if (watch.protocol === 'fluid') {
            // Same verified resolver deployment on all five supported networks:
            // fluid-contracts-public@404d73f deployments/{mainnet,arbitrum,base,plasma,bnb}/LiquidityResolver.json.
            const asset = q.symbol === networks[watch.network].nativeSymbol && q.token.toLowerCase() === networks[watch.network].wrappedNative.toLowerCase() ? '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Address : token;
            const data = await c.readContract({ address: '0xca13A15de31235A37134B4717021C35A3CF25C60', abi: fluidUtilizationAbi, functionName: 'getOverallTokenData', args: [asset], blockNumber: block });
            percent = utilizationPercent(data.totalBorrow, data.totalSupply); note = 'Fluid underlying-token Liquidity-layer total borrow / total supply × 100, including accrued exchange prices. Shared across vaults using this asset; not the vault collateral/debt ratio.';
          } else if (watch.protocol === 'aave-v4') {
            const parts = q.market.split(':'), hub = parts.at(-2) as Address, assetId = BigInt(parts.at(-1)!);
            const [cash, owed, swept] = await Promise.all([c.readContract({ address: hub, abi, functionName: 'getAssetLiquidity', args: [assetId], blockNumber: block }), c.readContract({ address: hub, abi, functionName: 'getAssetOwed', args: [assetId], blockNumber: block }), c.readContract({ address: hub, abi, functionName: 'getAssetSwept', args: [assetId], blockNumber: block })]);
            percent = utilizationPercent(owed[0], cash + owed[0] + swept); note = 'Aave v4 native interest-model usage: drawn debt / (Hub liquidity + drawn debt + swept assets) × 100; excludes premium debt and Spoke draw caps.';
          } else throw Error('Unsupported utilization');
          if (!Number.isFinite(percent) || percent < 0) throw Error('Invalid utilization');
          return { market: q.market, marketAddress: q.marketAddress, token: q.token, symbol: q.symbol, label: q.label, utilizationPercent: percent, note, borrowApr: q.borrowApr ?? null };
        })());
        readings.push(await cache.get(key)!);
      }
      return readings.length ? { ...base, status: 'ok', readings } : { ...base, status: 'unsupported', readings: [], message: 'No allocated lending market has a verified utilization metric.' };
    } catch { return { ...base, status: 'error', readings: [], message: 'Market utilization could not be verified; previous readings are retained.' }; }
  };
}
