import type { Portfolio } from '../../src/types';
export function snapshot(apr = .2, time = '2026-11-20T10:00:00.000Z', wallet = '0x1111111111111111111111111111111111111111'): Portfolio {
  return { address: wallet, chain: 'Ethereum', blockNumber: '123', updatedAt: time, protocols: [{ id: 'morpho', name: 'Morpho', status: 'ok', coverage: '', positions: [{ id: 'loan', label: 'Test loan', suppliedUsd: 1000, debtUsd: 500, healthFactor: 1.5, risk: 'lower', notes: [], assets: [
    { address: '0x2222222222222222222222222222222222222222', symbol: 'Collateral', supplied: 1000, borrowed: 0, priceUsd: 1, collateral: true, liquidationThreshold: .8, liquidationPriceUsd: null, supplyRate: { apr: apr / 2 + .03, note: '' } },
    { address: '0x3333333333333333333333333333333333333333', symbol: 'USDC', supplied: 0, borrowed: 500, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, borrowRate: { apr: .06, note: '' } },
  ] }] }] };
}
