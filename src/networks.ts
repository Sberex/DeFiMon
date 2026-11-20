import type { ChainName, NetworkId } from './types';
export const networkOrder: NetworkId[] = ['ethereum', 'plasma', 'arbitrum', 'base', 'bsc'];
export const networkNames: Record<NetworkId, ChainName> = { ethereum: 'Ethereum', plasma: 'Plasma', arbitrum: 'Arbitrum', base: 'Base', bsc: 'Binance Smart Chain' };
export const combinedNetworkName = 'Ethereum + Plasma + Arbitrum + Base + Binance Smart Chain' as const;
export const isNetworkId = (value: unknown): value is NetworkId => networkOrder.includes(value as NetworkId);

export const portfolioNetwork = (chain: string) => networkOrder.find(network => networkNames[network] === chain) ?? 'ethereum';

export const networkExplorers: Record<ChainName, string> = { Ethereum: 'https://etherscan.io', Plasma: 'https://plasmascan.to', Arbitrum: 'https://arbiscan.io', Base: 'https://basescan.org', 'Binance Smart Chain': 'https://bscscan.com' };
