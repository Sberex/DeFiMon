import { expect, it, vi } from 'vitest';
import {
  createMarketMerkl,
  parseMarketMerklProgram,
} from '../server/market-merkl';
import { strategyMarket } from './fixtures/strategies';
import {
  merklMarketNow as now,
  merklMarketProgram,
  merklMarketPool as pool,
  merklMarketTokens as t,
} from './fixtures/merkl-market';
import type { ChainClient } from '../server/rpc';
const market = () =>
  strategyMarket({
    protocol: 'Aave v3',
    network: 'plasma',
    market: pool,
    borrowApr: 0.0436,
    supplyAsset: {
      address: t.susde,
      name: 'sUSDe',
      category: 'Savings stablecoin',
      intrinsicApr: 0.0497,
    },
    borrowAsset: { address: t.usdt, name: 'USDT0', category: 'Stablecoin' },
    totalSupplyApr: 0.0497,
  });
function setup(program: unknown = merklMarketProgram()) {
  const fetcher = vi.fn(
    async (url: string | URL | Request) =>
      new Response(
        JSON.stringify(
          String(url).includes('/opportunities?') ? [program] : program,
        ),
      ),
  );
  const readContract = vi.fn(async ({ address, functionName, args }: any) => {
    if (functionName === 'POOL') return pool;
    const underlying = address.toLowerCase() === t.agho ? t.gho : t.usdt;
    if (functionName === 'UNDERLYING_ASSET_ADDRESS') return underlying;
    if (functionName === 'getReserveData')
      return {
        aTokenAddress: args[0] === t.gho ? t.agho : t.ausdt,
        variableDebtTokenAddress:
          args[0] === t.gho
            ? '0x1111111111111111111111111111111111111111'
            : t.debt,
      };
    throw Error('unexpected');
  });
  const client = { readContract } as unknown as ChainClient;
  return {
    client,
    readContract,
    fetcher,
    apply: createMarketMerkl({
      fetcher: fetcher as typeof fetch,
      now: () => now,
    }),
  };
}
it('verifies Plasma USDT0 campaign against native reserve tokens, applies only eligible pairs and keeps APR distinct from APY', async () => {
  const s = setup(),
    m = market();
  const result = await s.apply(
    [
      m,
      { ...m, supplyAsset: { ...m.supplyAsset, address: t.gho } },
      { ...m, supplyAsset: { ...m.supplyAsset, address: t.usdt } },
    ],
    s.client,
    'plasma',
    123n,
  );
  expect(result.markets[0].borrowApr).toBeCloseTo(
    0.0436 - 0.007767649256875737,
    12,
  );
  expect(result.markets[0].borrowApy).toBeCloseTo(
    Math.expm1(0.0436) - 0.007797895708253579,
    12,
  );
  expect(result.markets[0]).toMatchObject({
    protocolBorrowApr: 0.0436,
    merklBorrowApr: 0.007767649256875737,
    merklPrograms: [{ id: '699654958170586655', side: 'borrow' }],
  });
  expect(result.markets.slice(1).map((m) => m.borrowApr)).toEqual([
    0.0436, 0.0436,
  ]);
  expect(m.borrowApr).toBe(0.0436);
  await s.apply([m], s.client, 'plasma', 124n);
  expect(s.fetcher).toHaveBeenCalledTimes(2);
});
it('rejects expired, stale, private, custom, duplicate or conflicting conditions instead of guessing eligibility', async () => {
  for (const change of [
    (p: any) => (p.status = 'PAST'),
    (p: any) => (p.aprRecord.timestamp = '1'),
    (p: any) => (p.campaigns[0].endTimestamp = 1),
    (p: any) => (p.campaigns[0].isPrivate = true),
    (p: any) => (p.campaigns[0].params.whitelist = [t.susde]),
    (p: any) => (p.campaigns[0].params.hooks = [t.susde]),
    (p: any) => (p.campaigns[0].params.minimumBorrow = 100),
  ]) {
    const p = merklMarketProgram();
    change(p);
    expect(() => parseMarketMerklProgram(p, 9745, now / 1000)).toThrow();
  }
  const s = setup();
  s.readContract.mockImplementation(async () => {
    throw Error('secret-provider');
  });
  const r = await s.apply([market()], s.client, 'plasma', 1n);
  expect(r.markets[0].borrowApr).toBe(0.0436);
  expect(r.coverage[0].status).toBe('partial');
  expect(JSON.stringify(r)).not.toContain('secret-provider');
});
it('leaves native rates usable with explicit failed coverage when Merkl is unavailable', async () => {
  const apply = createMarketMerkl({
    fetcher: vi.fn(async () => {
      throw Error('private-key');
    }) as typeof fetch,
    now: () => now,
  });
  const s = setup();
  const r = await apply([market()], s.client, 'plasma', 1n);
  expect(r.markets[0].borrowApr).toBe(0.0436);
  expect(r.coverage[0].status).toBe('error');
  expect(r.messages.join(' ')).toContain('exclude unverified');
  expect(JSON.stringify(r)).not.toContain('private-key');
});
it('requires pool identity and the correct native receipt side, not just the underlying token name', async () => {
  const s = setup();
  const m = market();
  m.market = '0x1111111111111111111111111111111111111111';
  expect(
    (await s.apply([m], s.client, 'plasma', 1n)).markets[0].merklPrograms,
  ).toBeUndefined();
  const wrong = merklMarketProgram();
  wrong.campaigns[0].params.tokens[0].underlyingToken = t.gho;
  const w = setup(wrong);
  expect(
    (await w.apply([market()], w.client, 'plasma', 1n)).markets[0]
      .merklPrograms,
  ).toBeUndefined();
});

it('matches simple Fluid programs by the exact vault and side, including supply rewards', async () => {
  const p: any = merklMarketProgram();
  p.protocol.id = 'fluid';
  p.type = 'FLUIDVAULT_COLLATERAL';
  p.action = 'LEND';
  p.identifier = pool;
  p.campaigns[0].type = p.type;
  p.campaigns[0].params = {
    vault: pool,
    isSmartCol: false,
    isSmartDebt: false,
    supplyTokens: [t.susde],
    borrowTokens: [t.usdt],
    computeScoreParameters: { computeMethod: 'genericTimeWeighted' },
  };
  const s = setup(p),
    m = { ...market(), protocol: 'Fluid' };
  const r = await s.apply(
    [m, { ...m, market: t.ausdt }],
    s.client,
    'plasma',
    123n,
  );
  expect(r.markets[0].totalSupplyApr).toBeCloseTo(0.0497 + p.apr / 100, 12);
  expect(r.markets[0].merklPrograms?.[0].side).toBe('supply');
  expect(r.markets[1].merklPrograms).toBeUndefined();
});
it('counts Aave net lending only when the displayed borrowing does not offset the reward', async () => {
  const p: any = merklMarketProgram();
  p.type = 'AAVE_NET_LENDING';
  p.action = 'LEND';
  p.campaigns[0].type = p.type;
  p.campaigns[0].params = {
    lendingToken: t.ausdt,
    borrowTokens: [t.debt],
    tokens: [
      { tokenAddress: t.ausdt, underlyingToken: t.usdt },
      { tokenAddress: t.debt, underlyingToken: t.usdt },
    ],
    computeScoreParameters: { computeMethod: 'genericTimeWeighted' },
  };
  const s = setup(p),
    m = {
      ...market(),
      supplyAsset: { ...market().supplyAsset, address: t.usdt },
      borrowAsset: { ...market().borrowAsset!, address: t.gho },
    };
  const r = await s.apply(
    [m, { ...m, borrowAsset: { ...m.borrowAsset, address: t.usdt } }],
    s.client,
    'plasma',
    123n,
  );
  expect(r.markets[0].totalSupplyApr).toBeGreaterThan(0.0497);
  expect(r.markets[1].merklPrograms).toBeUndefined();
});
