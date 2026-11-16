import 'dotenv/config';
import { isAddress } from 'viem';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { createTokenDiscovery } from '../server/token-discovery.js';
import { isNetworkId } from '../src/networks.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
const network = process.argv[2], token = process.argv[3];
if (!isNetworkId(network) || !token || !isAddress(token, { strict: false }) || /^0x0{40}$/i.test(token)) {
  console.error('Usage: npm run diagnose:token-matches -- ethereum|arbitrum|plasma|base 0xTokenContract'); process.exitCode = 1;
} else {
  console.log('Public token-contract matching only. No wallet address, API key, provider URL or .env contents will be printed.');
  try { const result = await createTokenDiscovery().resolve([{ id: 'token', network, supplied: token }]); console.log(JSON.stringify(result.reports, null, 2)); }
  catch { console.error('Token matching could not complete. Check the public data-source access and server configuration.'); process.exitCode = 1; }
}
