import type { DiscoveryMarket } from '../../src/market-discovery';
export function strategyMarket(
  overrides: Partial<DiscoveryMarket> = {},
): DiscoveryMarket {
  return {
    targetId: 'discovery-loans',
    protocol: 'Morpho',
    network: 'ethereum',
    market: `0x${'1'.repeat(64)}`,
    label: 'sUSDai / USDC',
    block: '123',
    url: `https://app.morpho.org/ethereum/market/0x${'1'.repeat(64)}`,
    note: 'Verified snapshot',
    supplyApr: 0,
    borrowApr: 0.04,
    lltv: 0.86,
    supplyAsset: {
      address: '0x0b2b2b2076d95dda7817e785989fe353fe955ef9',
      name: 'sUSDai',
      category: 'Savings stablecoin',
      intrinsicApr: 0.08,
    },
    borrowAsset: {
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      name: 'USDC',
      category: 'Stablecoin',
    },
    totalSupplyApr: 0.08,
    liquidity: {
      amount: 10000,
      symbol: 'USDC',
      token: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      note: 'Available cash',
    },
    liquidityUsd: 10000,
    ...overrides,
  };
}
