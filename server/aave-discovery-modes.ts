import { parseAbi, type Address } from 'viem';
import type {
  DiscoveryMarket,
  DiscoveryResult,
  BorrowingMode,
} from '../src/market-discovery.js';
import type { NetworkId } from '../src/types.js';
import { networks } from './networks.js';
import { AAVE_HORIZON } from './deployments/aave-horizon.js';
import type { ChainClient } from './rpc.js';
// Official bgd-labs/aave-address-book AaveV3{chain}.sol UI_POOL_DATA_PROVIDER.
export const AAVE_DISCOVERY_UI: Partial<Record<NetworkId, Address>> = {
  ethereum: '0x2dAd8162A989cd99D673dE4425Bb2298Db1E1aA2',
  plasma: '0x2E549104c516b8657A7D888494DfbAbD7C70b464',
  arbitrum: '0x91E04cf78e53aEBe609e8a7f2003e7EECD743F2B',
  base: '0x0C6BC4a12039788be08F87e87Cff87FEDbd1D386',
  bsc: '0x68100bD5345eA474D93577127C11F39FF8463e93',
};
// IUiPoolDataProviderV3.getEModes from aave/aave-utilities. Includes the
// per-category zero-LTV bitmap: a high liquidation threshold alone is insufficient.
const uiAbi = parseAbi([
  'function getEModes(address provider) view returns ((uint8 id,(uint16 ltv,uint16 liquidationThreshold,uint16 liquidationBonus,uint128 collateralBitmap,bool isolated,string label,uint128 borrowableBitmap,uint128 ltvzeroBitmap) eMode)[])',
]);
const providerAbi = parseAbi(['function getPool() view returns(address)']);
const poolAbi = parseAbi([
  'function getReserveData(address) view returns (((uint256 data) configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))',
]);
export async function aaveDiscoveryModes(
  markets: DiscoveryMarket[],
  client: ChainClient,
  network: NetworkId,
  block: bigint,
): Promise<{
  markets: DiscoveryMarket[];
  coverage: DiscoveryResult['coverage'];
  messages: string[];
}> {
  const relevant = markets.filter(
    (m) => ['Aave v3', 'Aave Horizon'].includes(m.protocol) && m.borrowAsset,
  );
  if (!relevant.length) return { markets, coverage: [], messages: [] };
  let incomplete = false;
  const groups = new Map<
    string,
    Promise<{ pool: Address; modes: Awaited<ReturnType<typeof readModes>> }>
  >();
  const reserves = new Map<string, Promise<number>>();
  async function readModes(provider: Address) {
    const result = await client.readContract({
      address: AAVE_DISCOVERY_UI[network]!,
      abi: uiAbi,
      functionName: 'getEModes',
      args: [provider],
      blockNumber: block,
    });
    const ids = new Set<number>();
    if (result.length > 255) throw Error('Invalid eMode enumeration');
    for (const { id, eMode: m } of result) {
      if (
        !Number.isInteger(id) ||
        id < 1 ||
        id > 255 ||
        ids.has(id) ||
        !Number.isInteger(m.ltv) ||
        m.ltv < 0 ||
        m.ltv > m.liquidationThreshold ||
        m.liquidationThreshold > 10000 ||
        typeof m.label !== 'string' ||
        typeof m.collateralBitmap !== 'bigint' ||
        typeof m.borrowableBitmap !== 'bigint' ||
        typeof m.ltvzeroBitmap !== 'bigint'
      )
        throw Error('Invalid eMode configuration');
      ids.add(id);
    }
    return result;
  }
  function group(provider: Address) {
    if (!groups.has(provider))
      groups.set(
        provider,
        (async () => {
          const [pool, modes] = await Promise.all([
            client.readContract({
              address: provider,
              abi: providerAbi,
              functionName: 'getPool',
              blockNumber: block,
            }),
            readModes(provider),
          ]);
          return { pool, modes };
        })(),
      );
    return groups.get(provider)!;
  }
  function reserveId(pool: Address, token: string) {
    const key = `${pool.toLowerCase()}:${token.toLowerCase()}`;
    if (!reserves.has(key))
      reserves.set(
        key,
        client
          .readContract({
            address: pool,
            abi: poolAbi,
            functionName: 'getReserveData',
            args: [token as Address],
            blockNumber: block,
          })
          .then((r) => {
            if (!Number.isInteger(r.id) || r.id < 0 || r.id >= 128)
              throw Error('Invalid reserve ID');
            return r.id;
          }),
      );
    return reserves.get(key)!;
  }
  const result = await Promise.all(
    markets.map(async (m) => {
      if (!relevant.includes(m)) return m;
      const modes: BorrowingMode[] = [];
      if (
        typeof m.collateralLtv === 'number' &&
        Number.isFinite(m.collateralLtv) &&
        m.collateralLtv > 0 &&
        m.lltv !== null &&
        m.collateralLtv <= m.lltv &&
        m.lltv <= 1
      )
        modes.push({
          id: 0,
          label: 'Standard collateral',
          ltv: m.collateralLtv,
          lltv: m.lltv,
        });
      try {
        const provider =
          m.protocol === 'Aave Horizon'
            ? AAVE_HORIZON.provider
            : networks[network].aaveProvider;
        const { pool, modes: categories } = await group(provider);
        if (pool.toLowerCase() !== m.market.toLowerCase())
          throw Error('Aave pool mismatch');
        const [supplyId, borrowId] = await Promise.all([
          reserveId(pool, m.supplyAsset.address),
          reserveId(pool, m.borrowAsset!.address),
        ]);
        const supplied = 1n << BigInt(supplyId),
          borrowed = 1n << BigInt(borrowId);
        for (const { id, eMode: c } of categories)
          if (
            c.ltv > 0 &&
            (c.collateralBitmap & supplied) !== 0n &&
            (c.borrowableBitmap & borrowed) !== 0n &&
            (c.ltvzeroBitmap & supplied) === 0n
          )
            modes.push({
              id,
              label: c.label,
              ltv: c.ltv / 10000,
              lltv: c.liquidationThreshold / 10000,
            });
      } catch {
        incomplete = true;
      }
      return { ...m, borrowingModes: modes };
    }),
  );
  return {
    markets: result,
    coverage: [
      {
        protocol: 'Aave borrowing modes',
        network,
        status: incomplete ? 'partial' : 'ok',
        message: incomplete
          ? 'Some eMode configurations could not be verified. Only verified standard/eMode collateral limits are used.'
          : undefined,
      },
    ],
    messages: [],
  };
}
