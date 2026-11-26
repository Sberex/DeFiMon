import { expect, it } from 'vitest';
import { configuredTokenRegistry } from '../server/token-registry';
import { savingsGroup, createSavingsRateService } from '../server/savings-rates';
import { applyIntrinsicRates } from '../server/intrinsic-rates';
import { assetMonthlyInterest, annualizedNplApr, positionMonthlyInterest, supplyApr, totalMonthlyInterest } from '../src/monthly-interest';
import type { ChainClient } from '../server/rpc';
import type { ProtocolResult } from '../src/types';
const token = '0xc4374775489cb9c56003bf2c9b12495fc64f0771', feed = '0x89a0e204591fce2611e89ca7634c12b400d347fe';
const start = 1149866292673538600n, end = 1154458151286282103n, now = 2000000000n, prefix = 1n << 64n;
function client(wrongDescription = false): ChainClient {
  const round = (index: bigint) => { const time = now - (61n-index)*86400n; return [prefix|index, start+(end-start)*(index-31n)/30n, time-10n, time, prefix|index] as const; };
  return {
    getChainId: async () => 9745,
    getBlockNumber: async () => 100n,
    getBlock: async () => ({ timestamp: now }),
    readContract: async ({ address, functionName, args, blockNumber }: any) => {
      expect(address.toLowerCase()).toBe(feed); expect(blockNumber).toBe(100n);
      if (functionName === 'description') return wrongDescription ? 'Unrelated token price' : 'SYRUPUSDT-USDT Exchange Rate';
      if (functionName === 'decimals') return 18;
      if (functionName === 'latestRoundData') return round(61n);
      if (functionName === 'getRoundData') return round(args[0] & ((1n<<64n)-1n));
      throw Error('Unexpected call');
    },
  } as unknown as ChainClient;
}
it('matches syrupUSDT by chain and address, keeping Maple governance tokens separate', () => {
  const config = configuredTokenRegistry.syrupUSDT;
  expect(config.category).toBe('Savings stablecoin');
  expect(config.addresses).toMatchObject({ plasma: token, ethereum: '0x356b8d89c1e1239cbbb9de4815c39a1474d5ba7d', bsc: '0x8e9d4cea39299323fe8eda678cad449718556c4e' });
  expect(savingsGroup('plasma',token.toUpperCase().replace('0X','0x'))).toBe('syrupUSDT');
  expect(savingsGroup('ethereum',configuredTokenRegistry.SYRUP.addresses.ethereum!)).toBeUndefined();
  expect(config.intrinsicOracles?.[0]).toMatchObject({ network: 'plasma', address: expect.stringMatching(/^0x89a0e204/i), history: 'rounds', decimals: 18 });
});
it('uses the configured uncapped oracle history and includes intrinsic income once in position and portfolio NPL/APR', async () => {
  const service = createSavingsRateService({ clientFor: network => { expect(network).toBe('plasma'); return client(); }, registry: configuredTokenRegistry });
  const supplied = 346478.044185, priceUsd = 1.15294748, debt = 359515.51937869;
  const p: ProtocolResult = { id: 'aave-v3', name: 'Aave v3', chain: 'Plasma', status: 'ok', coverage: '', positions: [{ id: 'aave-main', label: 'Plasma main market', suppliedUsd: supplied*priceUsd, debtUsd: debt, healthFactor: 1.02, risk: 'high', notes: [], assets: [
    { symbol: 'syrupUSDT', address: token, supplied, borrowed: 0, priceUsd, collateral: true, liquidationThreshold: .92, liquidationPriceUsd: null, supplyRate: { apr: 0, note: 'Collateral only' } },
    { symbol: 'GHO', address: '0xb77e872a68c62cfc0dfb02c067ecc3da23b4bbf3', supplied: 0, borrowed: debt, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, borrowRate: { apr: .04674351148, note: '' } },
  ] }] };
  const result = await applyIntrinsicRates([p], 'plasma', undefined, service.quote), position = result[0].positions[0], asset = position.assets[0];
  const expectedApr = Number(end-start)/Number(start)*365/30;
  expect(asset.intrinsicSupplyRate?.apr).toBeCloseTo(expectedApr,12); expect(supplyApr(asset.supplyRate,asset.intrinsicSupplyRate)).toBeCloseTo(.04858618213,10);
  expect(asset.intrinsicSupplyRate?.source).toMatchObject({ oracle: configuredTokenRegistry.syrupUSDT.intrinsicOracles![0].address, chain: 'Plasma', startRate: Number(start)/1e18, endRate: Number(end)/1e18, windowDays: 30 });
  const earned = supplied*priceUsd*expectedApr/12, paid = debt*.04674351148/12, net = position.suppliedUsd!-debt;
  expect(assetMonthlyInterest(asset).earnedUsd).toBeCloseTo(earned,8);
  const monthly = positionMonthlyInterest(position);
  expect(monthly.earnedUsd).toBeCloseTo(earned,8); expect(monthly.paidUsd).toBeCloseTo(paid,8); expect(monthly.nplUsd).toBeCloseTo(earned-paid,8);
  expect(totalMonthlyInterest(result).nplUsd).toBeCloseTo(earned-paid,8);
  expect(annualizedNplApr(earned-paid,net)).toBeCloseTo((earned-paid)*12/net,12);
});
