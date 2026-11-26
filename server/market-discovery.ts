import { applyPtCollateralRates } from './pendle-collateral.js';
import { slisBnbStakingApr, SLISBNB } from './slisbnb-rates.js';
import type { Address } from 'viem';
import type {
  DiscoveryQuery,
  DiscoveryResult,
  DiscoveryAsset,
  DiscoveryMarket,
} from '../src/market-discovery.js';
import {
  configuredTokenRegistry,
  configuredTokenCategory,
} from './token-registry.js';
import { networkOrder, networkNames } from '../src/networks.js';
import { marketReaders } from './market-search.js';
import {
  limited,
  createAaveMarketReader,
  type Target,
  type Reader,
} from './market-readers.js';
import { networks } from './networks.js';
import { AAVE_HORIZON } from './deployments/aave-horizon.js';
import {
  CURVE_FACTORIES,
  CURVE_NAME,
  curveCoverage,
} from './deployments/curve-llamalend.js';
import { makeClient, type ChainClient } from './rpc.js';
import { tokenMetadata, liquidityTokenAbi } from './market-liquidity.js';
import { walletPrices } from './wallet-prices.js';
import { intrinsicTokenRate } from './intrinsic-rates.js';
import { lidoStakingApr, LIDO_WSTETH } from './lido-rates.js';
import type { NetworkId, IntrinsicRate } from '../src/types.js';
export function parseDiscoveryQuery(value: unknown): DiscoveryQuery {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    Object.keys(value).some((k) => !['supply', 'borrow'].includes(k))
  )
    throw Error(
      'Choose a configured Supply asset and Borrow asset, or Any asset.',
    );
  const q = value as DiscoveryQuery;
  for (const v of [q.supply, q.borrow])
    if (
      v !== null &&
      (typeof v !== 'string' || !Object.hasOwn(configuredTokenRegistry, v))
    )
      throw Error(
        'Choose a configured Supply asset and Borrow asset, or Any asset.',
      );
  return { supply: q.supply, borrow: q.borrow };
}
export function discoveryTargets(
  query: DiscoveryQuery,
  network: NetworkId,
): Target[] {
  const supply =
      query.supply === null
        ? undefined
        : configuredTokenRegistry[query.supply]?.addresses[network],
    borrow =
      query.borrow === null
        ? undefined
        : configuredTokenRegistry[query.borrow]?.addresses[network];
  if ((query.supply !== null && !supply) || (query.borrow !== null && !borrow))
    return [];
  const t: Target = {
    id: 'discovery-loans',
    network,
    supplied: supply ?? '*',
    borrowed: borrow ?? '*',
    supplies: supply ? [supply] : [],
    borrows: borrow ? [borrow] : [],
    allSupplies: supply ? [supply] : [],
    allBorrows: borrow ? [borrow] : [],
    discovery: true,
    anySupply: query.supply === null,
    anyBorrow: query.borrow === null,
  };
  return [
    t,
    ...(query.borrow === null
      ? [
          {
            ...t,
            id: 'discovery-deposits',
            borrowed: undefined,
            anyBorrow: false,
          },
        ]
      : []),
  ];
}
const valid = (address: unknown): address is Address =>
  typeof address === 'string' &&
  /^0x[\da-f]{40}$/i.test(address) &&
  !/^0x0{40}$/i.test(address);
export function createMarketDiscovery(
  options: {
    clientFor?: (n: NetworkId) => ChainClient;
    sources?: typeof marketReaders;
    prices?: typeof walletPrices;
    intrinsic?: typeof intrinsicTokenRate;
    lido?: typeof lidoStakingApr;
    pt?: typeof applyPtCollateralRates;
    slis?: typeof slisBnbStakingApr;
  } = {},
) {
  const clientFor = options.clientFor ?? makeClient,
    sources = options.sources ?? marketReaders,
    priceReader = options.prices ?? walletPrices,
    intrinsic = options.intrinsic ?? intrinsicTokenRate,
    lido = options.lido ?? lidoStakingApr,
    pt = options.pt ?? applyPtCollateralRates,
    slis = options.slis ?? slisBnbStakingApr;
  const horizon = createAaveMarketReader(
    () => AAVE_HORIZON.provider,
    'Aave Horizon',
  );
  return async (input: DiscoveryQuery): Promise<DiscoveryResult> => {
    const query = parseDiscoveryQuery(input),
      coverage: DiscoveryResult['coverage'] = [],
      messages: string[] = [];
    const results = await Promise.all(
      networkOrder.map(async (network) => {
        const targets = discoveryTargets(query, network);
        if (!targets.length) return [];
        if (!CURVE_FACTORIES[network].length && sources['curve-llamalend'])
          coverage.push({
            protocol: CURVE_NAME,
            network,
            status: 'unsupported',
            message: curveCoverage(network),
          });
        try {
          const client = clientFor(network),
            [chain, block] = await Promise.all([
              client.getChainId(),
              client.getBlockNumber(),
            ]);
          if (chain !== networks[network].id) throw Error('Wrong network');
          const jobs = networks[network].protocolIds
            .map((id) => sources[id])
            .filter(Boolean);
          if (network === 'ethereum' && !options.sources)
            jobs.push({ name: 'Aave Horizon', read: horizon });
          const rows = (
            await Promise.all(
              jobs.map(async (source) => {
                const warnings = new Set<string>();
                try {
                  const found = await source.read(
                    client,
                    network,
                    block,
                    targets,
                    (w) => warnings.add(w),
                  );
                  const kept = found
                    .filter((m) => {
                      const s = m.marketTokens?.supplied,
                        b = m.marketTokens?.borrowed;
                      const validPair =
                        valid(s) &&
                        (!b || valid(b)) &&
                        (query.supply === null ||
                          configuredTokenRegistry[query.supply].addresses[
                            network
                          ] === s.toLowerCase()) &&
                        (query.borrow === null ||
                          (!!b &&
                            configuredTokenRegistry[query.borrow].addresses[
                              network
                            ] === b.toLowerCase()));
                      if (
                        !validPair ||
                        m.network !== network ||
                        m.block !== String(block) ||
                        (m.requiredTokens &&
                          [
                            ...m.requiredTokens.supplied,
                            ...m.requiredTokens.borrowed,
                          ].some((a) => !valid(a))) ||
                        !Number.isFinite(m.supplyApr) ||
                        (m.borrowApr !== null && !Number.isFinite(m.borrowApr))
                      ) {
                        warnings.add(
                          'Some market asset identities or rates could not be verified and were omitted.',
                        );
                        return false;
                      }
                      return true;
                    })
                    .map((m) => {
                      if (
                        m.liquidity &&
                        (!valid(m.liquidity.token) ||
                          m.liquidity.token.toLowerCase() !==
                            (
                              m.marketTokens!.borrowed ??
                              m.marketTokens!.supplied
                            ).toLowerCase() ||
                          !Number.isFinite(m.liquidity.amount) ||
                          m.liquidity.amount < 0)
                      ) {
                        warnings.add(
                          'Some market liquidity units could not be verified; that liquidity is unavailable.',
                        );
                        return { ...m, liquidity: null };
                      }
                      return m;
                    });
                  coverage.push({
                    protocol: source.name,
                    network,
                    status: warnings.size ? 'partial' : 'ok',
                    message: warnings.size
                      ? [...warnings].join(' ')
                      : undefined,
                  });
                  return kept;
                } catch {
                  coverage.push({
                    protocol: source.name,
                    network,
                    status: 'error',
                    message:
                      'This market source could not be checked. Additional markets may exist.',
                  });
                  return [];
                }
              }),
            )
          ).flat();
          const spark = new Set(
            rows
              .filter((r) => r.protocol === 'Spark')
              .map(
                (r) =>
                  `${r.market.toLowerCase()}:${r.marketTokens?.supplied}:${r.marketTokens?.borrowed}`,
              ),
          );
          const seen = new Set<string>();
          const distinct = rows.filter((r) => {
            if (
              r.protocol === 'Morpho' &&
              spark.has(
                `${r.market.toLowerCase()}:${r.marketTokens?.supplied}:${r.marketTokens?.borrowed}`,
              )
            )
              return false;
            const key = `${r.protocol}:${r.market.toLowerCase()}:${r.route ?? ''}:${r.marketTokens?.supplied}:${r.marketTokens?.borrowed ?? ''}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          const addresses = [
            ...new Set(
              distinct
                .flatMap((r) => [
                  r.marketTokens!.supplied,
                  ...(r.marketTokens!.borrowed
                    ? [r.marketTokens!.borrowed]
                    : []),
                  ...(r.requiredTokens?.supplied ?? []),
                  ...(r.requiredTokens?.borrowed ?? []),
                ])
                .map((a) => a.toLowerCase()),
            ),
          ];
          const metadata = new Map<
            string,
            { asset: DiscoveryAsset; decimals: number | null }
          >();
          const chunks = Array.from(
            { length: Math.ceil(addresses.length / 50) },
            (_, i) => addresses.slice(i * 50, (i + 1) * 50),
          );
          await limited(
            chunks,
            async (chunk) => {
              const results =
                typeof client.multicall === 'function'
                  ? await client.multicall({
                      contracts: chunk.flatMap((address) => [
                        {
                          address: address as Address,
                          abi: liquidityTokenAbi,
                          functionName: 'decimals' as const,
                        },
                        {
                          address: address as Address,
                          abi: liquidityTokenAbi,
                          functionName: 'symbol' as const,
                        },
                      ]),
                      blockNumber: block,
                      allowFailure: true,
                      batchSize: 8192,
                    })
                  : null;
              if (results && results.length !== chunk.length * 2)
                throw Error('Incomplete token metadata');
              await Promise.all(
                chunk.map(async (address, i) => {
                  const group = Object.entries(configuredTokenRegistry).find(
                    ([, t]) => t.addresses[network] === address,
                  )?.[0];
                  const precision = results?.[i * 2],
                    symbol = results?.[i * 2 + 1];
                  const meta = results
                    ? {
                        decimals:
                          precision?.status === 'success' &&
                          typeof precision.result === 'number' &&
                          precision.result >= 0 &&
                          precision.result <= 36
                            ? precision.result
                            : null,
                        symbol:
                          symbol?.status === 'success' &&
                          typeof symbol.result === 'string' &&
                          symbol.result.length > 0 &&
                          symbol.result.length <= 128
                            ? symbol.result
                            : null,
                      }
                    : await tokenMetadata(
                        client,
                        address as Address,
                        block,
                      ).catch(() => null);
                  if (!meta || meta.decimals === null || !meta.symbol)
                    messages.push(
                      `${networkNames[network]}: Some token metadata is unavailable; verified contract addresses are retained.`,
                    );
                  metadata.set(address, {
                    asset: {
                      address,
                      name: meta?.symbol ?? group ?? `${address.slice(0, 8)}…`,
                      category:
                        configuredTokenCategory(network, address) ?? 'Other',
                    },
                    decimals: meta?.decimals ?? null,
                  });
                }),
              );
            },
            () =>
              messages.push(
                `${networkNames[network]}: Some token metadata could not be checked; contract addresses are retained.`,
              ),
          );
          // Keep verified addresses when a metadata scan reaches its time limit.
          for (const address of addresses)
            if (!metadata.has(address))
              metadata.set(address, {
                asset: {
                  address,
                  name: address.slice(0, 10) + '…',
                  category:
                    configuredTokenCategory(network, address) ?? 'Other',
                },
                decimals: null,
              });
          const liquidityTokens=new Set(distinct.flatMap(row=>row.liquidity?[row.liquidity.token.toLowerCase()]:[]));
          const pricedTokens = [...metadata].flatMap(([address, m]) =>
            liquidityTokens.has(address) && m.decimals !== null
              ? [{ address: address as Address, decimals: m.decimals }]
              : [],
          );
          const prices = await priceReader(
            client,
            network,
            block,
            pricedTokens,
          ).catch(() => new Map<string, number>());
          const ptInput: import('../src/types.js').ProtocolResult[] = [
            {
              id: 'discovery',
              name: 'Market discovery',
              status: 'ok',
              coverage: '',
              positions: [
                {
                  id: 'discovery',
                  label: 'Discovery collateral',
                  suppliedUsd: null,
                  debtUsd: 0,
                  healthFactor: null,
                  risk: 'no-debt',
                  notes: [],
                  assets: [...metadata.values()].map((m) => ({
                    address: m.asset.address,
                    symbol: m.asset.name,
                    supplied: 1,
                    borrowed: 0,
                    priceUsd: null,
                    collateral: true,
                    liquidationThreshold: null,
                    liquidationPriceUsd: null,
                    supplyRate: { apr: 0, note: '' },
                  })),
                },
              ],
            },
          ];
          const ptAssets = (
            await pt(ptInput, client, network, block).catch(() => ptInput)
          )[0].positions[0].assets;
          const ptRates = new Map(
            ptAssets
              .filter((a) => a.supplyRate?.pendlePt)
              .map((a) => [a.address.toLowerCase(), a.supplyRate!]),
          );
          const income = new Map<string, Promise<IntrinsicRate | undefined>>();
          function incomeFor(address: string) {
            if (!income.has(address))
              income.set(
                address,
                (async () =>
                  address === LIDO_WSTETH[network]?.toLowerCase()
                    ? await lido()
                    : network === 'bsc' && address === SLISBNB
                      ? await slis()
                      : await intrinsic(network, address))().catch(
                  () => undefined,
                ),
              );
            return income.get(address)!;
          }
          return await Promise.all(
            distinct.map(async (row) => {
              const supplyAsset = {
                  ...metadata.get(row.marketTokens!.supplied.toLowerCase())!
                    .asset,
                },
                borrowAsset = row.marketTokens!.borrowed
                  ? {
                      ...metadata.get(row.marketTokens!.borrowed.toLowerCase())!
                        .asset,
                    }
                  : null;
              const interestBearing =
                supplyAsset.category === 'Savings stablecoin' ||
                supplyAsset.address === LIDO_WSTETH[network]?.toLowerCase() ||
                (network === 'bsc' && supplyAsset.address === SLISBNB);
              const quote = interestBearing
                ? await incomeFor(supplyAsset.address)
                : undefined;
              const extra = interestBearing ? (quote?.apr ?? null) : 0;
              const price = row.liquidity
                ? prices.get(row.liquidity.token.toLowerCase())
                : undefined;
              const liquidityUsd =
                row.liquidity && price !== undefined
                  ? row.liquidity.amount * price
                  : null;
              return {
                ...row,
                ...(row.protocol === 'Aave v3'
                  ? {
                      url: `https://app.aave.com/?marketName=${{ ethereum: 'proto_mainnet_v3', plasma: 'proto_plasma_v3', arbitrum: 'proto_arbitrum_v3', base: 'proto_base_v3', bsc: 'proto_bnb_v3' }[network]}`,
                    }
                  : {}),
                ...(row.protocol === 'Compound'
                  ? {
                      url: `https://app.compound.xyz/markets/${(networks[network].compoundMarkets.find((m) => m.address.toLowerCase() === row.market.toLowerCase())?.label.replace(/ market$/, '') ?? borrowAsset?.name ?? supplyAsset.name).toLowerCase()}-${network}`,
                    }
                  : {}),
                ...(row.protocol === 'Aave Horizon'
                  ? { url: 'https://app.aave.com/?marketName=proto_horizon_v3' }
                  : {}),
                supplyAsset: { ...supplyAsset, intrinsicApr: extra },
                borrowAsset,
                ...(row.requiredTokens
                  ? {
                      requiredSupplyAssets: row.requiredTokens.supplied.map(
                        (a) => metadata.get(a.toLowerCase())!.asset,
                      ),
                      requiredBorrowAssets: row.requiredTokens.borrowed.map(
                        (a) => metadata.get(a.toLowerCase())!.asset,
                      ),
                    }
                  : {}),
                supplyRateNote:
                  ptRates.get(supplyAsset.address)?.note ?? quote?.note,
                totalSupplyApr: ptRates.has(supplyAsset.address)
                  ? ptRates.get(supplyAsset.address)!.apr
                  : extra === null
                    ? null
                    : row.supplyApr + extra,
                liquidityUsd:
                  liquidityUsd !== null && Number.isFinite(liquidityUsd)
                    ? liquidityUsd
                    : null,
              } satisfies DiscoveryMarket;
            }),
          );
        } catch {
          for (const id of networks[network].protocolIds)
            coverage.push({
              protocol: sources[id]?.name ?? id,
              network,
              status: 'error',
              message:
                'Network provider unavailable; these markets remain unchecked.',
            });
          return [];
        }
      }),
    );
    if (!networkOrder.some((n) => discoveryTargets(query, n).length))
      messages.push(
        'The selected assets have no matching deployments on the five supported chains.',
      );
    return {
      query,
      checkedAt: new Date().toISOString(),
      markets: results.flat(),
      coverage,
      messages: [...new Set(messages)],
    };
  };
}
export const discoverMarkets = createMarketDiscovery();
