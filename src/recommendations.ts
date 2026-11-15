import { sameTwoAssetBasket } from './recommendation-filters';
import type { Asset, ChainName, Position, ProtocolResult } from './types';

export const isMorphoVaultPosition = (position: Position) => !!position.vault || position.id.startsWith('morpho-vault-');
export interface RecommendationPosition {
  key: string; protocolId: string; market?: string; protocol: string; chain: ChainName; label: string; vault: boolean;
  rows: { supplied?: Asset; borrowed?: Asset }[];
}
/** Keep pairs inside their original loan; a multi-asset loan has no single allocated collateral/debt pair. */
export function recommendationPositions(protocols: ProtocolResult[], fallbackChain: ChainName = 'Ethereum'): RecommendationPosition[] {
  return protocols.flatMap(protocol => {
    if (!['ok', 'partial'].includes(protocol.status)) return [];
    return protocol.positions.flatMap(position => {
      const supplied = position.assets.filter(a => Number.isFinite(a.supplied) && a.supplied > 0);
      const borrowed = position.assets.filter(a => Number.isFinite(a.borrowed) && a.borrowed > 0);
      if (protocol.id === 'fluid' && sameTwoAssetBasket(supplied.map(a => a.address), borrowed.map(a => a.address))) return [];
      const vault = protocol.id === 'morpho' && isMorphoVaultPosition(position);
      if (vault ? !supplied.length : !supplied.length && !borrowed.length) return [];
      const rows = vault ? supplied.map(asset => ({ supplied: asset })) :
        (supplied.length ? supplied : [undefined]).flatMap(supply =>
          (borrowed.length ? borrowed : [undefined]).map(borrow => ({ supplied: supply, borrowed: borrow })));
      const chain = protocol.chain ?? fallbackChain;
      return [{ key: `${protocol.id}:${chain}:${position.id}`, protocolId: protocol.id, market: position.vault?.address ?? position.marketAddress ?? position.id.match(/0x[0-9a-f]{64}|0x[0-9a-f]{40}/i)?.[0], protocol: protocol.name, chain, label: position.label, vault, rows }];
    });
  });
}
