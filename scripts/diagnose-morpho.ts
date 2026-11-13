import 'dotenv/config';
import { isAddress } from 'viem';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { fetchMorphoDiscovery, MORPHO_API } from '../server/morpho-discovery.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
const wallet = process.argv[2];
if (!wallet || !isAddress(wallet)) {
  console.error('Usage: npm run diagnose:morpho -- 0xYourWalletAddress');
  process.exitCode = 1;
} else {
  console.log('Testing public Morpho lookup only. No Ethereum-provider key or .env contents will be printed.');
  const result = await fetchMorphoDiscovery(wallet);
  console.log(JSON.stringify({ endpoint: MORPHO_API, successfulLookups: result.successfulFamilies, marketsFound: result.markets.length, vaultsFound: result.vaults.length, failures: result.failures, warnings: result.warnings }, null, 2));
  if (result.failures?.length) process.exitCode = 1;
}
