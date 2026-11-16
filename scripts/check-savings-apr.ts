import 'dotenv/config';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { getSusdaiIntrinsicRate } from '../server/intrinsic-rates.js';
import { savingsRateService } from '../server/savings-rates.js';
import { configuredTokenRegistry } from '../server/token-registry.js';
import { isNetworkId } from '../src/networks.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
const group = process.argv[2] ?? 'reUSD', network = process.argv[3] ?? 'ethereum';
if (!isNetworkId(network) || configuredTokenRegistry[group]?.category !== 'Savings stablecoin') {
  console.error('Usage: npm run check:savings-apr -- CONFIG_GROUP [ethereum|plasma|arbitrum|base]. The group must be marked Savings stablecoin.'); process.exitCode = 1;
} else {
  console.log('Checking public on-chain savings-rate observations. No wallet, provider URL or API key will be printed.');
  const result = group === 'sUSDai' ? await getSusdaiIntrinsicRate() : await savingsRateService.quote(group, { network });
  console.log(JSON.stringify({ group, ...result }, null, 2));
  if (result.apr === null) process.exitCode = 1;
}
