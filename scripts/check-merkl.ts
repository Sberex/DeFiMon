import 'dotenv/config';
import { isAddress } from 'viem';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { readMerklRewards } from '../server/merkl.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
const address = process.argv[2];
if (!address || !isAddress(address, { strict: false }) || /^0x0{40}$/i.test(address)) {
  console.error('Usage: npm run check:merkl -- 0xYourWalletAddress'); process.exitCode = 1;
} else {
  const result = await readMerklRewards(address.toLowerCase() as `0x${string}`);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'ok') process.exitCode = 1;
}
