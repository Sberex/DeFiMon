import 'dotenv/config';
import { isAddress } from 'viem';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { makeClient } from '../server/rpc.js';
import { readAaveV4 } from '../server/adapters/aave-v4.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
const wallet = process.argv[2];
if (!wallet || !isAddress(wallet)) {
  console.error('Usage: npm run check:aave-v4 -- 0xWalletAddressWithKnownAaveV4Positions');
  process.exitCode = 1;
} else {
  try {
    const client = makeClient();
    if (await client.getChainId() !== 1) throw new Error('Wrong network');
    const block = await client.getBlockNumber();
    const result = await readAaveV4(client, wallet, block);
    console.log(JSON.stringify({ block: String(block), ...result }, null, 2));
    if (result.status !== 'ok' || !result.positions.length) {
      console.error('The check did not verify a complete, nonempty Aave v4 portfolio. Inspect the reported coverage and warnings.');
      process.exitCode = 1;
    }
  } catch {
    console.error('Could not complete the live Aave v4 check. Verify ETHEREUM_RPC_URL and Ethereum network access.');
    process.exitCode = 1;
  }
}
