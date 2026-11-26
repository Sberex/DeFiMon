import { formatUnits, isAddress, parseAbi, type Address } from 'viem';
import type { NetworkId } from '../src/types.js';
import type { ChainClient } from './rpc.js';
import {
  CURVE_FACTORIES,
  type CurveFactory,
} from './deployments/curve-llamalend.js';
import {
  curveFactoryV1Abi,
  curveFactoryV2Abi,
  curveControllerAbi,
  curveVaultAbi,
  curveAmmAbi,
} from './abis/curve-llamalend.js';
import {
  tokenMetadata,
  liquidityQuote,
  minimum,
  remaining,
} from './market-liquidity.js';
import { perSecondApr, rate } from './rates.js';
export { curveControllerAbi, curveVaultAbi, curveAmmAbi };
export const CURVE_ZERO =
  '0x0000000000000000000000000000000000000000' as Address;
const gaugeAbi = parseAbi([
  'function get_gauge_from_lp_token(address) view returns(address)',
  'function lp_token() view returns(address)',
  'function balanceOf(address) view returns(uint256)',
  'function decimals() view returns(uint8)',
]);
export interface CurveMarket {
  version: 1 | 2;
  factory: Address;
  controller: Address;
  vault: Address;
  amm: Address;
  collateral: Address;
  borrowed: Address;
  gauge: Address | null;
}
export interface CurveCatalog {
  markets: CurveMarket[];
  complete: boolean;
}
export const curveAddress = (v: unknown): Address => {
  if (
    typeof v !== 'string' ||
    !isAddress(v, { strict: false }) ||
    /^0x0{40}$/i.test(v)
  )
    throw Error('Invalid Curve market identity');
  return v.toLowerCase() as Address;
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const curveUnits = (v: bigint, decimals: number) => {
  const value = Number(formatUnits(v, decimals));
  if (!Number.isFinite(value) || value < 0)
    throw Error('Invalid Curve balance');
  return value;
};
export const curveMarketUrl = (
  network: NetworkId,
  controller: string,
  vault = false,
) =>
  `https://www.curve.finance/llamalend/${network}/markets/${controller}${vault ? '/vault' : ''}`;
export function createCurveReader(
  client: ChainClient,
  network: NetworkId,
  block: bigint,
) {
  let catalogPromise: Promise<CurveCatalog> | undefined;
  const infos = new Map<string, ReturnType<typeof infoRead>>(),
    quotes = new Map<string, ReturnType<typeof quoteRead>>();
  async function factoryMarkets(f: CurveFactory): Promise<CurveMarket[]> {
    const count = await client.readContract({
      address: f.address,
      abi: curveFactoryV1Abi,
      functionName: 'market_count',
      blockNumber: block,
    });
    if (count < 0n || count > 512n)
      throw Error('Curve factory size unsupported');
    const indices = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
    if (f.version === 1) {
      const fields = [
        'vaults',
        'controllers',
        'amms',
        'borrowed_tokens',
        'collateral_tokens',
        'gauges',
      ] as const;
      const values = await client.multicall({
        contracts: indices.flatMap((i) =>
          fields.map((functionName) => ({
            address: f.address,
            abi: curveFactoryV1Abi,
            functionName,
            args: [i] as const,
          })),
        ),
        blockNumber: block,
        allowFailure: false,
        batchSize: 8192,
      });
      return indices.map((_, i) => {
        const v = values.slice(i * fields.length, (i + 1) * fields.length);
        return {
          version: 1,
          factory: f.address,
          vault: curveAddress(v[0]),
          controller: curveAddress(v[1]),
          amm: curveAddress(v[2]),
          borrowed: curveAddress(v[3]),
          collateral: curveAddress(v[4]),
          gauge: same(String(v[5]), CURVE_ZERO) ? null : curveAddress(v[5]),
        };
      });
    }
    const values = await client.multicall({
      contracts: indices.map((i) => ({
        address: f.address,
        abi: curveFactoryV2Abi,
        functionName: 'markets' as const,
        args: [i] as const,
      })),
      blockNumber: block,
      allowFailure: false,
      batchSize: 8192,
    });
    const gauges = f.gaugeFactory
      ? await client.multicall({
          contracts: values.map((v) => ({
            address: f.gaugeFactory!,
            abi: gaugeAbi,
            functionName: 'get_gauge_from_lp_token' as const,
            args: [v.vault] as const,
          })),
          blockNumber: block,
          allowFailure: false,
          batchSize: 8192,
        })
      : values.map(() => CURVE_ZERO);
    return values.map((v, i) => ({
      version: 2,
      factory: f.address,
      vault: curveAddress(v.vault),
      controller: curveAddress(v.controller),
      amm: curveAddress(v.amm),
      borrowed: curveAddress(v.borrowed_token),
      collateral: curveAddress(v.collateral_token),
      gauge: same(gauges[i], CURVE_ZERO) ? null : curveAddress(gauges[i]),
    }));
  }
  function catalog() {
    if (!catalogPromise)
      catalogPromise = (async () => {
        const results = await Promise.allSettled(
          CURVE_FACTORIES[network].map(factoryMarkets),
        );
        if (results.length && results.every((r) => r.status === 'rejected'))
          throw Error('Curve factories unavailable');
        const markets = results.flatMap((r) =>
          r.status === 'fulfilled' ? r.value : [],
        );
        if (
          new Set(markets.map((m) => m.controller)).size !== markets.length ||
          new Set(markets.map((m) => m.vault)).size !== markets.length
        )
          throw Error('Ambiguous Curve factory markets');
        return {
          markets,
          complete: results.every((r) => r.status === 'fulfilled'),
        };
      })();
    return catalogPromise;
  }
  async function infoRead(m: CurveMarket) {
    const [
      factory,
      amm,
      collateral,
      controller,
      borrowed,
      vaultCollateral,
      vaultAmm,
      loan,
      coll,
      shares,
    ] = await Promise.all([
      client.readContract({
        address: m.controller,
        abi: curveControllerAbi,
        functionName: 'factory',
        blockNumber: block,
      }),
      client.readContract({
        address: m.controller,
        abi: curveControllerAbi,
        functionName: 'amm',
        blockNumber: block,
      }),
      client.readContract({
        address: m.controller,
        abi: curveControllerAbi,
        functionName: 'collateral_token',
        blockNumber: block,
      }),
      client.readContract({
        address: m.vault,
        abi: curveVaultAbi,
        functionName: 'controller',
        blockNumber: block,
      }),
      client.readContract({
        address: m.vault,
        abi: curveVaultAbi,
        functionName: 'borrowed_token',
        blockNumber: block,
      }),
      client.readContract({
        address: m.vault,
        abi: curveVaultAbi,
        functionName: 'collateral_token',
        blockNumber: block,
      }),
      client.readContract({
        address: m.vault,
        abi: curveVaultAbi,
        functionName: 'amm',
        blockNumber: block,
      }),
      tokenMetadata(client, m.borrowed, block),
      tokenMetadata(client, m.collateral, block),
      client.readContract({
        address: m.vault,
        abi: curveVaultAbi,
        functionName: 'decimals',
        blockNumber: block,
      }),
    ]);
    // V1 controllers call their vault "factory"; v2 exposes the actual deployment factory.
    if (
      !same(factory, m.version === 1 ? m.vault : m.factory) ||
      !same(amm, m.amm) ||
      !same(collateral, m.collateral) ||
      !same(controller, m.controller) ||
      !same(borrowed, m.borrowed) ||
      !same(vaultCollateral, m.collateral) ||
      !same(vaultAmm, m.amm) ||
      same(m.collateral, m.borrowed) ||
      shares > 36 ||
      loan.decimals > 36 ||
      coll.decimals > 36
    )
      throw Error('Curve market identity mismatch');
    return { loan, coll, shares, label: `${coll.symbol} / ${loan.symbol}` };
  }
  function info(m: CurveMarket) {
    if (!infos.has(m.controller)) infos.set(m.controller, infoRead(m));
    return infos.get(m.controller)!;
  }
  async function oracle(m: CurveMarket) {
    const raw = await client.readContract({
      address: m.amm,
      abi: curveAmmAbi,
      functionName: 'price_oracle',
      blockNumber: block,
    });
    const value = Number(raw) / 1e18;
    if (!Number.isFinite(value) || value <= 0)
      throw Error('Curve oracle unavailable');
    return value;
  }
  async function quoteRead(m: CurveMarket) {
    const metadata = await info(m);
    const [rawRate, debt, total, fee, price] = await Promise.all([
      client.readContract({
        address: m.amm,
        abi: curveAmmAbi,
        functionName: 'rate',
        blockNumber: block,
      }),
      client.readContract({
        address: m.controller,
        abi: curveControllerAbi,
        functionName: 'total_debt',
        blockNumber: block,
      }),
      client.readContract({
        address: m.vault,
        abi: curveVaultAbi,
        functionName: 'totalAssets',
        blockNumber: block,
      }),
      m.version === 2
        ? client.readContract({
            address: m.controller,
            abi: curveControllerAbi,
            functionName: 'admin_percentage',
            blockNumber: block,
          })
        : Promise.resolve(0n),
      oracle(m),
    ]);
    if (fee > 10n ** 18n || fee < 0n || debt > total)
      throw Error('Curve rate/solvency unavailable');
    const borrowApr = perSecondApr(rawRate),
      supplyApr =
        total === 0n
          ? 0
          : (perSecondApr((rawRate * (10n ** 18n - fee)) / 10n ** 18n) *
              Number(debt)) /
            Number(total);
    const [cash, cap, admin] =
      m.version === 2
        ? await Promise.all([
            client.readContract({
              address: m.controller,
              abi: curveControllerAbi,
              functionName: 'available_balance',
              blockNumber: block,
            }),
            client.readContract({
              address: m.controller,
              abi: curveControllerAbi,
              functionName: 'borrow_cap',
              blockNumber: block,
            }),
            client.readContract({
              address: m.controller,
              abi: curveControllerAbi,
              functionName: 'admin_fees',
              blockNumber: block,
            }),
          ])
        : [
            await client.readContract({
              address: m.borrowed,
              abi: gaugeAbi,
              functionName: 'balanceOf',
              args: [m.controller],
              blockNumber: block,
            }),
            2n ** 256n - 1n,
            0n,
          ];
    const available = minimum(remaining(cash, admin), remaining(cap, debt));
    if (!Number.isFinite(borrowApr) || !Number.isFinite(supplyApr))
      throw Error('Invalid Curve rate');
    return {
      ...metadata,
      price,
      debt,
      total,
      available,
      cap,
      borrowRate: rate(
        borrowApr,
        'Curve native per-second borrowing rate × 365 days. Simple APR, not compounded APY; external rewards excluded.',
      ),
      supplyRate: rate(
        supplyApr,
        'Curve current vault lending APR: borrowing rate × debt / total vault assets, after v2 admin_percentage. AMM trading fees and external rewards excluded.',
      ),
      liquidity: liquidityQuote(
        available,
        metadata.loan.decimals,
        metadata.loan.symbol,
        m.borrowed,
        m.version === 2
          ? 'Curve available_balance minus reserved admin fees, limited by remaining borrow_cap; excludes LLAMMA collateral and converted collateral cash.'
          : 'Borrowed-token cash held by the Curve controller; excludes LLAMMA collateral and converted collateral cash.',
      ),
    };
  }
  function quote(m: CurveMarket) {
    if (!quotes.has(m.controller)) quotes.set(m.controller, quoteRead(m));
    return quotes.get(m.controller)!;
  }
  async function ownership(m: CurveMarket, wallet: Address) {
    const values = await client.multicall({
      contracts: [
        {
          address: m.controller,
          abi: curveControllerAbi,
          functionName: 'loan_exists',
          args: [wallet],
        },
        {
          address: m.vault,
          abi: curveVaultAbi,
          functionName: 'balanceOf',
          args: [wallet],
        },
        {
          address: m.gauge ?? m.vault,
          abi: gaugeAbi,
          functionName: 'balanceOf',
          args: [wallet],
        },
      ] as const,
      blockNumber: block,
      allowFailure: false,
    });
    const loan = values[0],
      shares = values[1],
      staked = m.gauge ? values[2] : 0n;
    if (staked > 0n && m.gauge) {
      const [lp, decimals] = await Promise.all([
        client.readContract({
          address: m.gauge,
          abi: gaugeAbi,
          functionName: 'lp_token',
          blockNumber: block,
        }),
        client.readContract({
          address: m.gauge,
          abi: gaugeAbi,
          functionName: 'decimals',
          blockNumber: block,
        }),
      ]);
      if (!same(lp, m.vault) || decimals !== (await info(m)).shares)
        throw Error('Wrong Curve staking receipt');
    }
    return { loan, shares, staked };
  }
  return { catalog, info, quote, oracle, ownership };
}
