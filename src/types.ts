export type Risk = 'no-debt' | 'lower' | 'watch' | 'high' | 'liquidatable' | 'unknown';
export interface Asset {
  symbol: string; address: string; supplied: number; borrowed: number; priceUsd: number;
  collateral: boolean; liquidationThreshold: number | null; liquidationPriceUsd: number | null;
}
export interface Position {
  id: string; label: string; suppliedUsd: number; debtUsd: number; healthFactor: number | null;
  risk: Risk; assets: Asset[]; notes: string[];
}
export interface ProtocolResult {
  id: string; name: string; status: 'ok' | 'error' | 'not-integrated'; coverage: string;
  message?: string; positions: Position[];
}
export interface Portfolio {
  address: string; chain: 'Ethereum'; blockNumber: string | null; updatedAt: string;
  protocols: ProtocolResult[];
}
