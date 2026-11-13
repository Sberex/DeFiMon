import type { Address } from 'viem';
import type { NetworkId } from '../src/types.js';

interface NetworkConfig {
  id: number; name: 'Ethereum' | 'Plasma'; rpcVariable: string; defaultRpc?: string;
  nativeSymbol: string; wrappedNative: Address; aaveProvider: Address; chainlinkRegistry?: Address;
  fluid: { vault: Address; dex: Address; lending: Address };
}
// Aave: bgd-labs/aave-address-book/src/AaveV3{Ethereum,Plasma}.sol.
// Fluid: Instadapp/fluid-contracts-public@404d73f/deployments/{mainnet,plasma}.
// Selected Plasma resolver ABIs match the pinned Ethereum ABIs in abis/fluid.ts.
export const networks: Record<NetworkId, NetworkConfig> = {
  ethereum: {
    id: 1, name: 'Ethereum', rpcVariable: 'ETHEREUM_RPC_URL', nativeSymbol: 'ETH',
    wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    aaveProvider: '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e',
    chainlinkRegistry: '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf',
    fluid: { vault: '0x6943Ed9E53e3713Bf24a92016984254311772F1A', dex: '0x11D80CfF056Cef4F9E6d23da8672fE9873e5cC07', lending: '0x48D32f49aFeAEC7AE66ad7B9264f446fc11a1569' },
  },
  plasma: {
    id: 9745, name: 'Plasma', rpcVariable: 'PLASMA_RPC_URL', defaultRpc: 'https://rpc.plasma.to', nativeSymbol: 'XPL',
    wrappedNative: '0x6100E367285b01F48D07953803A2d8dCA5D19873',
    aaveProvider: '0x061D8e131F26512348ee5FA42e2DF1bA9d6505E9',
    fluid: { vault: '0xA5C3E16523eeeDDcC34706b0E6bE88b4c6EA95cC', dex: '0xAf572EfC84d905926F7b05C1B7bE04e4E89542B0', lending: '0x48D32f49aFeAEC7AE66ad7B9264f446fc11a1569' },
  },
};
