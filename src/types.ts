export type NetworkId = 'ethereum' | 'plasma';
export type ChainName = 'Ethereum' | 'Plasma';
export type Risk = 'no-debt' | 'lower' | 'watch' | 'high' | 'liquidatable' | 'unknown';
export interface Asset {
  symbol: string; address: string; supplied: number; borrowed: number; priceUsd: number | null;
  collateral: boolean; liquidationThreshold: number | null; liquidationPriceUsd: number | null;
  priceSource?: 'fluid-oracle';
}
export interface Position {
  id: string; label: string; suppliedUsd: number | null; debtUsd: number | null; healthFactor: number | null;
  risk: Risk; assets: Asset[]; notes: string[];
  liquidationQuote?: { current: number; threshold: number; unit: string };
}
export interface ProtocolResult {
  id: string; name: string; status: 'ok' | 'partial' | 'error' | 'not-integrated'; coverage: string;
  message?: string; positions: Position[];
  chain?: ChainName;
}
export interface Portfolio {
  address: string; chain: ChainName | 'Ethereum + Plasma'; blockNumber: string | null; updatedAt: string;
  protocols: ProtocolResult[];
  networks?: { chain: ChainName; blockNumber: string | null; updatedAt: string; status: 'ok' | 'error'; message?: string }[];
}
