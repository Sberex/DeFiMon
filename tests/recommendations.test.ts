import { expect, it } from 'vitest';
import type { Asset, Position, ProtocolResult } from '../src/types';
import { recommendationPositions } from '../src/recommendations';
const asset = (symbol: string, supplied: number, borrowed = 0): Asset => ({ symbol, address: symbol, supplied, borrowed, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, supplyRate: { apr: .05, note: '' }, borrowRate: { apr: .08, note: '' } });
const position = (id: string, assets: Asset[]): Position => ({ id, label: id, assets, suppliedUsd: 100, debtUsd: 50, healthFactor: 2, risk: 'lower', notes: [] });
const protocol = (positions: Position[]): ProtocolResult => ({ id: 'morpho', name: 'Morpho', chain: 'Ethereum', status: 'ok', positions, coverage: '' });
it('keeps multiple collateral and debt combinations inside their own loan and preserves adjusted rates', () => {
  const eth = asset('ETH', 10); eth.intrinsicSupplyRate = { apr: .03, note: '', source: { chain: 'Ethereum', oracle: 'feed' } };
  eth.merklSupplyRate = { apr: .01, note: '', components: [] };
  const usdc = asset('USDC', 0, 500); usdc.merklBorrowRate = { apr: .02, note: '', components: [] };
  const p = protocol([position('loan1', [eth, asset('WBTC', 1), usdc, asset('USDT', 0, 300)]), position('loan2', [asset('EUL', 10), asset('GHO', 0, 100)])]);
  const before = structuredClone(p);
  const result = recommendationPositions([p]);
  expect(result[0].rows.map(r => [r.supplied?.symbol, r.borrowed?.symbol])).toEqual([['ETH', 'USDC'], ['ETH', 'USDT'], ['WBTC', 'USDC'], ['WBTC', 'USDT']]);
  expect(result[1].rows.map(r => [r.supplied?.symbol, r.borrowed?.symbol])).toEqual([['EUL', 'GHO']]);
  expect(result[0].rows[0]).toEqual({ supplied: eth, borrowed: usdc });
  expect(p).toEqual(before);
});
it('includes only personal nonzero Morpho vault deposits, independent of role or vault-wide assets', () => {
  const empty = position('morpho-vault-empty', [asset('USDC', 0)]);
  empty.vault = { address: 'vault', version: 1, roles: [{ role: 'owner', source: 'onchain' }], totalAssets: 1e6, totalAssetsUsd: 1e6 };
  const v1 = position('morpho-vault-v1', [asset('USDC', 100)]);
  const v2 = position('v2', [asset('USDT', 200)]); v2.vault = { ...empty.vault, version: 2 };
  const result = recommendationPositions([protocol([empty, v1]), { ...protocol([v2]), chain: 'Arbitrum' }]);
  expect(result).toHaveLength(2);
  expect(result.map(r => [r.vault, r.chain, r.rows[0].supplied?.symbol, r.rows[0].borrowed])).toEqual([[true, 'Ethereum', 'USDC', undefined], [true, 'Arbitrum', 'USDT', undefined]]);
});
it('keeps one-sided balances and unknown active APRs, excludes unreadable or empty positions, and distinguishes networks', () => {
  const deposit = asset('ETH', 1); deposit.supplyRate = undefined;
  const p = protocol([position('supply', [deposit]), position('borrow', [asset('USDC', 0, 1)]), position('unreadable', []), position('empty', [asset('USDT', 0)])]);
  const result = recommendationPositions([p, { ...p, chain: 'Plasma', status: 'partial' }, { ...p, status: 'error' }]);
  expect(result).toHaveLength(4);
  expect(new Set(result.map(r => r.key)).size).toBe(4);
  expect(result[0].rows[0].supplied?.supplyRate).toBeUndefined();
  expect(result[1].rows[0].supplied).toBeUndefined();
  expect(result[1].rows[0].borrowed?.symbol).toBe('USDC');
});
