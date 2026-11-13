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
    { id: 'morpho', name: 'Morpho', status: 'ok', coverage: 'Ethereum direct markets and vault V1/V2 deposits', positions: [
      { id: 'example-morpho', label: 'Morpho · WETH / USDC', suppliedUsd: 6500, debtUsd: 2500, healthFactor: 2.064, risk: 'lower', assets: [
        { symbol: 'WETH', address: '', supplied: 2, borrowed: 0, priceUsd: 3000, collateral: true, liquidationThreshold: .86, liquidationPriceUsd: 2500 / (2 * .86) },
        { symbol: 'USDC', address: '', supplied: 500, borrowed: 2500, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null },
      ], liquidationQuote: { current: 3000, threshold: 2500 / (2 * .86), unit: 'USDC per WETH' }, notes: ['Illustrative numbers only. Lending USDC does not protect the collateralized borrowing position.'] },
      { id: 'example-morpho-vault', label: 'Morpho vault V1 · Example USDC vault', suppliedUsd: 1000, debtUsd: 0, healthFactor: null, risk: 'no-debt', assets: [
        { symbol: 'USDC', address: '', supplied: 1000, borrowed: 0, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null },
      ], notes: ['Illustrative numbers only. The vault deposit is counted once; its underlying market allocations are not added again.'] },
    ] },
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

// Separate, explicitly fictional Plasma positions for the combined example.
export const combinedExample: Portfolio = {
  ...example, chain: 'Ethereum + Plasma', blockNumber: null,
  wallets: [
    { chain: 'Ethereum', status: 'ok', pricedValueUsd: 6500, unpricedCount: 0, coverage: 'Illustrative wallet tokens only.', tokens: [
      { address: 'native', symbol: 'ETH', balance: 2, priceUsd: 3000, valueUsd: 6000 },
      { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', balance: 500, priceUsd: 1, valueUsd: 500 },
    ] },
    { chain: 'Plasma', status: 'ok', pricedValueUsd: 500, unpricedCount: 0, coverage: 'Illustrative wallet tokens only.', tokens: [
      { address: 'native', symbol: 'XPL', balance: 1000, priceUsd: 0.5, valueUsd: 500 },
    ] },
  ],
  protocols: example.protocols.flatMap(protocol => {
    const ethereum = { ...protocol, chain: 'Ethereum' as const };
    if (protocol.id !== 'aave-v3' && protocol.id !== 'fluid') return [ethereum];
    const aave = protocol.id === 'aave-v3';
    return [ethereum, {
      id: protocol.id, name: protocol.name, chain: 'Plasma' as const, status: 'ok' as const,
      coverage: aave ? 'Plasma main market' : 'Plasma T1–T4 vaults and fToken lending deposits',
      positions: [{ id: `example-plasma-${protocol.id}`, label: aave ? 'Plasma main market' : 'Plasma Fluid · illustrative vault',
        suppliedUsd: aave ? 4000 : 2000, debtUsd: aave ? 1000 : 500, healthFactor: aave ? 2.8 : 3.2, risk: 'lower' as const,
        assets: [{ symbol: 'WXPL', address: '', supplied: aave ? 8000 : 4000, borrowed: 0, priceUsd: 0.5, collateral: true, liquidationThreshold: aave ? 0.7 : 0.8, liquidationPriceUsd: aave ? 1000 / (8000 * 0.7) : 500 / (4000 * 0.8) },
          { symbol: 'USDT0', address: '', supplied: 0, borrowed: aave ? 1000 : 500, priceUsd: 1, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null }],
        notes: ['Illustrative numbers only. This Plasma position is independent of the Ethereum positions.'],
      }],
    }];
  }),
};
