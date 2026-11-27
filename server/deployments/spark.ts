import type { Address, Hex } from 'viem';
import { networkNames } from '../../src/networks.js';
import type { NetworkId } from '../../src/types.js';
// sparkdotfi/spark-address-registry@f9aa5cd6ebd688da81a5beed74ddd90a1dea116d,
// src/{SparkLend,Ethereum,Base,Arbitrum}.sol. Spark app /borrow and Base
// isolated-market IDs verified against its published chain configuration 2026-11-19.
export const SPARK_LEND = {
  provider: '0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE' as Address,
  pool: '0xC13e21B648A5Ee794902342038FF3aDAB66BE987' as Address,
};
export interface SparkVault { address: Address; kind: 'vsr' | 'ssr' | 'morpho'; oracle?: Address }
export const sparkVaults: Record<NetworkId, SparkVault[]> = {
  arc: [],
  ethereum: [
    { address: '0xfE6eb3b609a7C8352A241f7F3A21CEA4e9209B8f', kind: 'vsr' },
    { address: '0x80128DbB9f07b93DDE62A6daeadb69ED14a7D354', kind: 'vsr' },
    { address: '0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d', kind: 'vsr' },
    { address: '0xe2e7a17dFf93280dec073C995595155283e3C372', kind: 'vsr' },
  ],
  base: [
    { address: '0x3128a0F7f0ea68E7B7c9B00AFa7E41045828e858', kind: 'ssr', oracle: '0x65d946e533748A998B1f0E430803e39A6388f7a1' },
    { address: '0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A', kind: 'morpho' },
  ],
  arbitrum: [
    { address: '0x940098b108fB7D0a7E374f6eDED7760787464609', kind: 'ssr', oracle: '0xEE2816c1E1eed14d444552654Ed3027abC033A36' },
    { address: '0x45d91340B3B7B96985A72b5c678F7D9e8D664b62', kind: 'vsr' },
  ],
  bsc: [],
  plasma: [],
};
export const sparkIsolatedMarkets: Record<NetworkId, Hex[]> = {
  arc: [],
  ethereum: [], arbitrum: [], plasma: [], bsc: [],
  base: [
    '0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda',
    '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836',
  ],
};
export const sparkCoverage = (network: NetworkId) => network === 'ethereum'
  ? 'SparkLend main pool and registered Spark Savings V2 vaults. Excludes staking, rewards and linked wallets.'
  : network === 'base' ? 'Spark Morpho isolated markets, sUSDC savings and legacy Spark USDC Morpho vault. No SparkLend pool on Base.'
  : network === 'arbitrum' ? 'Spark sUSDC and spUSDT savings vaults. Spark has no borrowing pool or isolated markets on Arbitrum.'
  : `Spark has no supported deployment on ${networkNames[network]}.`;
