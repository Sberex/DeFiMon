import 'dotenv/config';
import { isAddress } from 'viem';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { makeClient } from '../server/rpc.js';
import { networks } from '../server/networks.js';
import { readWallet } from '../server/wallet.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
const [wallet, network = 'ethereum', ...extra] = process.argv.slice(2);
if (!wallet || !isAddress(wallet) || (network !== 'ethereum' && network !== 'plasma') || extra.length > 20 || extra.some(t => !isAddress(t, { strict: false }))) {
  console.error('Usage: npm run check:wallet -- 0xWalletAddress ethereum|plasma [0xExtraTokenAddress ...]'); process.exitCode = 1;
} else {
  try {
    const client = makeClient(network);
    if (await client.getChainId() !== networks[network].id) throw new Error('Wrong network');
    const block = await client.getBlockNumber();
    const result = await readWallet(client, wallet, block, network, [], extra);
    console.log(JSON.stringify({ blockNumber: String(block), ...result }, null, 2));
    if (result.status !== 'ok') process.exitCode = 1;
  } catch { console.error('Wallet check failed. Check the selected network’s provider connection.'); process.exitCode = 1; }
}
