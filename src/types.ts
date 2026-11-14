export type NetworkId = 'ethereum' | 'plasma' | 'arbitrum';
export type ChainName = 'Ethereum' | 'Plasma' | 'Arbitrum';
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
export interface IntrinsicRate extends InterestRate {
  source: { chain: 'Ethereum'; oracle: string; blockNumber?: string; startRound?: string; endRound?: string; startTimestamp?: number; endTimestamp?: number; startRate?: number; endRate?: number };
}
export interface Asset {
  symbol: string; address: string; supplied: number; borrowed: number; priceUsd: number | null;
  collateral: boolean; liquidationThreshold: number | null; liquidationPriceUsd: number | null;
  /** Actual protocol LLTV when the calculation factor is weighted across balances. */
  lltv?: number; lltvNote?: string;
  priceSource?: 'fluid-oracle';
  supplyRate?: InterestRate; borrowRate?: InterestRate; intrinsicSupplyRate?: IntrinsicRate;
}
export interface Position {
  id: string; label: string; suppliedUsd: number | null; debtUsd: number | null; healthFactor: number | null;
  risk: Risk; assets: Asset[]; notes: string[];
  liquidationModel?: 'linear' | 'oracle-ratio' | 'unavailable';
  liquidationQuote?: { current: number; threshold: number; unit: string };
}
export interface ProtocolResult {
  id: string; name: string; status: 'ok' | 'partial' | 'error' | 'not-integrated'; coverage: string;
  message?: string; positions: Position[];
  chain?: ChainName;
}
export interface Portfolio {
  address: string; chain: ChainName | 'Ethereum + Plasma' | 'Ethereum + Plasma + Arbitrum'; blockNumber: string | null; updatedAt: string;
  protocols: ProtocolResult[];
  wallets?: WalletBalances[];
  networks?: { chain: ChainName; blockNumber: string | null; updatedAt: string; status: 'ok' | 'error'; message?: string }[];
}
export interface MerklTokenReward {
  address: string; symbol: string; decimals: number;
  unclaimed: number; pending: number; unclaimedRaw: string; pendingRaw: string;
  priceUsd: number | null; unclaimedUsd: number | null; pendingUsd: number | null;
}
export interface MerklNetworkRewards {
  chain: ChainName; status: 'ok' | 'partial' | 'error'; rewards: MerklTokenReward[];
  unclaimedUsd: number | null; pendingUsd: number | null; message?: string; disputeUntil?: number;
}
export interface MerklRewards {
  address: string; updatedAt: string; status: 'ok' | 'partial' | 'error';
  networks: MerklNetworkRewards[]; message?: string;
}
