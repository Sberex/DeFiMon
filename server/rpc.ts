import { createPublicClient, defineChain, http } from 'viem';
import { arbitrum, mainnet, plasma, base, bsc } from 'viem/chains';
import type { NetworkId } from '../src/types.js';
import { networks } from './networks.js';
export const arcChain = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' },
  },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
});
export function makeClient(
  network: NetworkId = 'ethereum',
  overrideUrl?: string,
  signal?: AbortSignal,
) {
  const config = networks[network];
  const url =
    overrideUrl || process.env[config.rpcVariable] || config.defaultRpc;
  if (!url)
    throw new Error(
      `Configure ${config.rpcVariable} on the server to read ${config.name}.`,
    );
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' &&
    !(
      parsed.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(parsed.hostname)
    )
  ) {
    throw new Error(`${config.rpcVariable} must use HTTPS.`);
  }
  return createPublicClient({
    chain:
      network === 'arc'
        ? arcChain
        : network === 'bsc'
          ? bsc
          : network === 'base'
            ? base
            : network === 'arbitrum'
              ? arbitrum
              : network === 'plasma'
                ? plasma
                : mainnet,
    transport: http(url, {
      timeout: 15_000,
      retryCount: 0,
      ...(signal ? { fetchOptions: { signal } } : {}),
    }),
    batch: { multicall: true },
  });
}
export type ChainClient = ReturnType<typeof makeClient>;
