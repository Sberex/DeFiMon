import type { ChainName, Position } from './types';
import { portfolioNetwork } from './networks';
const explorers: Record<ChainName, string> = { Ethereum: 'https://etherscan.io', Plasma: 'https://plasmascan.to', Arbitrum: 'https://arbiscan.io', Base: 'https://basescan.org' };
const contract = (value: string | undefined): value is string => /^0x[0-9a-f]{40}$/i.test(value ?? '');
export function positionLinks(protocol: string, chain: ChainName, position: Position) {
  const network = portfolioNetwork(chain);
  if (['morpho', 'spark'].includes(protocol) && /^morpho-market-0x[0-9a-f]{64}$/i.test(position.id)) {
    const address = position.id.slice('morpho-market-'.length);
    return [{ label: 'Market ID', address, url: protocol === 'spark' ? `https://app.spark.finance/isolated-markets/${network}/${address}` : `https://app.morpho.org/${network}/market/${address}` }];
  }
  const address = position.vault?.address ?? position.marketAddress
    ?? (protocol === 'compound' ? position.id : protocol === 'fluid' && position.id.startsWith('fluid-lending-') ? position.id.slice('fluid-lending-'.length) : undefined);
  if (!contract(address)) return [];
  const url = (value: string) => protocol === 'spark' ? (position.depositOnly ? 'https://app.spark.finance/savings' : 'https://app.spark.finance/borrow') : protocol === 'euler' ? `https://app.euler.finance/vault/${value}?network=${network}`
    : protocol === 'morpho' ? `https://app.morpho.org/${network}/vault/${value}` : `${explorers[chain]}/address/${value}`;
  const result = [{ label: position.vault || position.depositOnly || protocol === 'euler' ? 'Vault contract' : 'Market contract', address, url: url(address) }];
  if (protocol === 'euler') {
    const seen = new Set([address.toLowerCase()]);
    for (const receipt of position.receiptTokens ?? []) {
      if (contract(receipt) && !seen.has(receipt.toLowerCase())) {
        seen.add(receipt.toLowerCase());
        result.push({ label: 'Collateral / deposit vault', address: receipt, url: url(receipt) });
      }
    }
  }
  return result;
}
