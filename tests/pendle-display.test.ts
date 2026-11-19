import { expect, it } from 'vitest';
import type { WalletBalances, WalletToken } from '../src/types';
import { groupPendleHoldings } from '../src/pendle-display';
const token = (id: number, value: number | null, matured: boolean | null = false): WalletToken => ({ address: `0x${String(id).padStart(40, '0')}`, symbol: `PT${id}`, balance: 10, priceUsd: value === null ? null : value / 10, valueUsd: value, pendle: { kind: 'PT', name: `PT ${id}`, marketAddress: 'market', syAddress: 'sy', quoteAsset: { address: 'quote', symbol: 'USDC' }, oraclePrice: 1, quoteValue: 10, impliedApy: .1, underlyingApy: 0, tvlUsd: 1000, expiry: 1800000000, matured, oracleAddress: 'oracle', blockNumber: '100', marketUpdatedAt: null, notes: [] } });
const wallet = (tokens: WalletToken[], chain: WalletBalances['chain'] = 'Ethereum'): WalletBalances => ({ chain, status: 'ok', tokens, pricedValueUsd: 1000, unpricedCount: 0, coverage: '', pendle: { status: 'ok', marketCount: 100, blockNumber: '100', coverage: '' } });
it('collapses zero values and verified expiry including redeemable PT, without changing balances or portfolio value', () => {
  const w = wallet([token(1, 10), token(2, 0), token(3, 1000, true), token(4, null), token(5, 20, null)]), before = structuredClone(w);
  const result = groupPendleHoldings([w]);
  expect(result.active[0].tokens.map(t => t.symbol)).toEqual(['PT5', 'PT1', 'PT4']);
  expect(result.collapsed[0].tokens.map(t => t.symbol)).toEqual(['PT3', 'PT2']);
  expect(w).toEqual(before); expect(w.pricedValueUsd).toBe(1000);
});
it('sorts active holdings by value across networks and puts unknown values last', () => {
  const result = groupPendleHoldings([wallet([token(1, 50)], 'Ethereum'), wallet([token(2, 100), token(3, 500)], 'Base'), wallet([token(4, null)], 'Arbitrum')]);
  expect(result.active.map(g => g.wallet.chain)).toEqual(['Base', 'Ethereum', 'Arbitrum']);
  expect(result.active[0].tokens.map(t => t.valueUsd)).toEqual([500, 100]);
  const interleaved = groupPendleHoldings([wallet([token(1, 10), token(2, 1000)]), wallet([token(3, 500)], 'Base')]);
  expect(interleaved.active.map(g => g.wallet.chain)).toEqual(['Ethereum', 'Base', 'Ethereum']);
  expect(interleaved.active.flatMap(g => g.tokens.map(t => t.valueUsd))).toEqual([1000, 500, 10]);
});
it('collapses verified empty networks but retains failed or incomplete discovery', () => {
  const ok = wallet([]), failed = wallet([], 'Base'), incomplete = wallet([], 'Arbitrum');
  failed.pendle!.status = 'error'; incomplete.pendle!.status = 'partial'; incomplete.pendle!.balanceDiscoveryComplete = false;
  const result = groupPendleHoldings([ok, failed, incomplete]);
  expect(result.collapsed.map(g => g.wallet.chain)).toEqual(['Ethereum']);
  expect(result.active.map(g => g.wallet.chain)).toEqual(['Base', 'Arbitrum']);
});
