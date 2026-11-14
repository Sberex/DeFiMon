import type { ChainName, NetworkId } from './types';
export const networkOrder: NetworkId[] = ['ethereum', 'plasma', 'arbitrum'];
export const networkNames: Record<NetworkId, ChainName> = { ethereum: 'Ethereum', plasma: 'Plasma', arbitrum: 'Arbitrum' };
export const combinedNetworkName = 'Ethereum + Plasma + Arbitrum' as const;
export const isNetworkId = (value: unknown): value is NetworkId => networkOrder.includes(value as NetworkId);
