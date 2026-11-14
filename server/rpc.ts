import { createPublicClient, http } from 'viem';
import { arbitrum, mainnet, plasma } from 'viem/chains';
import type { NetworkId } from '../src/types.js';
import { networks } from './networks.js';
export function makeClient(network: NetworkId = 'ethereum') {
  const config = networks[network];
  const url = process.env[config.rpcVariable] || config.defaultRpc;
  if (!url) throw new Error(`Configure ${config.rpcVariable} on the server to read ${config.name}.`);
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw new Error(`${config.rpcVariable} must use HTTPS.`);
  }
  return createPublicClient({ chain: network === 'arbitrum' ? arbitrum : network === 'plasma' ? plasma : mainnet, transport: http(url, { timeout: 15_000, retryCount: 0 }), batch: { multicall: true } });
}
export type ChainClient = ReturnType<typeof makeClient>;
