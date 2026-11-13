export type NetworkId = 'ethereum' | 'plasma';
export type ChainName = 'Ethereum' | 'Plasma';
export type ExtraTokens = Partial<Record<NetworkId, string[]>>;
export interface WalletToken {
  address: string; symbol: string; balance: number | null; priceUsd: number | null; valueUsd: number | null;
  excludedReason?: string;
}
export interface WalletBalances {
  chain: ChainName; status: 'ok' | 'partial' | 'error'; tokens: WalletToken[];
  pricedValueUsd: number | null; unpricedCount: number; coverage: string; message?: string;
}
export type Risk = 'no-debt' | 'lower' | 'watch' | 'high' | 'liquidatable' | 'unknown';
export interface InterestRate { apr: number | null; note: string; estimated?: boolean }
export interface Asset {
  symbol: string; address: string; supplied: number; borrowed: number; priceUsd: number | null;
  collateral: boolean; liquidationThreshold: number | null; liquidationPriceUsd: number | null;
  priceSource?: 'fluid-oracle';
  supplyRate?: InterestRate; borrowRate?: InterestRate;
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
  wallets?: WalletBalances[];
  networks?: { chain: ChainName; blockNumber: string | null; updatedAt: string; status: 'ok' | 'error'; message?: string }[];
}
