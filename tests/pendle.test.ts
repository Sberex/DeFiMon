import { expect, it, vi } from 'vitest';
import { createPendleCatalog, mergePendleWallet, readPendle, unavailablePendle, PENDLE_ORACLE, type PendleMarket } from '../server/pendle';
import type { ChainClient } from '../server/rpc';
import type { NetworkId, WalletBalances } from '../src/types';
const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`;
const wallet = address(99), blockNumber = 123n, now = Math.floor(Date.parse('2026-11-17T10:00:00Z') / 1000);
function market(chainId = 1, index = 0): PendleMarket {
  const token = (n: number, symbol: string, decimals = 6) => ({ address: address(n + index * 10), symbol, decimals, chainId, price: { usd: .98 }, priceUpdatedAt: new Date(now * 1000).toISOString() });
  return { address: address(1 + index * 10), chainId, pt: { ...token(2, 'PT-reUSD'), proName: 'PT reUSD (USDC)' }, yt: token(3, 'YT-reUSD'), sy: token(4, 'SY-reUSD', 18), accountingAsset: token(5, 'USDC'), expiry: '2026-12-10T00:00:00Z', impliedApy: .12, underlyingApy: .07, liquidity: { usd: 500000 }, dataUpdatedAt: new Date(now * 1000).toISOString() };
}
function client(m: PendleMarket, options: { expired?: boolean; failPrice?: boolean; failIdentity?: boolean; failedBalance?: boolean } = {}) {
  const calls: any[] = [];
  const c = {
    getBlock: async (args: any) => { expect(args.blockNumber).toBe(blockNumber); return { timestamp: BigInt(options.expired ? Date.parse(m.expiry) / 1000 : now) }; },
    multicall: async (args: any) => { expect(args.blockNumber).toBe(blockNumber); expect(args.contracts).toHaveLength(2); return args.contracts.map((_: any, i: number) => options.failedBalance && i === 1 ? { status: 'failure' } : { status: 'success', result: i === 0 ? 1234567n : 2000000n }); },
    readContract: async (args: any) => {
      calls.push(args); expect(args.blockNumber).toBe(blockNumber);
      switch (args.functionName) {
        case 'readTokens': return [m.sy.address, options.failIdentity ? address(700) : m.pt.address, m.yt.address];
        case 'expiry': return BigInt(Date.parse(m.expiry) / 1000);
        case 'decimals': return 6;
        case 'assetInfo': return [0, m.accountingAsset.address, 6];
        case 'getPtToAssetRate': if (options.failPrice) throw new Error('secret-provider-key'); return options.expired ? 10n ** 18n : 99n * 10n ** 16n;
        case 'getYtToAssetRate': if (options.failPrice) throw new Error('secret-provider-key'); return options.expired ? 0n : 10n ** 16n;
        default: throw new Error('Unexpected function');
      }
    },
  } as unknown as ChainClient;
  return { c, calls };
}
it.each([['ethereum', 1], ['plasma', 9745], ['arbitrum', 42161], ['base', 8453]] as const)('discovers %s markets by its chain ID and caches only complete pages', async (network, chainId) => {
  const fetcher = vi.fn(async (url: any) => { expect(String(url)).toContain(`/v1/${chainId}/markets`); return new Response(JSON.stringify({ total: 1, results: [market(chainId)] })); });
  const catalog = createPendleCatalog(fetcher as any);
  expect(await catalog(network)).toHaveLength(1); await catalog(network); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('includes all catalog pages rather than only active or first-page markets', async () => {
  const markets = Array.from({ length: 101 }, (_, i) => market(1, i));
  const catalog = createPendleCatalog((async (url: any) => { const skip = Number(new URL(url).searchParams.get('skip')); return new Response(JSON.stringify({ total: 101, results: markets.slice(skip, skip + 100) })); }) as any);
  expect(await catalog('ethereum')).toHaveLength(101);
});
it('rejects incomplete pages and wrong-chain catalogs without caching failure as an empty wallet', async () => {
  let invalid = true;
  const fetcher = vi.fn(async () => new Response(JSON.stringify(invalid ? { total: 2, results: [market()] } : { total: 1, results: [market()] })));
  const catalog = createPendleCatalog(fetcher as any);
  await expect(catalog('ethereum')).rejects.toThrow('Incomplete'); invalid = false;
  expect(await catalog('ethereum')).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(2);
  await expect(createPendleCatalog((async () => new Response(JSON.stringify({ total: 1, results: [market(42161)] }))) as any)('ethereum')).rejects.toThrow('identity');
});
it('accepts native ETH as the accounting unit without treating zero-address PT/YT contracts as valid', async () => {
  const m = market(); m.accountingAsset = { ...m.accountingAsset, address: address(0), symbol: 'ETH', decimals: 18 };
  const fetcher = (async () => new Response(JSON.stringify({ total: 1, results: [m] }))) as any;
  expect(await createPendleCatalog(fetcher)('ethereum')).toHaveLength(1);
  m.pt.address = address(0); await expect(createPendleCatalog(fetcher)('ethereum')).rejects.toThrow('identity');
});
it('values six-decimal PT/YT balances in the verified accounting asset and its actual USD price', async () => {
  const m = market(), { c, calls } = client(m), result = await readPendle(c, wallet, blockNumber, 'ethereum', async () => [m]);
  expect(result.coverage.status).toBe('ok'); const pt = result.tokens.find(t => t.pendle?.kind === 'PT')!;
  expect(pt.balance).toBe(1.234567); expect(pt.pendle?.oraclePrice).toBe(.99); expect(pt.pendle?.quoteValue).toBeCloseTo(1.234567 * .99);
  expect(pt.priceUsd).toBeCloseTo(.99 * .98); expect(pt.valueUsd).toBeCloseTo(1.234567 * .99 * .98);
  expect(pt.pendle).toMatchObject({ impliedApy: .12, underlyingApy: .07, tvlUsd: 500000, expiry: Date.parse(m.expiry) / 1000, matured: false });
  const priceCalls = calls.filter(c => c.functionName.includes('ToAssetRate'));
  expect(priceCalls).toHaveLength(2); expect(priceCalls.every(c => c.address === PENDLE_ORACLE && c.args[1] === 0)).toBe(true);
});
it('does not turn oracle failure, failed balances, stale USD data or an asset mismatch into zero values', async () => {
  const m = market();
  for (const options of [{ failPrice: true }, { failIdentity: true }]) {
    const r = await readPendle(client(m, options).c, wallet, blockNumber, 'ethereum', async () => [m]);
    expect(r.coverage.status).toBe('partial'); expect(r.tokens.every(t => t.valueUsd === null)).toBe(true); expect(JSON.stringify(r)).not.toContain('secret-provider-key');
  }
  const failed = await readPendle(client(m, { failedBalance: true }).c, wallet, blockNumber, 'ethereum', async () => [m]);
  expect(failed.coverage.status).toBe('partial'); expect(failed.tokens).toHaveLength(1);
  m.accountingAsset.priceUpdatedAt = '2020-01-01T00:00:00Z'; m.dataUpdatedAt = '2020-01-01T00:00:00Z';
  const stale = await readPendle(client(m).c, wallet, blockNumber, 'ethereum', async () => [m]);
  expect(stale.tokens[0].valueUsd).toBeNull(); expect(stale.tokens[0].pendle?.oraclePrice).not.toBeNull(); expect(stale.tokens[0].pendle?.impliedApy).toBeNull(); expect(stale.tokens[0].pendle?.tvlUsd).toBeNull();
});
it('shows expired YT future value as zero and leaves claimable interest separate', async () => {
  const m = market(), r = await readPendle(client(m, { expired: true }).c, wallet, blockNumber, 'ethereum', async () => [m]);
  const yt = r.tokens.find(t => t.pendle?.kind === 'YT')!;
  expect(yt.valueUsd).toBe(0); expect(yt.pendle).toMatchObject({ matured: true, oraclePrice: 0, impliedApy: null, underlyingApy: null });
  expect(yt.pendle?.notes.join(' ')).toContain('unclaimed');
});
it('deduplicates wallet PT/YT value, retains generic unknown counts and never changes lending NPL', async () => {
  const m = market(), result = await readPendle(client(m).c, wallet, blockNumber, 'ethereum', async () => [m]);
  const walletData: WalletBalances = { chain: 'Ethereum', status: 'ok', coverage: '', tokens: [{ address: m.pt.address, symbol: 'OLD', balance: 1.234567, priceUsd: null, valueUsd: null }, { address: 'native', symbol: 'ETH', balance: 1, priceUsd: 100, valueUsd: 100 }], pricedValueUsd: 100, unpricedCount: 3 };
  const combined = mergePendleWallet(walletData, result);
  expect(combined.tokens).toHaveLength(3); expect(combined.tokens.filter(t => t.address === m.pt.address)).toHaveLength(1);
  expect(combined.pricedValueUsd).toBeCloseTo(100 + result.tokens.reduce((s, t) => s + t.valueUsd!, 0)); expect(combined.unpricedCount).toBe(2);
  expect(walletData.tokens[0].valueUsd).toBeNull();
  expect(unavailablePendle('plasma').coverage.status).toBe('error');
  expect(mergePendleWallet(walletData, unavailablePendle('ethereum')).status).toBe('partial');
});

it('allows canonical cross-chain accounting units while requiring local PT/YT and SY contracts', async () => {
  const m = market(42161); m.accountingAsset.chainId = 1;
  const catalog = createPendleCatalog((async () => new Response(JSON.stringify({ total: 1, results: [m] }))) as any);
  expect(await catalog('arbitrum')).toHaveLength(1);
  const result = await readPendle(client(m).c, wallet, blockNumber, 'arbitrum', async () => [m]);
  expect(result.coverage.status).toBe('ok'); expect(result.tokens[0].pendle?.notes.join(' ')).toContain('accounting unit references');
});
