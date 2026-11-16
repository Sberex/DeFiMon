import 'dotenv/config';
import { isAddress } from 'viem';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { makeClient } from '../server/rpc.js';
import { readEuler } from '../server/adapters/euler.js';
import { isNetworkId } from '../src/networks.js';
import { networks } from '../server/networks.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
const wallet = process.argv[2], network = process.argv[3] ?? 'ethereum';
if (!wallet || !isAddress(wallet, { strict: false }) || /^0x0{40}$/i.test(wallet) || !isNetworkId(network)) {
  console.error('Usage: npm run check:euler -- 0xWalletAddress [ethereum|arbitrum|plasma|base]'); process.exitCode = 1;
} else {
  console.log('Checking current Euler V2 EVK positions. No transaction, provider URL, API key or .env contents will be printed.');
  try {
    const client = makeClient(network); if (await client.getChainId() !== networks[network].id) throw new Error('Wrong network');
    const block = await client.getBlockNumber(), result = await readEuler(client, wallet, block, network);
    console.log(JSON.stringify({ network, block: String(block), ...result }, null, 2));
    if (result.status !== 'ok') process.exitCode = 1;
  } catch { console.error('Euler lookup could not complete. Check the configured provider and Euler deployment access on this network.'); process.exitCode = 1; }
}
