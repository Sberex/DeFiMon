import { sameTwoAssetBasket } from './recommendation-filters';
import type { Asset, ChainName, Position, ProtocolResult } from './types';
import { isBadDebtPosition } from './risk-assessment';

export const isMorphoVaultPosition = (position: Position) => !!position.vault || position.id.startsWith('morpho-vault-');
export const isMorphoDepositPosition = (position: Position) => isMorphoVaultPosition(position) || (position.morphoMarket?.supplyOnly === true && position.debtUsd === 0 && position.assets.some(a => a.supplied > 0) && position.assets.every(a => a.borrowed === 0 && !a.collateral));
export interface RecommendationPosition {
  key: string; protocolId: string; market?: string; protocol: string; chain: ChainName; label: string; vault: boolean; deposit: boolean;
  rows: { supplied?: Asset; borrowed?: Asset }[];
}
/** Keep pairs inside their original loan; a multi-asset loan has no single allocated collateral/debt pair. */
export function recommendationPositions(protocols: ProtocolResult[], fallbackChain: ChainName = 'Ethereum'): RecommendationPosition[] {
  return protocols.flatMap(protocol => {
    if (!['ok', 'partial'].includes(protocol.status)) return [];
    return protocol.positions.flatMap(position => {
      if (isBadDebtPosition(protocol.id, position)) return [];
      const supplied = position.assets.filter(a => Number.isFinite(a.supplied) && a.supplied > 0);
      const borrowed = position.assets.filter(a => Number.isFinite(a.borrowed) && a.borrowed > 0);
      if (protocol.id === 'fluid' && sameTwoAssetBasket(supplied.map(a => a.address), borrowed.map(a => a.address))) return [];
      const vault = protocol.id === 'morpho' && isMorphoVaultPosition(position);
      const deposit = protocol.id === 'morpho' && isMorphoDepositPosition(position);
      if (deposit ? !supplied.length : !supplied.length && !borrowed.length) return [];
      const rows = deposit ? supplied.map(asset => ({ supplied: asset })) :
        (supplied.length ? supplied : [undefined]).flatMap(supply =>
          (borrowed.length ? borrowed : [undefined]).map(borrow => ({ supplied: supply, borrowed: borrow })));
      const chain = protocol.chain ?? fallbackChain;
      return [{ key: `${protocol.id}:${chain}:${position.id}`, protocolId: protocol.id, market: position.vault?.address ?? position.marketAddress ?? position.id.match(/0x[0-9a-f]{64}|0x[0-9a-f]{40}/i)?.[0], protocol: protocol.name, chain, label: position.label, vault, deposit, rows }];
    });
  });
}
