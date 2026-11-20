import type { Address } from 'viem';
import type { NetworkId } from '../../src/types.js';
// lista-dao/moolah@402a34a948f907a776337972a83eb5a45ea51877;
// mainnet deployments also confirmed by lista.org's bsc/ethereum app configuration.
export const listaDeployments: Partial<Record<NetworkId, { core: Address; factory: Address }>> = {
  bsc: { core: '0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C', factory: '0x2a0Cb6401FD3c6196750dc6b46702040761D9671' },
  ethereum: { core: '0xf820fB4680712CD7263a0D3D024D5b5aEA82Fd70', factory: '0xa91D9E7343d7EEe8Ed2C8f55e9162827850A7F17' },
};
export const LISTA_COVERAGE = 'Lista DAO Moolah direct market lending/collateral/loans, verified LendingBroker fixed/dynamic loans and registered or pinned-legacy ERC-4626 Earn vault deposits on Ethereum and Binance Smart Chain. Discovery covers the official paginated catalog. Excludes CDP lisUSD minting, other broker types, managed smart accounts, Lista One, staking, and unclaimed incentives.';
export const listaUrl = (network: NetworkId, address: string, vault = false) => `https://lista.org/lending/${vault ? 'vault' : 'market'}/${network}/${address}`;

// Official Lista Earn catalog snapshot 2026-11-20. These vaults predate the factory mapping.
// Every entry was checked on chain for its exact MOOLAH core and asset; both are checked again at runtime.
// BSC manager-config and Ethereum vault-config scripts at the revision above also record legacy deployments.
export const listaLegacyVaults: Partial<Record<NetworkId, { address: Address; asset: Address }[]>> = {
  ethereum: [
    { address: '0x2E3BbD03DbC6D890c8c7e06BE4e065c5c0EeE7e8', asset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' }, // Lista WETH Savings
    { address: '0x9651Ae50a5763c6f9B883f9d50e8116281CFcab2', asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }, // Lista USDC Savings
    { address: '0x28643FFD79256719D6AcbCF25Cb44576cAeBCf12', asset: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }, // Lista USDT Savings
    { address: '0x1A9BeE2F5c85F6b4a0221fB1C733246AF5306Ae3', asset: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d' }, // Lista USD1 Vault
  ],
  bsc: [
    { address: '0x57134a64B7cD9F9eb72F8255A671F5Bf2fe3E2d0', asset: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' }, // Gauntlet x Lista DAO BNB Vault
    { address: '0xfa27f172e0b6ebcEF9c51ABf817E2cb142FbE627', asset: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d' }, // Gauntlet x Lista DAO USD1 Vault
    { address: '0xE03D86e5Baa3509AC4A059A41737bAa8169B6529', asset: '0x0782b6d8c4551B9760e74c0545a9bCD90bdc41E5' }, // Lista lisUSD Vault
    { address: '0x9A17Fd5Cb8EFc25d11567e713aE795A89775a759', asset: '0xcE24439F2D9C6a2289F741120FE202248B666666' }, // Gauntlet x Lista DAO U Vault
    { address: '0x8a06Ac91265dBEBE6D4606f45b10993E9a571869', asset: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' }, // Lista USDC Vault
    { address: '0x4109415DE2271097FB5fa16aF8A753aab8c46D6f', asset: '0x21cAef8A43163Eea865baeE23b9C2E327696A3bf' }, // Lista XAUT Vault
    { address: '0x6d6783C146F2B0B2774C1725297f1845dc502525', asset: '0x55d398326f99059fF775485246999027B3197955' }, // Gauntlet USDT Vault
    { address: '0xEB4F6FFB1038E1cCa701e7d53083B37ec5b6Ba33', asset: '0x55d398326f99059fF775485246999027B3197955' }, // Pangolins USDT Vault(pUSDT)
    { address: '0xf21308b903F96592B6d6988c646dC2A3028F39fd', asset: '0x000Ae314E2A2172a039B26378814C252734f556A' }, // Aster Vault
    { address: '0xE46b8E65006e6450bdd8cb7D3274AB4F76f4C705', asset: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c' }, // Lista BTCB Vault
    { address: '0xb798BB56898a86b6fD49FC1eCA4150efdc3Ee6Ea', asset: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' }, // Solv-Exclusive BNB Vault
    { address: '0xd5cfc0f894bA77e95E3325Aa53Eb3e6CBBb5A81E', asset: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' }, // MEV BNB Vault
    { address: '0xD61DD125016728Dd284Cf5dbA8a3B7C27c5058f2', asset: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d' }, // Solv-Exclusive USD1 Vault
    { address: '0xCb995fb56eC7fc42e0C9a075dFA3A0B56De72484', asset: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' }, // Pangolins BNB Vault
    { address: '0xaB251dc87dc313649D024bd69b34c8E7690Ce1fc', asset: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' }, // Loop BNB Vault
  ],
};
export const isLegacyListaVault = (network: NetworkId, address: string, asset?: string) => (listaLegacyVaults[network] ?? []).some(v => v.address.toLowerCase() === address.toLowerCase() && (asset === undefined || v.asset.toLowerCase() === asset.toLowerCase()));
