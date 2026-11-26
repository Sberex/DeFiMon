import { beforeEach, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import type { ChainClient } from '../server/rpc';
import { createCurveReader } from '../server/curve-llamalend';
import { readCurveLlamalend } from '../server/adapters/curve-llamalend';
import {
  createCurveMarketReader,
  curveCreationPolicy,
} from '../server/market-curve-llamalend';
import { CURVE_FACTORIES } from '../server/deployments/curve-llamalend';
import { positionLinks } from '../src/position-links';
import { createLiquidityAlertReader } from '../server/liquidity-alert-reader';
import { createUtilizationAlertReader } from '../server/utilization-alert-reader';
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
const vault = addr(1),
  controller = addr(2),
  amm = addr(3),
  collateral = addr(4),
  borrowed = addr(5),
  gauge = addr(6),
  wallet = addr(7);
const prices = vi.hoisted(() => new Map<string, number>());
vi.mock('../server/wallet-prices', () => ({
  walletPrices: async () => prices,
}));
const E = 10n ** 18n;
beforeEach(() => {
  prices.clear();
  prices.set(borrowed, 1);
});
function fixture(
  version: 1 | 2 = 1,
  options: {
    loan?: boolean;
    shares?: bigint;
    staked?: bigint;
    fail?: string;
    fee?: bigint;
    oracle?: bigint;
    wrongGauge?: boolean;
  } = {},
) {
  const factory = CURVE_FACTORIES.ethereum.find(
    (f) => f.version === version,
  )!.address;
  const read = vi.fn(
    async ({ address, functionName: f, args = [] }: any): Promise<any> => {
      if (options.fail === f) throw Error('private-rpc-key');
      const a = address.toLowerCase();
      if (f === 'market_count') return a === factory.toLowerCase() ? 1n : 0n;
      if (f === 'markets')
        return {
          vault,
          controller,
          amm,
          collateral_token: collateral,
          borrowed_token: borrowed,
        };
      if (f === 'get_gauge_from_lp_token') return gauge;
      if (
        [
          'vaults',
          'controllers',
          'amms',
          'borrowed_tokens',
          'collateral_tokens',
          'gauges',
        ].includes(f)
      )
        return (
          {
            vaults: vault,
            controllers: controller,
            amms: amm,
            borrowed_tokens: borrowed,
            collateral_tokens: collateral,
            gauges: gauge,
          } as Record<string, Address>
        )[f];
      if (f === 'factory') return version === 1 ? vault : factory;
      if (f === 'amm') return amm;
      if (f === 'collateral_token') return collateral;
      if (f === 'controller') return controller;
      if (f === 'borrowed_token') return borrowed;
      if (f === 'decimals') return 18;
      if (f === 'symbol') return a === borrowed ? 'crvUSD' : 'yieldETH';
      if (f === 'lp_token') return options.wrongGauge ? addr(20) : vault;
      if (f === 'price_oracle') return options.oracle ?? 2n * E;
      if (f === 'rate') return 2_000_000_000n;
      if (f === 'total_debt') return 600n * E;
      if (f === 'totalAssets') return 1000n * E;
      if (f === 'admin_percentage') return options.fee ?? E / 10n;
      if (f === 'available_balance') return 400n * E;
      if (f === 'borrow_cap') return 800n * E;
      if (f === 'admin_fees') return 20n * E;
      if (f === 'maxDeposit') return 1000n * E;
      if (f === 'loan_exists') return options.loan ?? false;
      if (f === 'balanceOf')
        return a === vault
          ? (options.shares ?? 0n)
          : a === gauge
            ? (options.staked ?? 0n)
            : 400n * E;
      if (f === 'convertToAssets') return args[0] * 2n;
      if (f === 'user_state') return [100n * E, 50n * E, 180n * E, 10n];
      if (f === 'health') return E / 5n;
      throw Error(`Unexpected method ${f}`);
    },
  );
  const client = {
    readContract: read,
    multicall: async ({ contracts, blockNumber }: any) =>
      Promise.all(contracts.map((c: any) => read({ ...c, blockNumber }))),
    getChainId: async () => 1,
    getBlockNumber: async () => 123n,
  } as unknown as ChainClient;
  return { client, read };
}
async function first(client: ChainClient) {
  const r = createCurveReader(client, 'ethereum', 123n);
  return { r, m: (await r.catalog()).markets[0] };
}
it('enumerates registered v1 markets and uses simple native APR, not APY', async () => {
  const { client, read } = fixture();
  const { r, m } = await first(client);
  const q = await r.quote(m);
  expect(m).toMatchObject({ version: 1, controller, vault, gauge });
  expect(q.borrowRate.apr).toBeCloseTo(0.063072);
  expect(q.supplyRate.apr).toBeCloseTo(0.063072 * 0.6);
  expect(q.liquidity.rawAmount).toBe(String(400n * E));
  expect(read.mock.calls.every(([q]) => q.blockNumber === 123n)).toBe(true);
});
it('reads v2 factories, fees, reserved cash and borrow-cap headroom', async () => {
  const { r, m } = await first(fixture(2).client);
  const q = await r.quote(m);
  expect(m.version).toBe(2);
  expect(q.supplyRate.apr).toBeCloseTo(0.063072 * 0.9 * 0.6);
  expect(q.liquidity.rawAmount).toBe(String(200n * E));
});
it('rejects invalid admin percentages and unavailable or zero oracle prices', async () => {
  for (const options of [
    { fee: 2n * E },
    { oracle: 0n },
    { fail: 'price_oracle' },
  ]) {
    const { r, m } = await first(fixture(2, options).client);
    await expect(r.quote(m)).rejects.toThrow();
  }
});
it('keeps converted borrowed-token cash as collateral during soft liquidation', async () => {
  const p = await readCurveLlamalend(
    fixture(1, { loan: true }).client,
    wallet,
    123n,
  );
  const loan = p.positions[0];
  expect(p.status).toBe('ok');
  expect(loan.suppliedUsd).toBe(250);
  expect(loan.collateralValueUsd).toBe(250);
  expect(loan.debtUsd).toBe(180);
  expect(loan.assets[1]).toMatchObject({
    supplied: 50,
    borrowed: 180,
    collateral: true,
  });
  expect(loan.assets[0].supplyRate?.apr).toBe(0);
  expect(loan.healthFactor).toBeNull();
});
it('converts direct plus gauge-staked vault shares once and exposes receipts for exclusion', async () => {
  const p = await readCurveLlamalend(
    fixture(1, { shares: 10n * E, staked: 20n * E }).client,
    wallet,
    123n,
  );
  expect(p.positions).toHaveLength(1);
  expect(p.positions[0]).toMatchObject({
    depositOnly: true,
    suppliedUsd: 60,
    debtUsd: 0,
    receiptTokens: [vault, gauge],
  });
  expect(p.positions[0].assets[0].supplyRate?.apr).toBeCloseTo(0.063072 * 0.6);
});
it('does not report empty balances when ownership calls fail', async () => {
  const p = await readCurveLlamalend(
    fixture(1, { fail: 'balanceOf' }).client,
    wallet,
    123n,
  );
  expect(p.status).toBe('partial');
  expect(p.balanceDiscoveryComplete).toBe(false);
  expect(JSON.stringify(p)).not.toContain('private-rpc-key');
});
it('rejects an unrelated staking receipt instead of crediting its balance', async () => {
  const p = await readCurveLlamalend(
    fixture(1, { staked: E, wrongGauge: true }).client,
    wallet,
    123n,
  );
  expect(p.positions).toHaveLength(0);
  expect(p.balanceDiscoveryComplete).toBe(false);
});
it('preserves owned balances when rates fail without treating borrowing costs as zero', async () => {
  const p = await readCurveLlamalend(
    fixture(1, { loan: true, fail: 'rate' }).client,
    wallet,
    123n,
  );
  expect(p.status).toBe('partial');
  expect(p.positions[0].debtUsd).toBe(180);
  expect(p.positions[0].assets[1].borrowRate?.apr).toBeNull();
});
const target = (deposit = false) => ({
  id: 'target',
  network: 'ethereum' as const,
  supplied: deposit ? borrowed : collateral,
  borrowed: deposit ? undefined : borrowed,
  supplies: [deposit ? borrowed : collateral],
  borrows: deposit ? [] : [borrowed],
  allSupplies: [],
  allBorrows: [],
});
it('matches collateral and borrowed addresses, with native liquidity and no invented fixed LLTV', async () => {
  const reader = createCurveMarketReader(
    async () => new Map([[`ethereum:${controller}`, 0]]),
  );
  const warn = vi.fn();
  const markets = await reader(
    fixture().client,
    'ethereum',
    123n,
    [target()],
    warn,
  );
  expect(markets).toHaveLength(1);
  expect(markets[0]).toMatchObject({
    protocol: 'Curve LlamaLend',
    market: controller,
    supplyApr: 0,
    lltv: null,
  });
  expect(markets[0].liquidity?.amount).toBe(400);
  expect(
    await reader(
      fixture().client,
      'ethereum',
      123n,
      [{ ...target(), supplies: [addr(30)] }],
      warn,
    ),
  ).toEqual([]);
});
it('recommends vault deposits for the loan token, not pledged collateral yield', async () => {
  const r = createCurveMarketReader(
    async () => new Map([[`ethereum:${controller}`, 0]]),
  );
  const rows = await r(
    fixture().client,
    'ethereum',
    123n,
    [target(true)],
    vi.fn(),
  );
  expect(rows[0].market).toBe(vault);
  expect(rows[0].supplyApr).toBeCloseTo(0.063072 * 0.6);
  expect(rows[0].borrowApr).toBeNull();
});
it('omits deprecated v1 markets and safely skips legacy markets when metadata is unavailable', async () => {
  for (const loader of [
    async () => new Map([[`ethereum:${controller}`, Date.now()]]),
    async () => {
      throw Error('offline');
    },
  ])
    expect(
      await createCurveMarketReader(loader)(
        fixture().client,
        'ethereum',
        123n,
        [target()],
        vi.fn(),
      ),
    ).toEqual([]);
  const rows = await createCurveMarketReader(async () => {
    throw Error('offline');
  })(fixture(2).client, 'ethereum', 123n, [target()], vi.fn());
  expect(rows).toHaveLength(1);
});
it('does not invent deployments on Base, BSC or Plasma', async () => {
  for (const n of ['base', 'bsc', 'plasma'] as const) {
    const { client, read } = fixture();
    expect(
      (await createCurveReader(client, n, 123n).catalog()).markets,
    ).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  }
});
it('reads only valid creation metadata and rejects broken responses', async () => {
  const loader = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      chains: {
        ethereum: { data: [{ controller, created_at: '2025-01-01T00:00:00' }] },
        arbitrum: { data: [] },
      },
    }),
  })) as unknown as typeof fetch;
  expect(
    (await curveCreationPolicy(loader)).get(`ethereum:${controller}`),
  ).toBe(Date.parse('2025-01-01T00:00:00Z'));
  await expect(
    curveCreationPolicy(
      vi.fn(async () => ({ ok: false })) as unknown as typeof fetch,
    ),
  ).rejects.toThrow();
});
it('uses full controller and vault addresses in market links', async () => {
  const p = await readCurveLlamalend(
    fixture(1, { shares: E }).client,
    wallet,
    123n,
  );
  const links = positionLinks(p.id, 'Ethereum', p.positions[0]);
  expect(links).toHaveLength(2);
  expect(links[0].address).toBe(vault);
  expect(links[0].url).toContain(`/markets/${controller}/vault`);
});
it('verifies ownership for liquidity and utilization alerts at the pinned block', async () => {
  const { client } = fixture(1, { loan: true });
  const watch = {
    address: wallet,
    network: 'ethereum' as const,
    protocol: 'curve-llamalend',
    positionId: `curve-loan-${controller}`,
    ruleUpdatedAt: '2026-11-26T00:00:00Z',
  };
  const liquidity = await createLiquidityAlertReader(() => client)(watch);
  expect(liquidity.status).toBe('ok');
  expect(liquidity.readings[0].rawAmount).toBe(String(400n * E));
  const utilization = await createUtilizationAlertReader(() => client)(
    watch as any,
  );
  expect(utilization.status).toBe('ok');
  expect(utilization.readings[0].utilizationPercent).toBe(60);
});

it('returns actual Curve contracts when discovery leaves the borrowed asset unrestricted',async()=>{
 const read=createCurveMarketReader(async()=>new Map([[`ethereum:${controller}`,0]]));
 const t={...target(),discovery:true,anyBorrow:true,borrows:[]};
 const rows=await read(fixture().client,'ethereum',123n,[t],vi.fn());
 expect(rows).toHaveLength(1);expect(rows[0].marketTokens).toEqual({supplied:collateral,borrowed});
});
