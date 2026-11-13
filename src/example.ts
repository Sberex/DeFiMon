import type { Portfolio } from './types';
// Deliberately synthetic. Never used as a fallback for a failed live request.
export const example: Portfolio = {
  address: '0x1111111111111111111111111111111111111111', chain: 'Ethereum', blockNumber: null, updatedAt: '',
  protocols: [
    { id: 'aave-v3', name: 'Aave v3', status: 'ok', coverage: 'Ethereum main market', positions: [{ id: 'example-aave', label: 'Ethereum main market', suppliedUsd: 30000, debtUsd: 18000, healthFactor: 25500 / 18000, risk: 'lower', notes: ['Illustrative numbers only. Other asset prices and balances are held fixed.'], assets: [
      { symbol: 'WETH', address: '', supplied: 10, borrowed: 0, priceUsd: 3000, collateral: true, liquidationThreshold: .85, liquidationPriceUsd: 18000 / 8.5 },
      { symbol: 'USDC', address: '', supplied: 0, borrowed: 18000, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null },
    ] }] },
    { id: 'aave-v4', name: 'Aave v4', status: 'ok', coverage: 'Ethereum lending markets and tokenized deposits', positions: [{ id: 'example-aave-v4', label: 'Aave v4 · MAIN', suppliedUsd: 9000, debtUsd: 4000, healthFactor: 1.8, risk: 'lower', assets: [
      { symbol: 'WETH', address: '', supplied: 3, borrowed: 0, priceUsd: 3000, collateral: true, liquidationThreshold: .8, liquidationPriceUsd: 4000 / (3 * .8) },
      { symbol: 'USDC', address: '', supplied: 0, borrowed: 4000, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null },
    ], notes: ['Illustrative numbers only. Each v4 market has independent collateral and debt. The debt includes the risk premium.'] }] },
    { id: 'morpho', name: 'Morpho', status: 'not-integrated', coverage: 'Market and vault integration pending', positions: [] },
    { id: 'compound', name: 'Compound', status: 'ok', coverage: 'v3 USDC and WETH markets', positions: [{ id: 'example-compound', label: 'USDC market', suppliedUsd: 12000, debtUsd: 5000, healthFactor: 10740 / 5000, risk: 'lower', notes: ['Illustrative numbers only. Other asset prices and balances are held fixed.'], assets: [
      { symbol: 'WETH', address: '', supplied: 4, borrowed: 0, priceUsd: 3000, collateral: true, liquidationThreshold: .895, liquidationPriceUsd: 5000 / (4 * .895) },
      { symbol: 'USDC', address: '', supplied: 0, borrowed: 5000, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null },
    ] }] },
    { id: 'fluid', name: 'Fluid', status: 'ok', coverage: 'Ethereum T1–T4 vaults and fToken lending deposits', positions: [{ id: 'example-fluid', label: 'Vault 11 · ETH / USDC · NFT example', suppliedUsd: 6000, debtUsd: 3500, healthFactor: 5520 / 3500, risk: 'lower', notes: ['Illustrative numbers only. The debt token price and balances stay fixed.'], liquidationQuote: { current: 3000, threshold: 3500 / (2 * .92), unit: 'USDC per ETH' }, assets: [
      { symbol: 'ETH', address: '', supplied: 2, borrowed: 0, priceUsd: 3000, collateral: true, liquidationThreshold: .92, liquidationPriceUsd: 3500 / (2 * .92) },
      { symbol: 'USDC', address: '', supplied: 0, borrowed: 3500, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null },
    ] }] },
  ],
};
