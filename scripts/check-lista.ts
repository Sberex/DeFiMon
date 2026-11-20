import 'dotenv/config';
import { isAddress } from 'viem';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { makeClient } from '../server/rpc.js';
import { readLista } from '../server/adapters/lista.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());
const [wallet, network = 'bsc'] = process.argv.slice(2);
if (!wallet || !isAddress(wallet, { strict: false }) || /^0x0{40}$/i.test(wallet) || !['bsc', 'ethereum'].includes(network)) {
  console.error('Usage: npm run check:lista -- 0xWalletAddress bsc|ethereum'); process.exitCode = 1;
} else {
  try {
    const client = makeClient(network as 'bsc' | 'ethereum');
    if (await client.getChainId() !== (network === 'bsc' ? 56 : 1)) throw new Error('Wrong network');
    const block = await client.getBlockNumber();
    console.log(JSON.stringify({ network, block: String(block), ...await readLista(client, wallet, block, network as 'bsc' | 'ethereum') }, null, 2));
  } catch { console.error('Lista positions could not be verified. Check api.lista.org and the selected network provider.'); process.exitCode = 1; }
}
