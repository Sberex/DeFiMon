import 'dotenv/config';
import { isAddress } from 'viem';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { makeClient } from '../server/rpc.js';
import { readMorpho } from '../server/adapters/morpho.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
const wallet = process.argv[2];
if (!wallet || !isAddress(wallet)) {
  console.error('Usage: npm run check:morpho -- 0xWalletAddressWithKnownMorphoPositions');
  process.exitCode = 1;
} else {
  try {
    const client = makeClient();
    if (await client.getChainId() !== 1) throw new Error('Wrong network');
    const block = await client.getBlockNumber();
    const result = await readMorpho(client, wallet, block);
    console.log(JSON.stringify({ block: String(block), ...result }, null, 2));
    if (result.status !== 'ok' || !result.positions.length) {
      console.error('The check did not verify a complete, nonempty Morpho portfolio. Inspect the reported coverage and warnings.');
      process.exitCode = 1;
    }
  } catch {
    console.error('Could not complete the live Morpho check. Verify access to api.morpho.org, ETHEREUM_RPC_URL, and Ethereum network access.');
    process.exitCode = 1;
  }
}
