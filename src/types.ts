export type TokenCategory = 'Other' | 'Stablecoin' | 'Savings stablecoin';
export type NetworkId = 'ethereum' | 'plasma' | 'arbitrum' | 'base' | 'bsc';
export type ChainName = 'Ethereum' | 'Plasma' | 'Arbitrum' | 'Base' | 'Binance Smart Chain';
export type ExtraTokens = Partial<Record<NetworkId, string[]>>;
export interface WalletToken {
  address: string; symbol: string; balance: number | null; priceUsd: number | null; valueUsd: number | null;
  excludedReason?: string; category?: TokenCategory;
  pendle?: PendleTokenInfo;
  intrinsicSupplyRate?: IntrinsicRate; interestBearing?: boolean;
}
export interface PendleTokenInfo {
  kind: 'PT' | 'YT'; name: string; marketAddress: string; syAddress: string;
  quoteAsset: { address: string; symbol: string }; oraclePrice: number | null; quoteValue: number | null;
  impliedApy: number | null; underlyingApy: number | null; tvlUsd: number | null;
  expiry: number | null; matured: boolean | null; oracleAddress: string; blockNumber: string;
  marketUpdatedAt: string | null; notes: string[];
}
export interface PendleCoverage {
  status: 'ok' | 'partial' | 'error'; coverage: string; message?: string; marketCount: number; blockNumber: string | null; balanceDiscoveryComplete?: boolean;
}
export interface WalletBalances {
  chain: ChainName; status: 'ok' | 'partial' | 'error'; tokens: WalletToken[];
  pricedValueUsd: number | null; unpricedCount: number; coverage: string; message?: string; pendle?: PendleCoverage; interestDiscoveryComplete?: boolean;
}
export type Risk = 'no-debt' | 'lower' | 'watch' | 'high' | 'liquidatable' | 'unknown';
export interface InterestRate {
  apr: number | null; note: string; estimated?: boolean;
  pendlePt?: { network: NetworkId; marketAddress: string | null; expiry: number | null; updatedAt: string | null };
}
export interface IntrinsicRate extends InterestRate {
  source: { chain: ChainName; oracle: string; kind?: 'chainlink' | 'erc4626' | 'unavailable' | 'lido' | 'pendle'; url?: string; label?: string; startBlockNumber?: string; windowDays?: number; blockNumber?: string; startRound?: string; endRound?: string; startTimestamp?: number; endTimestamp?: number; startRate?: number; endRate?: number };
}
export interface Asset {
  symbol: string; address: string; supplied: number; borrowed: number; priceUsd: number | null;
  collateral: boolean; liquidationThreshold: number | null; liquidationPriceUsd: number | null;
  /** Pledged amount when a row combines pledged collateral and ordinary deposits. */
  collateralSupplied?: number;
  /** Actual protocol LLTV when the calculation factor is weighted across balances. */
  lltv?: number; lltvNote?: string;
  priceSource?: 'fluid-oracle' | 'euler-oracle';
  supplyRate?: InterestRate; borrowRate?: InterestRate; intrinsicSupplyRate?: IntrinsicRate;
  merklSupplyRate?: MerklAprQuote; merklBorrowRate?: MerklAprQuote;
  v4Reserves?: { hub: string; assetId: string; supplied: number; borrowed: number }[];
}
export interface Position {
  id: string; label: string; suppliedUsd: number | null; debtUsd: number | null; healthFactor: number | null;
  risk: Risk; assets: Asset[]; notes: string[];
  /** Unweighted pledged collateral value from the protocol's native account data. */
  collateralValueUsd?: number | null;
  vault?: { address: string; version: 1 | 2; roles: { role: 'creator' | 'curator' | 'owner'; source: 'onchain' | 'api' }[]; totalAssets: number | null; totalAssetsUsd: number | null };
  marketAddress?: string;
  depositOnly?: boolean;
  morphoMarket?: { loanAsset: { address: string; symbol: string }; collateralAsset: { address: string; symbol: string } | null; supplyOnly: boolean };
  collateralOracleChecks?: { asset: string; oracle: string; status: 'ok' | 'unavailable' | 'zero' }[];
  riskAssessment?: { reasons: string[] };
  receiptTokens?: string[];
  liquidationModel?: 'linear' | 'oracle-ratio' | 'unavailable';
  liquidationQuote?: { current: number; threshold: number; unit: string };
}
export interface ProtocolResult {
  id: string; name: string; status: 'ok' | 'partial' | 'error' | 'not-integrated'; coverage: string;
  message?: string; positions: Position[];
  /** Personal holdings discovery is independent of optional owner/curator listings. */
  balanceDiscoveryComplete?: boolean;
  chain?: ChainName;
}
export interface Portfolio {
  address: string; chain: ChainName | 'Ethereum + Plasma' | 'Ethereum + Plasma + Arbitrum' | 'Ethereum + Plasma + Arbitrum + Base' | 'Ethereum + Plasma + Arbitrum + Base + Binance Smart Chain'; blockNumber: string | null; updatedAt: string;
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
  aprStatus?: 'ok' | 'partial' | 'error'; opportunities?: MerklOpportunity[]; aprMessage?: string;
}
export interface MerklAprQuote extends InterestRate {
  components: { id: string; name: string; listedApr: number; appliedApr: number; note: string }[];
}
export interface MerklOpportunity {
  id: string; chainId: number; protocol: string; type: string; action: 'LEND' | 'BORROW' | 'OTHER';
  name: string; identifier: string; tokens: string[]; apr: number;
  status: 'ready' | 'unsupported'; reason?: string;
  rules?: { kind: 'fluid-vault'; vault: string } | { kind: 'aave-v4-net-borrow'; hubs: { address: string; borrowAssets: { id: string; token: string }[]; supplyAssets: { id: string; token: string }[] }[] };
}
