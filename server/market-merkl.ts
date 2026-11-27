import { parseAbi, type Address } from 'viem';
import type {
  DiscoveryMarket,
  DiscoveryResult,
} from '../src/market-discovery.js';
import type { NetworkId } from '../src/types.js';
import { networks } from './networks.js';
import type { ChainClient } from './rpc.js';
type Obj = Record<string, any>;
const obj = (v: unknown): Obj => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw Error('Invalid Merkl object');
  return v as Obj;
};
const addr = (v: unknown): string => {
  if (
    typeof v !== 'string' ||
    !/^0x[\da-f]{40}$/i.test(v) ||
    /^0x0{40}$/i.test(v)
  )
    throw Error('Invalid Merkl address');
  return v.toLowerCase();
};
const list = (v: unknown): any[] => {
  if (!Array.isArray(v) || v.length > 1000) throw Error('Invalid Merkl list');
  return v;
};
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
interface Program {
  url: string;
  id: string;
  name: string;
  apr: number;
  apy?: number;
  end: number;
  chain: number;
  side: 'supply' | 'borrow';
  kind: 'aave-net' | 'fluid';
  target: string;
  offsets: string[];
  tokens: { wrapper: string; underlying: string }[];
  supply?: string[];
  borrow?: string[];
}
export function parseMarketMerklProgram(
  value: unknown,
  chain: number,
  now: number,
): Program {
  const o = obj(value),
    protocol = obj(o.protocol).id;
  if (
    o.chainId !== chain ||
    o.status !== 'LIVE' ||
    typeof o.id !== 'string' ||
    !/^[\w-]{1,100}$/.test(o.id) ||
    !finite(o.apr) ||
    o.apr < 0 ||
    typeof o.name !== 'string'
  )
    throw Error('Invalid Merkl opportunity');
  const record = Number(obj(o.aprRecord).timestamp);
  if (!Number.isFinite(record) || record > now + 300 || now - record > 172800)
    throw Error('Stale Merkl APR');
  const borrow =
    o.type === 'AAVE_NET_BORROWING' || o.type === 'FLUIDVAULT_BORROW';
  const fluid =
    protocol === 'fluid' &&
    ['FLUIDVAULT_BORROW', 'FLUIDVAULT_COLLATERAL'].includes(o.type);
  if (
    (!fluid &&
      !(
        protocol === 'aave' &&
        ['AAVE_NET_BORROWING', 'AAVE_NET_LENDING'].includes(o.type)
      )) ||
    o.action !== (borrow ? 'BORROW' : 'LEND')
  )
    throw Error('Unsupported Merkl program');
  const campaigns = list(o.campaigns).filter(
    (c) => Number(c.startTimestamp) <= now && Number(c.endTimestamp) > now,
  );
  if (!campaigns.length) throw Error('No active Merkl campaign');
  let previous: string | undefined, program: Program | undefined;
  for (const c of campaigns) {
    if (
      c.opportunityId !== o.id ||
      c.computeChainId !== chain ||
      c.type !== o.type ||
      c.isPrivate !== false ||
      c.hasOverrides !== false ||
      (c.subType != null && c.subType !== 0) ||
      obj(c.rewardToken).type !== 'TOKEN' ||
      c.rewardToken.isTest === true
    )
      throw Error('Unverified campaign');
    const p = obj(c.params);
    const commonKeys = [
      'hooks',
      'tokens',
      'duration',
      'blacklist',
      'whitelist',
      'forwarders',
      'forwardingList',
      'forwardingEnabled',
      'symbolRewardToken',
      'decimalsRewardToken',
      'computeScoreParameters',
      'distributionMethodParameters',
    ];
    const ruleKeys = fluid
      ? [
          'LTV',
          'vault',
          'isSmartCol',
          'isSmartDebt',
          'borrowTokens',
          'supplyTokens',
          'symbolBorrowTokens',
          'symbolSupplyTokens',
          'decimalsBorrowTokens',
          'decimalsSupplyTokens',
        ]
      : ['borrowingToken', 'lendingToken', 'borrowTokens', 'supplyTokens'];
    if (Object.keys(p).some((k) => ![...commonKeys, ...ruleKeys].includes(k)))
      throw Error('Unsupported campaign condition');
    if (obj(p.computeScoreParameters).computeMethod !== 'genericTimeWeighted')
      throw Error('Unsupported score');
    for (const key of [
      'hooks',
      'blacklist',
      'whitelist',
      'forwarders',
      'forwardingList',
    ])
      if (p[key] !== undefined && list(p[key]).length)
        throw Error('Wallet-specific or forwarded eligibility');
    const base = {
      url: `https://app.merkl.xyz/opportunities/${Object.entries(networks).find(([, n]) => n.id === chain)![0]}/${o.type}/${encodeURIComponent(o.identifier)}`,
      id: o.id,
      name: o.name.slice(0, 500),
      apr: o.apr / 100,
      ...(finite(o.apy) && o.apy >= 0 ? { apy: o.apy / 100 } : {}),
      end: Math.min(...campaigns.map((c) => Number(c.endTimestamp))),
      chain,
      side: borrow ? ('borrow' as const) : ('supply' as const),
    };
    if (fluid) {
      if (
        p.isSmartCol !== false ||
        p.isSmartDebt !== false ||
        addr(p.vault) !== addr(o.identifier)
      )
        throw Error('Only verified simple Fluid vault rewards can be modelled');
      const supply = list(p.supplyTokens).map(addr),
        debt = list(p.borrowTokens).map(addr);
      if (supply.length !== 1 || debt.length !== 1)
        throw Error('Unsupported Fluid basket');
      program = {
        ...base,
        kind: 'fluid',
        target: addr(p.vault),
        supply,
        borrow: debt,
        offsets: [],
        tokens: [],
      };
    } else {
      const tokens = list(p.tokens).map((t) => ({
        wrapper: addr(t.tokenAddress),
        underlying: addr(t.underlyingToken),
      }));
      if (
        !tokens.length ||
        new Set(tokens.map((t) => t.wrapper)).size !== tokens.length
      )
        throw Error('Invalid token mapping');
      const target = addr(borrow ? p.borrowingToken : p.lendingToken);
      const offsets = list(borrow ? p.supplyTokens : p.borrowTokens)
        .map(addr)
        .sort();
      if (
        !tokens.some((t) => t.wrapper === target) ||
        offsets.some((a) => !tokens.some((t) => t.wrapper === a))
      )
        throw Error('Incomplete token mapping');
      program = { ...base, kind: 'aave-net', target, offsets, tokens };
    }
    const identity = JSON.stringify({ ...program, end: 0 });
    if (previous && previous !== identity)
      throw Error('Active campaigns have conflicting rules');
    previous = identity;
  }
  return program!;
}
const receiptAbi = parseAbi([
  'function POOL() view returns (address)',
  'function UNDERLYING_ASSET_ADDRESS() view returns (address)',
]);
const reserveAbi = parseAbi([
  'function getReserveData(address) view returns (((uint256 data) configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))',
]);
export function createMarketMerkl(
  options: { fetcher?: typeof fetch; now?: () => number } = {},
) {
  const fetcher = options.fetcher ?? fetch,
    now = options.now ?? Date.now;
  const cache = new Map<
    NetworkId,
    {
      until: number;
      promise: Promise<{ programs: Program[]; partial: boolean }>;
    }
  >();
  async function json(path: string) {
    const r = await fetcher(`https://api.merkl.xyz/v4${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!r.ok) throw Error('Merkl request unavailable');
    const text = await r.text();
    if (text.length > 6000000) throw Error('Merkl response too large');
    return JSON.parse(text);
  }
  function catalog(network: NetworkId) {
    const existing = cache.get(network);
    if (existing && existing.until > now()) return existing.promise;
    const entry = {
      until: Infinity,
      promise: Promise.resolve({ programs: [] as Program[], partial: false }),
    };
    entry.promise = (async () => {
      const all: Obj[] = [];
      let partial = false;
      for (let page = 0; page < 10; page++) {
        const rows = list(
          await json(
            `/opportunities?chainId=${networks[network].id}&status=LIVE&items=100&page=${page}`,
          ),
        );
        all.push(...rows);
        if (rows.length < 100) break;
        if (page === 9) partial = true;
      }
      const relevant = all.filter(
        (o) =>
          o.chainId === networks[network].id &&
          ['aave', 'fluid'].includes(o.protocol?.id) &&
          o.status === 'LIVE',
      );
      const counts = new Map<string, number>();
      for (const o of relevant) counts.set(o.id, (counts.get(o.id) ?? 0) + 1);
      const candidates = relevant.filter(
        (o) =>
          counts.get(o.id) === 1 &&
          [
            'AAVE_NET_BORROWING',
            'AAVE_NET_LENDING',
            'FLUIDVAULT_BORROW',
            'FLUIDVAULT_COLLATERAL',
          ].includes(o.type),
      );
      if (candidates.length !== relevant.length || candidates.length > 40)
        partial = true;
      const programs: Program[] = [];
      for (let i = 0; i < Math.min(candidates.length, 40); i += 4)
        await Promise.all(
          candidates.slice(i, i + 4).map(async (o) => {
            try {
              if (typeof o.id !== 'string' || !/^[\w-]{1,100}$/.test(o.id))
                throw Error();
              const detail = await json(
                `/opportunities/${encodeURIComponent(o.id)}?campaigns=true`,
              );
              if (
                detail.id !== o.id ||
                detail.type !== o.type ||
                detail.identifier !== o.identifier
              )
                throw Error();
              programs.push(
                parseMarketMerklProgram(
                  detail,
                  networks[network].id,
                  now() / 1000,
                ),
              );
            } catch {
              partial = true;
            }
          }),
        );
      return { programs, partial };
    })().then(
      (value) => {
        entry.until = now() + 300000;
        return value;
      },
      (e) => {
        cache.delete(network);
        throw e;
      },
    );
    cache.set(network, entry);
    return entry.promise;
  }
  return async (
    markets: DiscoveryMarket[],
    client: ChainClient,
    network: NetworkId,
    block: bigint,
  ): Promise<{
    markets: DiscoveryMarket[];
    coverage: DiscoveryResult['coverage'];
    messages: string[];
  }> => {
    if (!markets.length) return { markets, coverage: [], messages: [] };
    try {
      const { programs, partial } = await catalog(network);
      let incomplete = partial;
      const wrappers = new Map<
        string,
        Promise<{ pool: string; underlying: string; side: 'supply' | 'borrow' }>
      >();
      function verify(wrapper: string) {
        if (!wrappers.has(wrapper))
          wrappers.set(
            wrapper,
            (async () => {
              const [pool, underlying] = await Promise.all(
                ['POOL', 'UNDERLYING_ASSET_ADDRESS'].map((functionName) =>
                  client.readContract({
                    address: wrapper as Address,
                    abi: receiptAbi,
                    functionName: functionName as
                      'POOL' | 'UNDERLYING_ASSET_ADDRESS',
                    blockNumber: block,
                  }),
                ),
              );
              const reserve = await client.readContract({
                address: pool,
                abi: reserveAbi,
                functionName: 'getReserveData',
                args: [underlying],
                blockNumber: block,
              });
              const side =
                addr(reserve.aTokenAddress) === wrapper
                  ? 'supply'
                  : addr(reserve.variableDebtTokenAddress) === wrapper
                    ? 'borrow'
                    : null;
              if (!side) throw Error('Receipt does not match native reserve');
              return { pool: addr(pool), underlying: addr(underlying), side };
            })(),
          );
        return wrappers.get(wrapper)!;
      }
      const verified = await Promise.all(
        programs
          .filter((p) => p.end > now() / 1000)
          .map(async (p) => {
            if (p.kind === 'fluid') return p;
            try {
              for (const token of p.tokens) {
                const native = await verify(token.wrapper);
                if (
                  native.underlying !== token.underlying ||
                  native.side !==
                    (token.wrapper === p.target
                      ? p.side
                      : p.side === 'borrow'
                        ? 'supply'
                        : 'borrow')
                )
                  throw Error('Native token identity mismatch');
              }
              const pool = (await verify(p.target)).pool;
              if (p.tokens.some((t) => !wrappers.has(t.wrapper))) throw Error();
              for (const token of p.tokens)
                if ((await verify(token.wrapper)).pool !== pool)
                  throw Error('Mixed markets');
              return { ...p, pool };
            } catch {
              incomplete = true;
              return null;
            }
          }),
      );
      const result = markets.map((m) => {
        const applied: NonNullable<DiscoveryMarket['merklPrograms']> = [];
        const borrowed = m.borrowAsset?.address.toLowerCase(),
          supplied = m.supplyAsset.address.toLowerCase();
        const basket =
          m.requiredSupplyAssets?.some(
            (a) => a.address.toLowerCase() !== supplied,
          ) ||
          m.requiredBorrowAssets?.some(
            (a) => a.address.toLowerCase() !== borrowed,
          );
        if (basket) return m;
        for (const p of verified) {
          if (!p) continue;
          let note: string;
          if (p.kind === 'fluid') {
            if (
              m.protocol !== 'Fluid' ||
              m.market.toLowerCase() !== p.target ||
              p.supply![0] !== supplied ||
              p.borrow![0] !== borrowed
            )
              continue;
            note =
              'Public incentive for this exact Fluid vault and lending side.';
          } else {
            if (
              !['Aave v3', 'Aave Horizon'].includes(m.protocol) ||
              !('pool' in p) ||
              p.pool !== m.market.toLowerCase()
            )
              continue;
            const underlying = p.tokens.find(
              (t) => t.wrapper === p.target,
            )!.underlying;
            const offsets = p.offsets.map(
              (a) => p.tokens.find((t) => t.wrapper === a)!.underlying,
            );
            if (
              p.side === 'borrow'
                ? borrowed !== underlying
                : supplied !== underlying
            )
              continue;
            if (
              offsets.includes(
                p.side === 'borrow' ? supplied : (borrowed ?? ''),
              )
            )
              continue;
            note = `Net ${p.side === 'borrow' ? 'borrowing' : 'lending'} incentive. Assumes only the displayed pair; other ${p.side === 'borrow' ? 'supplies' : 'debts'} of ${offsets.join(', ')} reduce eligibility. Based on the campaign’s time-weighted balances.`;
          }
          applied.push({
            id: p.id,
            name: p.name,
            side: p.side,
            apr: p.apr,
            ...(p.apy === undefined ? {} : { apy: p.apy }),
            url: p.url,
            note,
            endAt: new Date(p.end * 1000).toISOString(),
          });
        }
        if (!applied.length) return m;
        const supply = applied
            .filter((p) => p.side === 'supply')
            .reduce((s, p) => s + p.apr, 0),
          borrow = applied
            .filter((p) => p.side === 'borrow')
            .reduce((s, p) => s + p.apr, 0);
        const nativeApy =
          m.borrowApy ??
          (['Aave v3', 'Aave Horizon'].includes(m.protocol) &&
          m.borrowApr !== null
            ? Math.expm1(m.borrowApr)
            : undefined);
        const rewardApys = applied.filter((p) => p.side === 'borrow');
        const netApy =
          nativeApy !== undefined &&
          rewardApys.every((p) => p.apy !== undefined)
            ? nativeApy - rewardApys.reduce((s, p) => s + p.apy!, 0)
            : undefined;
        return {
          ...m,
          protocolBorrowApr: m.borrowApr,
          protocolBorrowApy: nativeApy,
          borrowApr: m.borrowApr === null ? null : m.borrowApr - borrow,
          ...(netApy === undefined ? {} : { borrowApy: netApy }),
          totalSupplyApr:
            m.totalSupplyApr === null ? null : m.totalSupplyApr + supply,
          merklSupplyApr: supply,
          merklBorrowApr: borrow,
          merklPrograms: applied,
        };
      });
      return {
        markets: result,
        coverage: [
          {
            protocol: 'Merkl incentives',
            network,
            status: incomplete ? 'partial' : 'ok',
            message: incomplete
              ? 'Some campaign conditions or token identities could not be verified. Only verified incentives are included.'
              : undefined,
          },
        ],
        messages: [],
      };
    } catch {
      return {
        markets,
        coverage: [
          {
            protocol: 'Merkl incentives',
            network,
            status: 'error',
            message:
              'Merkl programs could not be checked; rates exclude unverified incentives.',
          },
        ],
        messages: [
          `${networks[network].name}: Merkl incentives unavailable; displayed rates exclude unverified rewards.`,
        ],
      };
    }
  };
}
export const applyMarketMerkl = createMarketMerkl();
