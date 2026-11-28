import { expect, it } from 'vitest';
import { createUtilizationAlertReader, utilizationPercent, type UtilizationWatch } from '../server/utilization-alert-reader';
import type { ChainClient } from '../server/rpc';
import type { LiquidityObservation } from '../server/liquidity-alert-reader';
const token = '0x1111111111111111111111111111111111111111', market = '0x2222222222222222222222222222222222222222';
const watch: UtilizationWatch = { address: token, network: 'ethereum', protocol: 'euler', positionId: 'position', thresholdPercent: 90, ruleUpdatedAt: '2026-11-23T06:00:00.000Z' };
const verified = (w: UtilizationWatch, status: LiquidityObservation['status'] = 'ok'): LiquidityObservation => ({ watch: w, checkedAt: '2026-11-23T06:05:00.000Z', blockNumber: '100', status, readings: [{ market, marketAddress: market, label: 'Market', token, symbol: 'USDC', decimals: 6, rawAmount: '1', note: 'Borrow cap limits availability to one raw unit.' }] });
function client(values: Record<string, unknown>): ChainClient { return { readContract: async ({ functionName, blockNumber }: any) => { expect(blockNumber).toBe(100n); if (!(functionName in values)) throw Error('provider-secret'); return values[functionName]; } } as unknown as ChainClient; }
it('uses Euler cash + borrows, never cap-limited available liquidity, at the verified position block', async () => {
  const reader = createUtilizationAlertReader(() => client({ cash: 20n, totalBorrows: 80n }), Date.now, async w => verified(w as UtilizationWatch));
  expect((await reader(watch)).readings[0].utilizationPercent).toBe(80);
});
it('uses Compound native utilization and handles inactive/failing positions without invented values', async () => {
  const reader = createUtilizationAlertReader(() => client({ getUtilization: 950000000000000000n }), Date.now, async w => verified(w as UtilizationWatch));
  expect((await reader({ ...watch, protocol: 'compound' })).readings[0].utilizationPercent).toBe(95);
  const failed = await createUtilizationAlertReader(() => client({}), Date.now, async w => verified(w as UtilizationWatch))(watch);
  expect(failed.status).toBe('error'); expect(failed.readings).toEqual([]); expect(JSON.stringify(failed)).not.toContain('provider-secret');
  expect((await createUtilizationAlertReader(() => client({}), Date.now, async w => verified(w as UtilizationWatch, 'inactive'))(watch)).status).toBe('inactive');
});
it('uses Aave virtual underlying plus both debt types, independently of caps', async () => {
  const reader = createUtilizationAlertReader(() => client({ getPoolDataProvider: market, getReserveData: [0n,0n,1000n,10n,70n], getVirtualUnderlyingBalance: 20n }), Date.now, async w => verified(w as UtilizationWatch));
  expect((await reader({ ...watch, protocol: 'aave-v3', positionId: 'aave-main' })).readings[0].utilizationPercent).toBe(80);
});
it('uses Fluid Liquidity-layer accrued totals in the same token, rather than collateral and debt token amounts', async () => {
  const reader = createUtilizationAlertReader(() => client({ getOverallTokenData: { totalSupply: 1000n, totalBorrow: 910n } }), Date.now, async w => verified(w as UtilizationWatch));
  const r = await reader({ ...watch, protocol: 'fluid', positionId: 'fluid-nft-1' }); expect(r.readings[0].utilizationPercent).toBe(91); expect(r.readings[0].note).toContain('Shared across vaults');
});
it('does not invent utilization for a denominator of zero or a vault with only unallocated cash', async () => {
  expect(utilizationPercent(0n,0n)).toBe(0); expect(() => utilizationPercent(1n,0n)).toThrow(); expect(utilizationPercent(1000n,1000n)).toBe(100);
  const reader = createUtilizationAlertReader(() => client({}), Date.now, async w => ({ ...verified(w as UtilizationWatch), readings: [{ ...verified(w as UtilizationWatch).readings[0], market: market+':idle' }] }));
  expect((await reader(watch)).status).toBe('unsupported');
});

it('uses Aave v4 drawn debt and swept assets, excluding premium debt and Spoke caps', async () => {
  const reader = createUtilizationAlertReader(() => client({ getAssetLiquidity: 10n, getAssetOwed: [80n, 200n], getAssetSwept: 10n }), Date.now, async w => ({ ...verified(w as UtilizationWatch), readings: [{ ...verified(w as UtilizationWatch).readings[0], market: `${market}:${token}:1` }] }));
  const result = await reader({ ...watch, protocol: 'aave-v4' }); expect(result.status).toBe('ok'); expect(result.readings[0].utilizationPercent).toBe(80);
});

it('retains the same-block Borrow APR from the verified liquidity observation, including zero and unknown rates', async () => {
  for (const borrowApr of [.05689, 0, null, undefined]) {
    const reader = createUtilizationAlertReader(() => client({cash: 5n, totalBorrows: 95n}), Date.now, async w => {
      const observation=verified(w as UtilizationWatch); observation.readings[0].borrowApr=borrowApr; return observation;
    });
    const result=await reader(watch);
    expect(result.status).toBe('ok');expect(result.blockNumber).toBe('100');
    expect(result.readings[0]).toMatchObject({utilizationPercent:95,borrowApr:borrowApr??null});
  }
});
