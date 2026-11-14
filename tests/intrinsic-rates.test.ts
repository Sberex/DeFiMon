import { expect, it, vi } from 'vitest';
import { applyIntrinsicRates, createSusdaiRateCache, readSusdaiIntrinsicRate, SUSDAI, SUSDAI_FEED } from '../server/intrinsic-rates';
import type { ChainClient } from '../server/rpc';
import type { IntrinsicRate, ProtocolResult } from '../src/types';
const DAY = 86400n, NOW = 2000000000n, PREFIX = 1n << 64n;
type Round = readonly [bigint, bigint, bigint, bigint, bigint];
function fixture(options: { chain?: number; decimals?: number; description?: string; latestAge?: bigint; growth?: bigint; badRound?: 'price' | 'id' | 'answered' | 'future' | 'gap' | 'old' } = {}) {
  const blocks: bigint[] = [];
  const round = (index: bigint): Round => {
    const id = PREFIX | index;
    let time = NOW - (61n - index) * DAY - (options.latestAge ?? 0n);
    if (options.badRound === 'old' && time <= NOW - 30n * DAY) time -= 7n * DAY;
    return [id, 10n ** 18n + (index - 31n) * (options.growth ?? 10n ** 16n) / 30n, time - 5n, time, id];
  };
  const client = {
    getChainId: async () => options.chain ?? 1,
    getBlock: async ({ blockNumber }: any) => { blocks.push(blockNumber); return { timestamp: NOW }; },
    readContract: async ({ address, functionName, args, blockNumber }: any) => {
      expect(address).toBe(SUSDAI_FEED); blocks.push(blockNumber);
      if (functionName === 'decimals') return options.decimals ?? 18;
      if (functionName === 'description') return options.description ?? 'SUSDAI / USDAI Exchange Rate';
      if (functionName === 'latestRoundData') return round(61n);
      if (functionName === 'getRoundData') {
        if (options.badRound === 'gap') throw new Error('private-provider-secret');
        const r = [...round(args[0] & ((1n << 64n) - 1n))] as [bigint, bigint, bigint, bigint, bigint];
        if (options.badRound === 'price') r[1] = 0n;
        if (options.badRound === 'id') r[0]++;
        if (options.badRound === 'answered') r[4] = 0n;
        if (options.badRound === 'future') r[3] = NOW + DAY;
        return r;
      }
      throw new Error('Unexpected call');
    },
  } as unknown as ChainClient;
  return { client, blocks };
}
it('annualizes actual observed share-rate growth without compounding or using an oracle APR cap', async () => {
  const f = fixture(); const result = await readSusdaiIntrinsicRate(f.client, 123n);
  expect(result.apr).toBeCloseTo(.01 * 365 / 30);
  expect(result.estimated).toBe(true);
  expect(result.source).toMatchObject({ chain: 'Ethereum', oracle: SUSDAI_FEED, blockNumber: '123', startTimestamp: Number(NOW - 30n * DAY), endTimestamp: Number(NOW), startRate: 1, endRate: 1.01 });
  expect(f.blocks.every(b => b === 123n)).toBe(true);
});
it('preserves genuine zero and negative intrinsic returns', async () => {
  expect((await readSusdaiIntrinsicRate(fixture({ growth: 0n }).client, 1n)).apr).toBe(0);
  expect((await readSusdaiIntrinsicRate(fixture({ growth: -(10n ** 16n) }).client, 1n)).apr).toBeCloseTo(-.01 * 365 / 30);
});
it('rejects wrong chain, units, description, stale data, malformed rounds, gaps and old month boundaries', async () => {
  for (const options of [{ chain: 42161 }, { decimals: 8 }, { description: 'sUSDai USD market price' }, { latestAge: 4n * DAY }, ...(['price', 'id', 'answered', 'future', 'gap', 'old'] as const).map(badRound => ({ badRound }))]) {
    const result = await readSusdaiIntrinsicRate(fixture(options).client, 1n);
    expect(result.apr, JSON.stringify(options, (_, v) => typeof v === 'bigint' ? String(v) : v)).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private-provider-secret');
  }
});
it('searches the previous feed phase when the last month crosses an aggregator upgrade', async () => {
  const base = fixture(); const requests: bigint[] = [];
  const makeRound = (id: bigint): Round => {
    const phase = id >> 64n, index = id & ((1n << 64n) - 1n);
    const daysAgo = phase === 2n ? 10n - index : 70n - index;
    const time = NOW - daysAgo * DAY;
    return [id, 10n ** 18n + (70n - daysAgo) * 10n ** 14n, time - 1n, time, id];
  };
  const client = { ...base.client, readContract: async (args: any) => {
    if (args.functionName === 'phaseAggregators') return SUSDAI_FEED;
    if (args.functionName === 'latestRoundData') {
      if (requests.includes(-1n)) return [60n, 1n, 1n, 1n, 60n];
      return makeRound((2n << 64n) | 10n);
    }
    if (args.functionName === 'getRoundData') { requests.push(args.args[0]); if (args.args[0] === ((2n << 64n) | 1n)) requests.push(-1n); return makeRound(args.args[0]); }
    return base.client.readContract(args);
  } } as unknown as ChainClient;
  const result = await readSusdaiIntrinsicRate(client, 1n);
  expect(result.apr).not.toBeNull();
  expect(result.source.startRound).toBe(String(PREFIX | 40n));
  expect(result.source.endRound).toBe(String((2n << 64n) | 10n));
});
it('coalesces simultaneous requests, refreshes after five minutes and retries failures after one minute', async () => {
  let now = 0;
  const quote = await readSusdaiIntrinsicRate(fixture().client, 1n);
  const load = vi.fn(async () => quote);
  const read = createSusdaiRateCache(load, () => now);
  await Promise.all([read(), read(), read()]); expect(load).toHaveBeenCalledTimes(1);
  now = 300001; await read(); expect(load).toHaveBeenCalledTimes(2);
  const failed = vi.fn(async (): Promise<IntrinsicRate> => { throw new Error('private-provider-secret'); });
  const retry = createSusdaiRateCache(failed, () => now);
  expect((await retry()).apr).toBeNull(); await retry(); expect(failed).toHaveBeenCalledTimes(1);
  now += 60001; await retry(); expect(failed).toHaveBeenCalledTimes(2);
});
it('adds a separate intrinsic component to supplied sUSDai across all protocol families and networks', async () => {
  const quote = await readSusdaiIntrinsicRate(fixture().client, 1n);
  const asset = { symbol: 'sUSDai', address: SUSDAI, supplied: 10, borrowed: 0, priceUsd: 1.1, collateral: true, liquidationThreshold: .9, liquidationPriceUsd: 1, supplyRate: { apr: .02, note: 'Protocol only' } };
  const protocols: ProtocolResult[] = ['aave-v3', 'aave-v4', 'morpho', 'compound', 'fluid'].map(id => ({ id, name: id, status: 'ok', coverage: '', positions: [{ id, label: id, assets: [{ ...asset }], suppliedUsd: 11, debtUsd: 5, healthFactor: 2, risk: 'lower', notes: [] }] }));
  for (const network of ['ethereum', 'plasma', 'arbitrum'] as const) {
    const load = vi.fn(async () => quote);
    const result = await applyIntrinsicRates(protocols, network, load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.every(p => p.positions[0].assets[0].intrinsicSupplyRate?.apr === quote.apr)).toBe(true);
    expect(result.every(p => p.positions[0].assets[0].supplyRate?.apr === .02)).toBe(true);
    expect(protocols[0].positions[0].assets[0].intrinsicSupplyRate).toBeUndefined();
  }
  protocols[0].positions[0].assets[0].address = '0x1111111111111111111111111111111111111111';
  for (const p of protocols.slice(1)) p.positions[0].assets[0].supplied = 0;
  const load = vi.fn(async () => quote);
  await applyIntrinsicRates(protocols, 'ethereum', load); expect(load).not.toHaveBeenCalled();
  protocols[0].positions[0].assets[0].address = SUSDAI;
  const failed = await applyIntrinsicRates(protocols, 'ethereum', async () => { throw new Error('private-provider-secret'); });
  expect(failed[0].positions[0].assets[0].intrinsicSupplyRate?.apr).toBeNull();
  expect(failed[0].positions[0].assets[0].supplyRate?.apr).toBe(.02);
  expect(JSON.stringify(failed)).not.toContain('private-provider-secret');
});
