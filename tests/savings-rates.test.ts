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

it('uses configured mHYPER NAV for wallet earnings and preserves plain iUSD as a non-yield stablecoin', async () => {
  const { configuredTokenRegistry } = await import('../server/token-registry');
  const { applyWalletInterest } = await import('../server/wallet-interest');
  const { totalMonthlyInterest } = await import('../src/monthly-interest');
  const { walletInterestIssues } = await import('../src/wallet-interest');
  const sources = Object.fromEntries(Object.entries(configuredTokenRegistry).filter(([, t]) => t.intrinsicOracles?.length).map(([name, t]) => [name, t.intrinsicOracles![0]]));
  const reads: { address: string; block: bigint }[] = [];
  const client = {
    getChainId: async () => 1, getBlockNumber: async () => END,
    getBlock: async ({ blockNumber }: any) => ({ number: blockNumber, timestamp: NOW - (END - blockNumber) * 12n }),
    readContract: async ({ address, functionName, blockNumber }: any) => {
      reads.push({ address, block: blockNumber });
      const group = address.toLowerCase() === sources.MHYPER.address.toLowerCase() ? 'MHYPER' : 'IUSD', s = sources[group];
      const timestamp = NOW - (END - blockNumber) * 12n;
      if (functionName === 'decimals') return s.decimals;
      if (functionName === 'description') return s.description;
      if (functionName === 'receiptToken') return s.token;
      if (functionName === 'latestRoundData') return group === 'IUSD' ? [0n, 10n ** 18n, 0n, timestamp, 0n] : [136n, blockNumber <= OLD ? 113482542n : 114224794n, timestamp - 60n, timestamp - 60n, 136n];
      throw new Error('Unexpected read');
    },
  } as unknown as ChainClient;
  const service = createSavingsRateService({ clientFor: () => client, sources });
  const wallet = { chain: 'Ethereum' as const, status: 'ok' as const, pricedValueUsd: 4.4049, unpricedCount: 0, coverage: '', interestDiscoveryComplete: true, tokens: [
    { address: configuredTokenRegistry.MHYPER.addresses.ethereum!, symbol: 'mHYPER', category: 'Savings stablecoin' as const, balance: 3.8540620944124493, priceUsd: 1.14224794, valueUsd: 4.402294487974706 },
    { address: configuredTokenRegistry.IUSD.addresses.ethereum!, symbol: 'iUSD', category: 'Stablecoin' as const, balance: .002610186822595611, priceUsd: .9991497, valueUsd: .0026079674814105036 },
  ] };
  const { intrinsicTokenRate } = await import('../server/intrinsic-rates');
  const enriched = await applyWalletInterest(wallet, 'ethereum', [], (network, address) => intrinsicTokenRate(network, address, {}, undefined, service.quote));
  expect(enriched.status).toBe('ok'); expect(walletInterestIssues([enriched])).toEqual([]);
  expect(enriched.tokens[0].intrinsicSupplyRate?.apr).toBeCloseTo(.0795781668925487);
  expect(configuredTokenRegistry.IUSD.category).toBe('Stablecoin');
  expect(enriched.tokens[1].intrinsicSupplyRate).toBeUndefined();
  expect(reads.some(r => r.address === sources.IUSD.address)).toBe(false);
  expect(totalMonthlyInterest([], [enriched]).nplUsd).toBeCloseTo(4.402294487974706 * .0795781668925487 / 12);
  for (const group of ['MHYPER']) {
    expect(reads.some(r => r.address === sources[group].address && r.block === OLD)).toBe(true);
    expect(reads.some(r => r.address === sources[group].address && r.block === END)).toBe(true);
  }
});

it('accepts explicitly identified computed oracles, including losses, but rejects altered tokens and invalid computed timestamps', async () => {
  const f = fixture();
  const source: SavingsSource = { ...f.source, computed: true, tokenGetter: 'receiptToken' };
  for (const variant of ['zero', 'loss', 'wrong-old-token', 'missing-token-getter', 'stale', 'future', 'nonzero-round', 'nonzero-start'] as const) {
    const client = { ...f.client, readContract: async (args: any) => {
      if (args.functionName === 'receiptToken') return variant === 'wrong-old-token' && args.blockNumber <= OLD ? feed : token;
      if (args.functionName === 'latestRoundData') {
        const t = NOW - (END - args.blockNumber) * 12n;
        return [variant === 'nonzero-round' ? 1n : 0n, args.blockNumber > OLD && variant === 'loss' ? 99n * 10n ** 16n : 10n ** 18n, variant === 'nonzero-start' ? 1n : 0n, t + (variant === 'stale' ? -60n : variant === 'future' ? 60n : 0n), 0n];
      }
      return f.client.readContract(args);
    } } as ChainClient;
    const q = await createSavingsRateService({ clientFor: () => client, registry: f.registry, sources: { reUSD: { ...source, tokenGetter: variant === 'missing-token-getter' ? undefined : 'receiptToken' } } }).quote('reUSD', { network: 'ethereum' });
    if (variant === 'zero') expect(q.apr).toBe(0);
    else if (variant === 'loss') expect(q.apr).toBeCloseTo(-.01 * 365 / 30);
    else expect(q.apr).toBeNull();
  }
  const client = { ...f.client, readContract: async (args: any) => args.functionName === 'latestRoundData' ? [0n, 10n ** 18n, 0n, NOW - (END - args.blockNumber) * 12n, 0n] : f.client.readContract(args) } as ChainClient;
  expect((await createSavingsRateService({ clientFor: () => client, registry: f.registry, sources: { reUSD: f.source } }).quote('reUSD', { network: 'ethereum' })).apr).toBeNull();
});

it('retries pruned history once through an independent verified archive snapshot without masking oracle validation failures', async () => {
  const f = fixture(), fallback = vi.fn(() => f.client);
  const primary = { ...f.client, readContract: async () => { throw new Error('historical state pruned: private-provider-key'); } } as unknown as ChainClient;
  const service = createSavingsRateService({ clientFor: () => primary, archiveFallbackFor: fallback, registry: f.registry, sources: { reUSD: f.source } });
  const q = await service.quote('reUSD', { network: 'ethereum' });
  expect(q.apr).toBeCloseTo(.02 * 365 / 30); expect(fallback).toHaveBeenCalled();
  expect(JSON.stringify(q)).not.toContain('private-provider-key');
  const noRetry = vi.fn(() => f.client), bad = fixture({ stale: true });
  expect((await createSavingsRateService({ clientFor: () => bad.client, archiveFallbackFor: noRetry, registry: f.registry, sources: { reUSD: f.source } }).quote('reUSD', { network: 'ethereum' })).apr).toBeNull();
  expect(noRetry).not.toHaveBeenCalled();
  const badArchive = fixture({ chain: 42161 });
  expect((await createSavingsRateService({ clientFor: () => primary, archiveFallbackFor: () => badArchive.client, registry: f.registry, sources: { reUSD: f.source } }).quote('reUSD', { network: 'ethereum' })).apr).toBeNull();
});

it('enriches the reported Hastra PRIME/PYUSD collateral with its exact oracle, excluding unrelated PRIME tickers', async () => {
  const { configuredTokenRegistry } = await import('../server/token-registry');
  const { savingsGroup } = await import('../server/savings-rates');
  const { annualizedNplApr, totalMonthlyInterest } = await import('../src/monthly-interest');
  const sources = Object.fromEntries(Object.entries(configuredTokenRegistry).filter(([, t]) => t.intrinsicOracles?.length).map(([name, t]) => [name, t.intrinsicOracles![0]]));
  const source = sources['Hastra-PRIME'];
  expect(source.token).toBe('0x19ebb35279a16207ec4ba82799cc64715065f7f6');
  expect(savingsGroup('ethereum', source.token)).toBe('Hastra-PRIME');
  expect(savingsGroup('ethereum', configuredTokenRegistry.PRIME.addresses.ethereum!)).toBeUndefined();
  const start = 1065661134590332800n, end = 1071060177801187095n;
  const reads: bigint[] = [];
  const client = {
    getChainId: async () => 1, getBlockNumber: async () => END,
    getBlock: async ({ blockNumber }: any) => ({ number: blockNumber, timestamp: NOW - (END - blockNumber) * 12n }),
    readContract: async ({ address, functionName, blockNumber }: any) => {
      expect(address.toLowerCase()).toBe(source.address.toLowerCase()); reads.push(blockNumber);
      if (functionName === 'description') return 'PRIME / WYLDS Exchange Rate';
      if (functionName === 'decimals') return 18;
      const time = NOW - (END - blockNumber) * 12n - 60n;
      if (functionName === 'latestRoundData') return [211n, blockNumber <= OLD ? start : end, time, time, 211n];
      throw new Error('Unexpected source read');
    },
  } as unknown as ChainClient;
  const service = createSavingsRateService({ clientFor: () => client, sources });
  const asset = { address: source.token, symbol: 'PRIME', supplied: 114853.868672, borrowed: 0, priceUsd: 122947.56 / 114853.868672, collateral: true, liquidationThreshold: .86, liquidationPriceUsd: 1.01, supplyRate: { apr: 0, note: 'No Morpho collateral lending income' } };
  const protocol: ProtocolResult = { id: 'morpho', name: 'Morpho', status: 'ok', coverage: '', positions: [{ id: 'morpho-market-0x41c41d0c9aadbf4751f5ee215ed5a16954a4b34e1b70fca5393d4b08858fa3fa', label: 'PRIME / PYUSD', suppliedUsd: 122947.56, debtUsd: 100199.03, healthFactor: 1.06, risk: 'high', notes: [], assets: [asset, { ...asset, address: '0x6c3ea9036406852006290770bedfcaba0e23a0e8', symbol: 'PYUSD', supplied: 0, borrowed: 100199.03, priceUsd: 1, collateral: false, borrowRate: { apr: .06, note: 'Borrow APR' } }] }] };
  const result = await applyIntrinsicRates([protocol], 'ethereum', undefined, service.quote);
  const pos = result[0].positions[0], a = pos.assets[0], m = positionMonthlyInterest(pos), apr = savingsApr(start, end)!;
  expect(apr).toBeCloseTo(.06164094469922217);
  expect(supplyApr(a.supplyRate, a.intrinsicSupplyRate)).toBeCloseTo(apr);
  expect(m.earnedUsd).toBeCloseTo(122947.56 * apr / 12);
  expect(m.nplUsd).toBeCloseTo((122947.56 * apr - 100199.03 * .06) / 12);
  expect(annualizedNplApr(m.nplUsd, 122947.56 - 100199.03)).toBeGreaterThan(0);
  expect(totalMonthlyInterest(result).nplUsd).toBe(m.nplUsd);
  expect(totalMonthlyInterest(await applyIntrinsicRates(result, 'ethereum', undefined, service.quote)).nplUsd).toBe(m.nplUsd);
  expect(reads).toContain(OLD); expect(reads).toContain(END);
  const unrelated = structuredClone(protocol); unrelated.positions[0].assets[0].address = configuredTokenRegistry.PRIME.addresses.ethereum!;
  expect((await applyIntrinsicRates([unrelated], 'ethereum', undefined, service.quote))[0].positions[0].assets[0].intrinsicSupplyRate).toBeUndefined();
});

it('matches configured oracle sources by chain and contract even when both config labels are renamed', async () => {
  const f = fixture();
  const registry = { 'Arbitrary edited label': f.registry.reUSD };
  const sources = { 'A different oracle label': f.source };
  const q = await createSavingsRateService({ clientFor: () => f.client, registry, sources }).quote('Arbitrary edited label', { network: 'base' });
  expect(q.apr).toBeCloseTo(.02 * 365 / 30);
  expect(q.source.oracle).toBe(feed);
});

it('ignores matching names with different contracts or chains and rejects ambiguous oracle identities', async () => {
  const f = fixture();
  const client = { ...f.client, readContract: async () => { throw new Error('No automatic source'); } } as unknown as ChainClient;
  const other = '0x1111111111111111111111111111111111111111';
  for (const source of [{ ...f.source, token: other }, { ...f.source, network: 'arbitrum' as const }] satisfies SavingsSource[]) {
    const q = await createSavingsRateService({ clientFor: () => client, registry: f.registry, sources: { reUSD: source } }).quote('reUSD', { network: 'ethereum' });
    expect(q.apr).toBeNull();
    expect(q.source.oracle).not.toBe(feed);
  }
  const q = await createSavingsRateService({ clientFor: () => f.client, registry: f.registry, sources: { one: f.source, two: { ...f.source, address: other } } }).quote('reUSD', { network: 'ethereum' });
  expect(q.apr).toBeNull();
  expect(q.note).toContain('Multiple configured rate sources');
});

it('uses ordered inline oracle sources for lending and wallet balances without mixing their historical observations', async () => {
  const { applyWalletInterest } = await import('../server/wallet-interest');
  const { intrinsicTokenRate } = await import('../server/intrinsic-rates');
  const { totalMonthlyInterest } = await import('../src/monthly-interest');
  const f = fixture(), alternate = '0x1111111111111111111111111111111111111111';
  const registry: import('../server/token-registry').TokenRegistry = { reUSD: { ...f.registry.reUSD, intrinsicOracles: [f.source, { ...f.source, address: alternate, label: 'Alternative verified oracle' }] } };
  const reads: { address: string; block: bigint }[] = [];
  const client = { ...f.client, readContract: async (args: any) => {
    reads.push({ address: args.address, block: args.blockNumber });
    if (args.address === feed && args.functionName === 'latestRoundData') {
      if (args.blockNumber <= OLD) throw new Error('Old source unavailable');
      return [0n, 900n * 10n ** 18n, NOW - 60n, NOW - 60n, 0n];
    }
    return f.client.readContract(args);
  } } as unknown as ChainClient;
  const service = createSavingsRateService({ clientFor: () => client, registry });
  const quote = await service.quote('reUSD', { network: 'base' });
  expect(quote.apr).toBeCloseTo(.02 * 365 / 30);
  expect(quote.source).toMatchObject({ oracle: alternate, startRate: 1, endRate: 1.02, chain: 'Ethereum' });
  expect(reads.some(r => r.address === alternate && r.block === OLD)).toBe(true);
  expect(reads.some(r => r.address === alternate && r.block === END)).toBe(true);
  const asset = { symbol: 'Label does not select the oracle', address: token, supplied: 100, borrowed: 0, priceUsd: 1.1, collateral: true, liquidationThreshold: .9, liquidationPriceUsd: null, supplyRate: { apr: 0, note: '' } };
  const protocol: ProtocolResult = { id: 'morpho', name: 'Morpho', status: 'ok', coverage: '', positions: [{ id: 'loan', label: '', suppliedUsd: 110, debtUsd: 0, risk: 'no-debt', healthFactor: null, notes: [], assets: [asset] }] };
  const enriched = await applyIntrinsicRates([protocol], 'ethereum', undefined, service.quote);
  expect(enriched[0].positions[0].assets[0].intrinsicSupplyRate).toEqual(quote);
  const wallet = await applyWalletInterest({ chain: 'Ethereum', status: 'ok', tokens: [{ symbol: 'Different wallet label', address: token, category: 'Savings stablecoin', balance: 100, priceUsd: 1.1, valueUsd: 110 }], pricedValueUsd: 110, unpricedCount: 0, coverage: '', interestDiscoveryComplete: true }, 'ethereum', [], (network, address) => intrinsicTokenRate(network, address, {}, undefined, service.quote));
  expect(wallet.tokens[0].intrinsicSupplyRate).toEqual(quote);
  expect(totalMonthlyInterest(enriched, [wallet]).earnedUsd).toBeCloseTo(220 * quote.apr! / 12);
});
