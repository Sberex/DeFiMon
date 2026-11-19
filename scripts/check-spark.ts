import 'dotenv/config';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { getAddress, isAddress } from 'viem';
import { makeClient } from '../server/rpc.js';
import { networks } from '../server/networks.js';
import { readSpark } from '../server/adapters/spark.js';
const [wallet, chain = 'ethereum'] = process.argv.slice(2);
if (!wallet || !isAddress(wallet, { strict: false }) || !['ethereum', 'base', 'arbitrum'].includes(chain)) {
  console.error('Usage: npm run check:spark -- 0xWallet ethereum|base|arbitrum'); process.exitCode = 1;
} else {
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());
  try {
    const network = chain as 'ethereum' | 'base' | 'arbitrum', client = makeClient(network);
    if (await client.getChainId() !== networks[network].id) throw new Error('Wrong network');
    const block = await client.getBlockNumber();
    console.log(JSON.stringify({ blockNumber: String(block), ...await readSpark(client, getAddress(wallet.toLowerCase()), block, network) }, null, 2));
  } catch { console.error('Spark check failed. Check the selected network provider connection.'); process.exitCode = 1; }
}
