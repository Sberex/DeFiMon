import 'dotenv/config';
import { isAddress } from 'viem';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { isNetworkId, networkNames } from '../src/networks.js';
import { getPortfolio } from '../server/portfolio.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
const [network, wallet] = process.argv.slice(2);
if (!isNetworkId(network) || !wallet || !isAddress(wallet) || /^0x0{40}$/i.test(wallet)) {
  console.error('Usage: tsx scripts/check-network.ts ethereum|plasma|arbitrum 0xYourWalletAddress');
  process.exitCode = 1;
} else {
  try {
    const result = await getPortfolio(wallet, network);
    console.log(JSON.stringify(result, null, 2));
    if (result.protocols.some(p => p.status !== 'ok')) process.exitCode = 1;
  } catch {
    console.error(`Could not read ${networkNames[network]}. Check its provider connection and network settings.`);
    process.exitCode = 1;
  }
}
