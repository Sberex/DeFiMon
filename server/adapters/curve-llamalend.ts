import type { Address } from 'viem';
import type {
  NetworkId,
  Position,
  ProtocolResult,
  Asset,
} from '../../src/types.js';
import type { ChainClient } from '../rpc.js';
import {
  createCurveReader,
  curveControllerAbi,
  curveVaultAbi,
  curveUnits,
  type CurveMarket,
} from '../curve-llamalend.js';
import {
  CURVE_FACTORIES,
  CURVE_NAME,
  curveCoverage,
} from '../deployments/curve-llamalend.js';
import { limited } from '../market-readers.js';
import { walletPrices } from '../wallet-prices.js';
import { rate, unavailableRate } from '../rates.js';
const usd = (amount: number, price: number | null) =>
  amount === 0 ? 0 : price === null ? null : amount * price;
export async function readCurveLlamalend(
  client: ChainClient,
  wallet: Address,
  block: bigint,
  network: NetworkId = 'ethereum',
): Promise<ProtocolResult> {
  if (!CURVE_FACTORIES[network].length)
    return {
      id: 'curve-llamalend',
      name: CURVE_NAME,
      status: 'ok',
      coverage: curveCoverage(network),
      positions: [],
    };
  const reader = createCurveReader(client, network, block),
    catalog = await reader.catalog(),
    warnings = new Set<string>();
  let complete = catalog.complete;
  const warn = (message: string) => {
    warnings.add(message);
  };
  if (!complete)
    warn(
      'Some Curve factory markets could not be discovered; additional positions are unknown.',
    );
  const owned = await limited(
    catalog.markets,
    async (market) => ({ market, ...(await reader.ownership(market, wallet)) }),
    () => {
      complete = false;
      warn('Some Curve wallet or gauge balances could not be checked.');
    },
  );
  const positions = (
    await limited(
      owned.filter((o) => o.loan || o.shares > 0n || o.staked > 0n),
      async (o) => {
        const m = o.market,
          info = await reader.info(m);
        const [stats, prices, oracle] = await Promise.all([
          reader.quote(m).catch(() => {
            warn(
              'Some Curve rates or liquidity data are unavailable; balances are retained.',
            );
            return null;
          }),
          walletPrices(client, network, block, [
            { address: m.borrowed, decimals: info.loan.decimals },
            { address: m.collateral, decimals: info.coll.decimals },
          ]),
          reader.oracle(m).catch(() => null),
        ]);
        let loanPrice = prices.get(m.borrowed) ?? null,
          collPrice = prices.get(m.collateral) ?? null;
        if (oracle !== null) {
          if (collPrice === null && loanPrice !== null)
            collPrice = oracle * loanPrice;
          else if (loanPrice === null && collPrice !== null)
            loanPrice = collPrice / oracle;
        }
        const out: Position[] = [];
        if (o.shares + o.staked > 0n) {
          const assets = await client.readContract({
            address: m.vault,
            abi: curveVaultAbi,
            functionName: 'convertToAssets',
            args: [o.shares + o.staked],
            blockNumber: block,
          });
          const supplied = curveUnits(assets, info.loan.decimals),
            value = usd(supplied, loanPrice);
          out.push({
            id: `curve-vault-${m.controller}`,
            label: `Curve lending vault · ${info.label}`,
            marketAddress: m.vault,
            receiptTokens: [m.vault, ...(m.gauge ? [m.gauge] : [])],
            depositOnly: true,
            suppliedUsd: value,
            debtUsd: 0,
            healthFactor: null,
            risk: 'no-debt',
            assets: [
              {
                address: m.borrowed,
                symbol: info.loan.symbol,
                supplied,
                borrowed: 0,
                priceUsd: loanPrice,
                collateral: false,
                liquidationThreshold: null,
                liquidationPriceUsd: null,
                supplyRate: stats?.supplyRate ?? unavailableRate(),
              },
            ],
            notes: [
              `Your wallet and gauge-held shares are converted to ${info.loan.symbol} once; vault/gauge receipt tokens are excluded from wallet totals.`,
              'Current lending APR excludes CRV rewards, boosts and unclaimed incentives. Convex and other wrapper positions are not discovered.',
            ],
          });
        }
        if (o.loan) {
          const state = await client.readContract({
            address: m.controller,
            abi: curveControllerAbi,
            functionName: 'user_state',
            args: [wallet],
            blockNumber: block,
          });
          const health = await client
            .readContract({
              address: m.controller,
              abi: curveControllerAbi,
              functionName: 'health',
              args: [wallet, true],
              blockNumber: block,
            })
            .then((v) => Number(v) / 1e18)
            .catch(() => null);
          const collateral = curveUnits(state[0], info.coll.decimals),
            converted = curveUnits(state[1], info.loan.decimals),
            debt = curveUnits(state[2], info.loan.decimals);
          const collateralUsd = usd(collateral, collPrice),
            convertedUsd = usd(converted, loanPrice),
            suppliedUsd =
              collateralUsd === null || convertedUsd === null
                ? null
                : collateralUsd + convertedUsd;
          const debtUsd = usd(debt, loanPrice);
          const assets: Asset[] = [
            {
              address: m.collateral,
              symbol: info.coll.symbol,
              supplied: collateral,
              borrowed: 0,
              priceUsd: collPrice,
              collateral: true,
              liquidationThreshold: null,
              liquidationPriceUsd: null,
              supplyRate: rate(
                0,
                'Pledged Curve collateral earns no lending-vault interest. Verified intrinsic token yield is added separately.',
              ),
            },
            {
              address: m.borrowed,
              symbol: info.loan.symbol,
              supplied: converted,
              borrowed: debt,
              priceUsd: loanPrice,
              collateral: converted > 0,
              liquidationThreshold: null,
              liquidationPriceUsd: null,
              supplyRate: rate(
                0,
                'Borrowed-token cash converted inside LLAMMA remains collateral, not a vault lending deposit.',
              ),
              borrowRate: stats?.borrowRate ?? unavailableRate(),
            },
          ];
          out.push({
            id: `curve-loan-${m.controller}`,
            label: `Curve LlamaLend · ${info.label}`,
            marketAddress: m.controller,
            assets,
            suppliedUsd,
            debtUsd,
            collateralValueUsd: suppliedUsd,
            healthFactor: null,
            risk:
              debt === 0
                ? 'no-debt'
                : health === null
                  ? 'unknown'
                  : health <= 0
                    ? 'liquidatable'
                    : health < 0.1
                      ? 'high'
                      : health < 0.3
                        ? 'watch'
                        : 'lower',
            liquidationModel: 'unavailable',
            notes: [
              `Curve health: ${health === null ? 'unavailable' : `${(health * 100).toFixed(2)}%`}. Curve health is not an Aave health factor; a fixed LLTV or independent single liquidation price is not assumed.`,
              `${Number(state[3])} LLAMMA bands. ${converted > 0 ? 'Soft liquidation has converted collateral into the borrowed token; both balances remain included as supplied collateral.' : 'No converted borrowed-token collateral is currently held in LLAMMA.'}`,
              'Collateral intrinsic yield is counted separately; lending-vault APR is never applied to pledged collateral. Trading fees, soft-liquidation losses and external rewards are not projected as interest.',
            ],
          });
        }
        if (loanPrice === null || (o.loan && collPrice === null))
          warn(
            'Some Curve USD prices are unavailable; verified balances remain visible.',
          );
        return out;
      },
      () => {
        complete = false;
        warn(
          'Some active Curve positions could not be fully read; their balances remain unknown.',
        );
      },
    )
  ).flat();
  return {
    id: 'curve-llamalend',
    name: CURVE_NAME,
    status: warnings.size ? 'partial' : 'ok',
    coverage: curveCoverage(network),
    positions,
    balanceDiscoveryComplete: complete,
    message: warnings.size ? [...warnings].join(' ') : undefined,
  };
}
