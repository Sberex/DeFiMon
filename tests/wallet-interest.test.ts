import { expect, it, vi } from 'vitest';
import { applyWalletInterest } from '../server/wallet-interest';
import { walletCategoryInterest, walletTokenInterest, walletInterestIssues, interestBearingToken } from '../src/wallet-interest';
import { totalMonthlyInterest } from '../src/monthly-interest';
import { configuredTokenRegistry } from '../server/token-registry';
import { LIDO_WSTETH } from '../server/lido-rates';
import type { IntrinsicRate, WalletBalances, WalletToken, ProtocolResult } from '../src/types';
const saving = configuredTokenRegistry.sUSDai.addresses.ethereum!;
const quote = (apr: number | null): IntrinsicRate => ({ apr, estimated: true, note: 'Verified intrinsic quote', source: { chain: 'Ethereum', oracle: '', label: 'Verified source' } });
const token = (symbol: string, valueUsd: number | null, apr?: number | null): WalletToken => ({ symbol, address: symbol, balance: 100, priceUsd: valueUsd === null ? null : valueUsd / 100, valueUsd, category: 'Savings stablecoin', intrinsicSupplyRate: apr === undefined ? undefined : quote(apr) });
const wallet = (tokens: WalletToken[]): WalletBalances => ({ chain: 'Ethereum', status: 'ok', tokens, pricedValueUsd: tokens.reduce((s, t) => s + (t.valueUsd ?? 0), 0), unpricedCount: 0, coverage: '', interestDiscoveryComplete: true });
it('computes token earnings, USD-weighted category APR and adds wallet income once to lending NPL', () => {
  const w = wallet([token('A', 1000, .12), token('B', 3000, .04), { ...token('USDC', 10000), category: 'Stablecoin' }]);
  expect(walletTokenInterest(w.tokens[0])).toEqual({ earnedTokens: 1, earnedUsd: 10 });
  expect(walletCategoryInterest([w])).toMatchObject({ earnedUsd: 20, valueUsd: 4000, apr: .06 });
  const lending: ProtocolResult = { id: 'test', name: 'Lending', status: 'ok', coverage: '', positions: [{ id: 'loan', label: 'Loan', risk: 'lower', healthFactor: 2, suppliedUsd: 1000, debtUsd: 500, notes: [], assets: [
    { symbol: 'A', address: 'loan', supplied: 1000, borrowed: 500, priceUsd: 1, collateral: true, liquidationThreshold: .8, liquidationPriceUsd: null, supplyRate: { apr: .06, note: '' }, borrowRate: { apr: .12, note: '' } },
  ] }] };
  expect(totalMonthlyInterest([lending], [w])).toMatchObject({ earnedUsd: 25, paidUsd: 5, nplUsd: 20 });
  expect(totalMonthlyInterest([lending], [w]).nplUsd).toBe(20);
});
it('preserves zero and negative rates, skips known receipt income and does not treat missing data as zero', () => {
  expect(walletTokenInterest(token('A', 1000, 0)).earnedUsd).toBe(0);
  expect(walletTokenInterest(token('A', 1200, -.12)).earnedUsd).toBe(-12);
  const receipt = { ...token('Receipt', 10000, .5), excludedReason: 'Counted under protocol' };
  expect(walletCategoryInterest([wallet([receipt, token('A', 1000, .12)])])).toMatchObject({ earnedUsd: 10, valueUsd: 1000, apr: .12 });
  for (const t of [token('UnknownRate', 1000), token('UnknownPrice', null, .1), { ...token('UnknownBalance', 1000, .1), balance: null }]) {
    const w = wallet([t]); expect(walletCategoryInterest([w]).earnedUsd).toBeNull(); expect(totalMonthlyInterest([], [w]).nplUsd).toBeNull(); expect(walletInterestIssues([w])).toHaveLength(1);
  }
  expect(walletCategoryInterest([wallet([{ ...token('Zero', 0), balance: 0 }])])).toMatchObject({ earnedUsd: 0, apr: null });
});
it('keeps unverified discovery unknown while unrelated Other-token prices do not block known wallet yield', () => {
  const w = wallet([token('A', 1000, .12), { ...token('ETH', null), category: 'Other' }]); w.status = 'partial';
  expect(walletCategoryInterest([w]).earnedUsd).toBe(10);
  w.interestDiscoveryComplete = false; expect(totalMonthlyInterest([], [w]).nplUsd).toBeNull(); expect(walletInterestIssues([w])[0].reason).toContain('discovery');
  expect(walletCategoryInterest([{ ...w, status: 'error', tokens: [] }]).earnedUsd).toBeNull();
});
it('loads only wallet intrinsic yield, reuses lending source quotes, and never copies lending interest into wallet income', async () => {
  const w = wallet([{ ...token('sUSDai', 2000), address: saving }]);
  const load = vi.fn(async () => quote(.08));
  const enriched = await applyWalletInterest(w, 'ethereum', [], load);
  expect(load).toHaveBeenCalledWith('ethereum', saving); expect(enriched.tokens[0].intrinsicSupplyRate?.apr).toBe(.08); expect(walletCategoryInterest([enriched]).earnedUsd).toBeCloseTo(2000 * .08 / 12);
  const protocol = { id: 'test', positions: [{ assets: [{ address: saving, intrinsicSupplyRate: quote(.07), supplyRate: { apr: .5 } }] }] } as ProtocolResult;
  load.mockClear(); const reused = await applyWalletInterest(w, 'ethereum', [protocol], load);
  expect(load).not.toHaveBeenCalled(); expect(reused.tokens[0].intrinsicSupplyRate?.apr).toBe(.07);
  const again = await applyWalletInterest(reused, 'ethereum', [protocol], load);
  expect(walletCategoryInterest([again]).earnedUsd).toBe(walletCategoryInterest([reused]).earnedUsd);
  expect(w.tokens[0].intrinsicSupplyRate).toBeUndefined();
});
it.each(['ethereum', 'plasma', 'arbitrum', 'base'] as const)('recognizes wallet wstETH on %s using the same Lido source as collateral', async network => {
  const w = wallet([{ ...token('wstETH', 1000), category: 'Other', address: LIDO_WSTETH[network] }]);
  const lido = vi.fn(async () => quote(.0234)), load = vi.fn();
  const r = await applyWalletInterest(w, network, [], load, lido);
  expect(lido).toHaveBeenCalledTimes(1); expect(load).not.toHaveBeenCalled(); expect(interestBearingToken(r.tokens[0])).toBe(true); expect(walletTokenInterest(r.tokens[0]).earnedUsd).toBeCloseTo(1.95);
});
it('uses wallet PT Implied APY and verified expiry, without assigning YT a fixed income rate', async () => {
  const details = { kind: 'PT', impliedApy: .15, matured: false, marketAddress: '0x1111111111111111111111111111111111111111', oracleAddress: '', blockNumber: '123' } as any;
  const w = wallet([{ ...token('PT', 1200), category: 'Other', pendle: details }, { ...token('YT', 100), category: 'Other', pendle: { ...details, kind: 'YT' } }]);
  const r = await applyWalletInterest(w, 'ethereum', [], vi.fn());
  expect(walletTokenInterest(r.tokens[0]).earnedUsd).toBe(15); expect(r.tokens[0].intrinsicSupplyRate?.source.kind).toBe('pendle'); expect(interestBearingToken(r.tokens[1])).toBe(false);
  details.matured = true; details.impliedApy = null;
  expect((await applyWalletInterest(w, 'ethereum', [], vi.fn())).tokens[0].intrinsicSupplyRate?.apr).toBe(0);
});
it('keeps excluded receipt shares out of source lookups and reports unavailable intrinsic yields explicitly', async () => {
  const w = wallet([{ ...token('sUSDai', 1000), address: saving, excludedReason: 'Already counted in protocol' }]); const load = vi.fn();
  await applyWalletInterest(w, 'ethereum', [], load); expect(load).not.toHaveBeenCalled();
  delete w.tokens[0].excludedReason;
  const r = await applyWalletInterest(w, 'ethereum', [], async () => { throw new Error('secret'); });
  expect(r.tokens[0].intrinsicSupplyRate?.apr).toBeNull(); expect(r.status).toBe('partial'); expect(totalMonthlyInterest([], [r]).nplUsd).toBeNull(); expect(JSON.stringify(r)).not.toContain('secret');
});

it('marks incomplete savings-balance discovery without blocking income for unrelated failed Other-token reads', async () => {
  const { readWallet } = await import('../server/wallet');
  const { networks } = await import('../server/networks');
  const other = '0x2222222222222222222222222222222222222222';
  let failSavings = true;
  const client = {
    getBalance: async () => 0n,
    multicall: async ({ contracts }: any) => contracts.map((c: any) => c.address.toLowerCase() === saving ? (failSavings ? { status: 'failure' } : { status: 'success', result: 0n }) : { status: 'failure' }),
    readContract: async ({ functionName }: any) => functionName === 'getAllATokens' || functionName === 'getAllFTokens' ? [] : other,
  } as any;
  const catalog = [{ address: saving as `0x${string}`, symbol: 'sUSDai' }, { address: other as `0x${string}`, symbol: 'Other' }];
  const first = await readWallet(client, other, 123n, 'ethereum', [], [], catalog, async () => new Map());
  expect(first.interestDiscoveryComplete).toBe(false);
  failSavings = false;
  const second = await readWallet(client, other, 123n, 'ethereum', [], [], catalog, async () => new Map());
  expect(second.status).toBe('partial'); expect(second.interestDiscoveryComplete).toBe(true);
  expect(walletCategoryInterest([second]).earnedUsd).toBe(0);
});
