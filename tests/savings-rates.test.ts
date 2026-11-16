import { expect, it, vi } from 'vitest';
import { createSavingsRateService, savingsApr, savingsSnapshot, savingsFailureReason, type SavingsSource } from '../server/savings-rates';
import { applyIntrinsicRates } from '../server/intrinsic-rates';
import { positionMonthlyInterest, supplyApr } from '../src/monthly-interest';
import type { ChainClient } from '../server/rpc';
import type { IntrinsicRate, ProtocolResult } from '../src/types';
const END = 1000000n, NOW = 2000000000n, OLD = END - 216000n;
const token = '0x5086bf358635b81d8c47c66d1c8b9e567db70c72', feed = '0x72B5760cFBE437DD01409f44055fDfB8f8121B46';
const usds = '0xdc035d45d973e3ec169d2276ddab16f1e407384f';
function fixture(options: { end?: bigint; failHistory?: boolean; stale?: boolean; changedUnit?: boolean; wrongAsset?: boolean; chain?: number } = {}) {
  const reads: bigint[] = [], blocks: bigint[] = [];
  const client = {
    getChainId: async () => options.chain ?? 1,
    getBlockNumber: async () => END,
    getBlock: async ({ blockNumber }: any) => { blocks.push(blockNumber); return { number: blockNumber, timestamp: NOW - (END - blockNumber) * 12n }; },
    readContract: async ({ functionName, address, blockNumber }: any) => {
      reads.push(blockNumber);
      if (options.failHistory && blockNumber < END) throw new Error('private-rpc-key');
      const old = blockNumber <= OLD, time = NOW - (END - blockNumber) * 12n;
      if (functionName === 'latestRoundData') return [0n, old ? 10n ** 18n : options.end ?? 102n * 10n ** 16n, time - (options.stale ? 4n * 86400n : 60n), time - (options.stale ? 4n * 86400n : 60n), 0n];
      if (functionName === 'description') return 'reUSD/USD exchange rate';
      if (functionName === 'decimals') return options.changedUnit && old ? 6 : 18;
      if (functionName === 'asset') return options.wrongAsset ? feed : usds;
      if (functionName === 'convertToAssets') return old ? 10n ** 18n : options.end ?? 102n * 10n ** 16n;
      throw new Error('Unsupported fixture read');
    },
  } as unknown as ChainClient;
  const source: SavingsSource = { network: 'ethereum', token, kind: 'chainlink', address: feed, description: 'reUSD/USD exchange rate', decimals: 18, label: 'reUSD/USD exchange-rate oracle' };
  const registry = { reUSD: { category: 'Savings stablecoin' as const, addresses: { ethereum: token, base: '0x7d214438d0f27afccc23b3d1e1a53906ace5cfea' } } };
  return { client, source, registry, reads, blocks };
}
it('finds and verifies the exact 30-day historical block boundary', async () => {
  const f = fixture(); const s = await savingsSnapshot(f.client, 'ethereum');
  expect(s.start).toEqual({ number: OLD, timestamp: NOW - 30n * 86400n });
  expect(s.end.number).toBe(END); expect(f.blocks.length).toBeLessThan(30);
});
it('uses oracle prices and the requested fixed 30-day formula, including round-zero adapters', async () => {
  const f = fixture(); const service = createSavingsRateService({ clientFor: () => f.client, registry: f.registry, sources: { reUSD: f.source } });
  const quote = await service.quote('reUSD', { network: 'ethereum' });
  expect(quote.apr).toBeCloseTo(.02 * 365 / 30, 12);
  expect(quote.source).toMatchObject({ kind: 'chainlink', oracle: feed, startBlockNumber: String(OLD), blockNumber: String(END), startRate: 1, endRate: 1.02, windowDays: 30 });
  expect(f.reads).toContain(OLD); expect(f.reads).toContain(END);
  expect(savingsApr(10n ** 18n, 99n * 10n ** 16n)).toBeCloseTo(-.01 * 365 / 30);
  expect(savingsApr(100n, 100n)).toBe(0); expect(savingsApr(0n, 100n)).toBeNull();
});
it('reads a verified ERC-4626 share rate in the same units at both blocks', async () => {
  const f = fixture(); f.source = { ...f.source, kind: 'erc4626', address: token, underlying: usds, label: 'Savings redemption rate' };
  const quote = await createSavingsRateService({ clientFor: () => f.client, registry: f.registry, sources: { reUSD: f.source } }).quote('reUSD', { network: 'ethereum' });
  expect(quote.apr).toBeCloseTo(.02 * 365 / 30); expect(quote.source.kind).toBe('erc4626');
});
it('keeps missing archive state, stale feeds, changed units, wrong chains and zero prices unknown', async () => {
  for (const options of [{ failHistory: true }, { stale: true }, { changedUnit: true }, { chain: 42161 }, { end: 0n }]) {
    const f = fixture(options); const quote = await createSavingsRateService({ clientFor: () => f.client, registry: f.registry, sources: { reUSD: f.source } }).quote('reUSD', { network: 'ethereum' });
    expect(quote.apr).toBeNull(); expect(JSON.stringify(quote)).not.toContain('private-rpc-key');
  }
  const f = fixture({ wrongAsset: true }); f.source = { ...f.source, kind: 'erc4626', address: token, underlying: usds };
  expect((await createSavingsRateService({ clientFor: () => f.client, registry: f.registry, sources: { reUSD: f.source } }).quote('reUSD', { network: 'ethereum' })).apr).toBeNull();
});
it('deduplicates quote requests across bridged networks and shares its in-flight read', async () => {
  const f = fixture(); const clientFor = vi.fn(() => f.client);
  const service = createSavingsRateService({ clientFor, registry: f.registry, sources: { reUSD: f.source } });
  const [a, b] = await Promise.all([service.quote('reUSD', { network: 'ethereum' }), service.quote('reUSD', { network: 'base' })]);
  expect(a).toBe(b); expect(clientFor).toHaveBeenCalledTimes(1);
});
it('adds savings yield once to protocol supply APR, monthly earnings and NPL, without matching by symbol', async () => {
  const asset = { symbol: 'reUSD', address: token, supplied: 1000, borrowed: 0, priceUsd: 1.1, collateral: true, liquidationThreshold: .9, liquidationPriceUsd: null, supplyRate: { apr: .02, note: 'Protocol APR' } };
  const p: ProtocolResult = { id: 'morpho', name: 'Morpho', status: 'ok', coverage: '', positions: [{ id: 'loan', label: 'reUSD / USDC', suppliedUsd: 1100, debtUsd: 500, healthFactor: 2, risk: 'lower', notes: [], assets: [asset, { ...asset, symbol: 'USDC', address: usds, supplied: 0, borrowed: 500, priceUsd: 1, collateral: false, borrowRate: { apr: .06, note: 'Borrow APR' } }] }] };
  const load = vi.fn(async (): Promise<IntrinsicRate> => ({ apr: .12, estimated: true, note: 'Verified month', source: { chain: 'Ethereum', oracle: feed } }));
  const result = await applyIntrinsicRates([p], 'ethereum', undefined, load);
  const updated = result[0].positions[0];
  expect(load).toHaveBeenCalledTimes(1);
  expect(supplyApr(updated.assets[0].supplyRate, updated.assets[0].intrinsicSupplyRate)).toBeCloseTo(.14);
  expect(positionMonthlyInterest(updated).earnedUsd).toBeCloseTo(1000 * .14 / 12 * 1.1);
  expect(positionMonthlyInterest(updated).paidUsd).toBeCloseTo(2.5);
  expect(p.positions[0].assets[0].intrinsicSupplyRate).toBeUndefined();
  const again = await applyIntrinsicRates(result, 'ethereum', undefined, load);
  expect(positionMonthlyInterest(again[0].positions[0]).earnedUsd).toBe(positionMonthlyInterest(updated).earnedUsd);
  p.positions[0].assets[0].address = feed;
  await applyIntrinsicRates([p], 'ethereum', undefined, load); expect(load).toHaveBeenCalledTimes(2);
});

it('retries unavailable history after one minute instead of caching it as a zero return', async () => {
  let now = 0; const f = fixture({ failHistory: true });
  const service = createSavingsRateService({ clientFor: () => f.client, registry: f.registry, sources: { reUSD: f.source }, now: () => now });
  expect((await service.quote('reUSD', { network: 'ethereum' })).apr).toBeNull();
  const reads = f.reads.length; await service.quote('reUSD', { network: 'ethereum' }); expect(f.reads.length).toBe(reads);
  now = 60001; expect((await service.quote('reUSD', { network: 'ethereum' })).apr).toBeNull();
  expect(f.reads.length).toBeGreaterThan(reads);
});

it('explains historical-access failures without disclosing provider credentials', () => {
  const reason = savingsFailureReason(new Error('Archive requests require a personal token https://private.example/secret'));
  expect(reason).toContain('Configure an archive RPC');
  expect(reason).not.toContain('private.example'); expect(reason).not.toContain('secret');
  expect(savingsFailureReason(new Error('No verified savings rate source'))).toContain('No verified');
});
