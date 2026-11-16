import type { ChainName, NetworkId } from './types';
export const networkOrder: NetworkId[] = ['ethereum', 'plasma', 'arbitrum', 'base'];
export const networkNames: Record<NetworkId, ChainName> = { ethereum: 'Ethereum', plasma: 'Plasma', arbitrum: 'Arbitrum', base: 'Base' };
export const combinedNetworkName = 'Ethereum + Plasma + Arbitrum + Base' as const;
export const isNetworkId = (value: unknown): value is NetworkId => networkOrder.includes(value as NetworkId);

export const portfolioNetwork = (chain: string) => networkOrder.find(network => networkNames[network] === chain) ?? 'ethereum';
