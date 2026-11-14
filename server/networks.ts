import type { Address } from 'viem';
import type { ChainName, NetworkId } from '../src/types.js';

interface NetworkConfig {
  id: number; name: ChainName; rpcVariable: string; defaultRpc?: string;
  nativeSymbol: string; wrappedNative: Address; aaveProvider: Address; chainlinkRegistry?: Address;
  fluid: { vault: Address; dex: Address; lending: Address };
  morphoBlue?: Address;
  compoundMarkets: { address: Address; label: string }[];
  protocolIds: string[];
}
// Aave: bgd-labs/aave-address-book/src/AaveV3{Ethereum,Plasma,Arbitrum}.sol.
// Fluid: Instadapp/fluid-contracts-public@404d73f/deployments/{mainnet,plasma,arbitrum}.
// Selected Plasma and Arbitrum resolver ABIs match the pinned Ethereum ABIs in abis/fluid.ts.
export const networks: Record<NetworkId, NetworkConfig> = {
  ethereum: {
    protocolIds: ['aave-v3', 'aave-v4', 'morpho', 'compound', 'fluid'],
    morphoBlue: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
    compoundMarkets: [{ address: '0xc3d688B66703497DAA19211EEdff47f25384cdc3', label: 'USDC market' }, { address: '0xA17581A9E3356d9A858b789D68B4d866e593aE94', label: 'WETH market' }],
    id: 1, name: 'Ethereum', rpcVariable: 'ETHEREUM_RPC_URL', nativeSymbol: 'ETH',
    wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    aaveProvider: '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e',
    chainlinkRegistry: '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf',
    fluid: { vault: '0x6943Ed9E53e3713Bf24a92016984254311772F1A', dex: '0x11D80CfF056Cef4F9E6d23da8672fE9873e5cC07', lending: '0x48D32f49aFeAEC7AE66ad7B9264f446fc11a1569' },
  },
  plasma: {
    protocolIds: ['aave-v3', 'fluid'], compoundMarkets: [],
    id: 9745, name: 'Plasma', rpcVariable: 'PLASMA_RPC_URL', defaultRpc: 'https://rpc.plasma.to', nativeSymbol: 'XPL',
    wrappedNative: '0x6100E367285b01F48D07953803A2d8dCA5D19873',
    aaveProvider: '0x061D8e131F26512348ee5FA42e2DF1bA9d6505E9',
    fluid: { vault: '0xA5C3E16523eeeDDcC34706b0E6bE88b4c6EA95cC', dex: '0xAf572EfC84d905926F7b05C1B7bE04e4E89542B0', lending: '0x48D32f49aFeAEC7AE66ad7B9264f446fc11a1569' },
  },
  arbitrum: {
    id: 42161, name: 'Arbitrum', rpcVariable: 'ARBITRUM_RPC_URL', defaultRpc: 'https://arb1.arbitrum.io/rpc', nativeSymbol: 'ETH',
    wrappedNative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    aaveProvider: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
    // morpho-org/sdks@56f1ed6 packages/morpho-ts/src/addresses.ts.
    morphoBlue: '0x6c247b1F6182318877311737BaC0844bAa518F5e',
    fluid: { vault: '0xA5C3E16523eeeDDcC34706b0E6bE88b4c6EA95cC', dex: '0x11D80CfF056Cef4F9E6d23da8672fE9873e5cC07', lending: '0x48D32f49aFeAEC7AE66ad7B9264f446fc11a1569' },
    protocolIds: ['aave-v3', 'morpho', 'compound', 'fluid'],
    // compound-finance/comet@f766f51583c23acc33b2a7824654ef2029a96804 deployments/arbitrum/*/roots.json.
    compoundMarkets: [
      { address: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf', label: 'USDC market' },
      { address: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA', label: 'USDC.e market' },
      { address: '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07', label: 'USDT market' },
      { address: '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486', label: 'WETH market' },
    ],
  },
};
