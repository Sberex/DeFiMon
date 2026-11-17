import 'dotenv/config';
import { isAddress } from 'viem';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { readPendle } from '../server/pendle.js';
import { makeClient } from '../server/rpc.js';
import { isNetworkId } from '../src/networks.js';
import { networks } from '../server/networks.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
const wallet = process.argv[2], network = process.argv[3] ?? 'ethereum';
if (!isAddress(wallet ?? '', { strict: false }) || !isNetworkId(network)) {
  console.error('Usage: npm run check:pendle -- 0xWallet ethereum|plasma|arbitrum|base'); process.exitCode = 1;
} else {
  console.log('Reading public Pendle holdings and prices. Provider URLs and keys will not be printed.');
  try {
    const client = makeClient(network); if (await client.getChainId() !== networks[network].id) throw new Error('Wrong network');
    const block = await client.getBlockNumber(), result = await readPendle(client, wallet as `0x${string}`, block, network);
    console.log(JSON.stringify(result, null, 2)); if (result.coverage.status !== 'ok') process.exitCode = 1;
  } catch { console.error('Pendle check failed. Check this network’s mainnet provider and access to api-v2.pendle.finance.'); process.exitCode = 1; }
}
