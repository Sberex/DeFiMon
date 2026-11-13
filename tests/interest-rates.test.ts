import { expect, it } from 'vitest';
import { encodeFunctionResult } from 'viem';
import type { Asset } from '../src/types';
import type { ChainClient } from '../server/rpc';
import { perSecondApr, rayApr, rate, weightedRate } from '../server/rates';
import { readV4HubRates, v4BorrowRate, v4SupplyApr } from '../server/aave-v4-rates';
import { applyFluidRates, fluidLendingRate } from '../server/fluid-rates';
import { fluidLegacyLendingRatesAbi } from '../server/abis/fluid-rates';
const address = '0x1111111111111111111111111111111111111111';
it('converts annual ray and per-second rates to APR without compounding or percent-unit mistakes', () => {
  expect(rayApr(35n * 10n ** 24n)).toBeCloseTo(0.035);
  expect(perSecondApr(1000000000n)).toBeCloseTo(0.031536);
  expect(rate(-0.01, 'fee').apr).toBe(-0.01);
  expect(rate(Infinity, 'invalid').apr).toBeNull();
});
it('weights same-token reserve APRs by the appropriate balances and propagates missing active rates', () => {
  expect(weightedRate(rate(0.03, 'a'), 100, rate(0.05, 'b'), 300)?.apr).toBeCloseTo(0.045);
  expect(weightedRate(rate(0.08, 'a'), 50, rate(0.12, 'b'), 50)?.apr).toBeCloseTo(0.1);
  expect(weightedRate(rate(0.03, 'a'), 100, undefined, 300)?.apr).toBeNull();
  expect(weightedRate(rate(0.03, 'a'), 100, undefined, 0)?.apr).toBe(0.03);
});
it('includes V4 premium interest, liquidity fees, and virtual assets in supply APR', () => {
  expect(v4SupplyApr(0.1, 660000000, 1000000000n, 1000)).toBeCloseTo(0.05934065934);
});
it('reads V4 current Hub rates at the selected block and includes user premium shares on total debt', async () => {
  const client = { readContract: async ({ functionName, blockNumber }: any) => {
    expect(blockNumber).toBe(123n);
    if (functionName === 'getAsset') return { underlying: address, drawnShares: 500000000n, premiumShares: 50000000n, liquidityFee: 1000, swept: 0n };
    if (functionName === 'getAddedAssets') return 1000000000n;
    if (functionName === 'getAssetDrawnIndex') return 12n * 10n ** 26n;
    if (functionName === 'getAssetDrawnRate') return 10n ** 26n;
    throw new Error('unexpected');
  } } as unknown as ChainClient;
  const hub = await readV4HubRates(client, address, 0n, address, 123n);
  expect(hub?.supplyRate.apr).toBeCloseTo(0.05934065934);
  expect(v4BorrowRate(hub, { drawnShares: 100000000n, premiumShares: 20000000n }, 132000000n).apr).toBeCloseTo(0.10909090909);
});
it('combines Fluid smart-leg token interest with signed vault adjustments and labels trading income excluded', async () => {
  const client = { readContract: async ({ functionName }: any) => functionName === 'getUserSupplyData'
    ? { liquidityTokenData0: { supplyRate: 400n }, liquidityTokenData1: { supplyRate: 600n }, liquidityUserSupplyDataToken0: { modeWithInterest: true }, liquidityUserSupplyDataToken1: { modeWithInterest: false } }
    : { liquidityTokenData0: { borrowRate: 600n }, liquidityTokenData1: { borrowRate: 800n }, liquidityUserBorrowDataToken0: { modeWithInterest: true }, liquidityUserBorrowDataToken1: { modeWithInterest: false } }
  } as unknown as ChainClient;
  const supply = [{ supplied: 1 }, { supplied: 1 }] as Asset[];
  const debt = [{ borrowed: 1 }, { borrowed: 1 }] as Asset[];
  await applyFluidRates(client, address, 1n, { vault: address, isSmartCol: true, isSmartDebt: true, constantVariables: { supply: address, borrow: address }, exchangePricesAndRates: { supplyRateVault: -100n, borrowRateVault: -50n } }, supply, debt);
  expect(supply.map(a => a.supplyRate?.apr)).toEqual([0.03, -0.01]);
  expect(debt[0].borrowRate?.apr).toBeCloseTo(0.055); expect(debt[1].borrowRate?.apr).toBe(-0.005);
  expect(supply[0].supplyRate?.note).toContain('Excludes pool trading income');
});
it('uses modern Fluid holder APR without confusing a signed static adjustment with the legacy field order', async () => {
  const client = { readContract: async () => [address, 0n, -100n, true, 400n, 300n, true] } as unknown as ChainClient;
  expect((await fluidLendingRate(client, address, address, 1n)).apr).toBe(0.03);
});
function zero(param: any): any {
  if (param.type === 'tuple') return Object.fromEntries(param.components.map((p: any) => [p.name, zero(p)]));
  if (param.type === 'address') return address;
  if (param.type === 'string') return 'Test';
  if (param.type === 'bool') return false;
  return 0n;
}
it('converts legacy Fluid streaming APR units separately and rejects a mismatched response layout', async () => {
  const output = fluidLegacyLendingRatesAbi[0].outputs[0];
  const details = { ...zero(output), supplyRate: 400n, rewardsRate: 3n * 10n ** 12n };
  const data = encodeFunctionResult({ abi: fluidLegacyLendingRatesAbi, functionName: 'getFTokenDetails', result: details });
  let extra = false;
  const client = { readContract: async () => { throw new Error('legacy'); }, call: async () => ({ data: extra ? `${data}${'0'.repeat(64)}` : data }) } as unknown as ChainClient;
  expect((await fluidLendingRate(client, address, address, 1n)).apr).toBeCloseTo(0.07);
  extra = true;
  expect((await fluidLendingRate(client, address, address, 1n)).apr).toBeNull();
});
