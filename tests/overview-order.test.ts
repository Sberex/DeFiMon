import { expect, it } from 'vitest';
import type { Position, ProtocolResult } from '../src/types';
import { orderOverviewMarkets } from '../src/overview-order';
const position = (id: string, supplied: number | null, debt = 0): Position => ({ id, label: id, suppliedUsd: supplied, debtUsd: debt, healthFactor: null, risk: 'no-debt', notes: [], assets: supplied === null ? [] : [{ symbol: 'USDC', address: 'token', supplied, borrowed: debt, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null }] });
const protocol = (id: string, positions: Position[] = []): ProtocolResult => ({ id, name: id, status: 'ok', coverage: '', positions });
it('orders protocol/network cards and their positions by descending net value without modifying financial data', () => {
  const input = [protocol('small', [position('small', 100)]), protocol('large', [position('second', 500, 200), position('first', 1000)]), protocol('negative', [position('negative', 50, 100)]), protocol('empty')];
  const before = structuredClone(input), result = orderOverviewMarkets(input);
  expect(result.active.map(p => p.id)).toEqual(['large', 'small', 'negative']);
  expect(result.active[0].positions.map(p => p.id)).toEqual(['first', 'second']);
  expect(result.zeroSupply.map(p => p.id)).toEqual(['empty']); expect(input).toEqual(before);
});
it('moves zero personal deposits out of mixed funded markets and retains a partial reader with unknown discovery', () => {
  const managed = position('managed-zero', 0), funded = position('funded', 100);
  const result = orderOverviewMarkets([protocol('morpho', [managed, funded]), { ...protocol('partial'), status: 'partial' }]);
  expect(result.active.find(p => p.id === 'morpho')?.positions).toEqual([funded]);
  expect(result.zeroSupply[0].positions).toEqual([managed]);
  expect(result.active.some(p => p.id === 'partial')).toBe(true);
});
it('keeps errors, unreadable balances, zero-dollar positive token holdings and borrow-only positions visible', () => {
  const zeroPriced = position('positive-token', 0); zeroPriced.assets[0].supplied = 1; zeroPriced.assets[0].priceUsd = 0;
  const input = [{ ...protocol('error'), status: 'error' as const }, protocol('unpriced', [position('unknown', null)]), protocol('zero-price', [zeroPriced]), protocol('borrow-only', [position('borrow-only', 0, 1)]), { ...protocol('incomplete'), balanceDiscoveryComplete: false }];
  const result = orderOverviewMarkets(input);
  expect(result.zeroSupply).toEqual([]); expect(result.active).toHaveLength(5);
  expect(result.active.at(-1)?.id).toBe('incomplete');
});
