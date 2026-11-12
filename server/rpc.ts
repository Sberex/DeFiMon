import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
export function makeClient() {
  const url = process.env.ETHEREUM_RPC_URL;
  if (!url) throw new Error('Configure ETHEREUM_RPC_URL on the server to read Ethereum.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw new Error('ETHEREUM_RPC_URL must use HTTPS.');
  }
  return createPublicClient({ chain: mainnet, transport: http(url, { timeout: 15_000, retryCount: 0 }), batch: { multicall: true } });
}
export type ChainClient = ReturnType<typeof makeClient>;
