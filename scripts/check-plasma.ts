import 'dotenv/config';
import { isAddress } from 'viem';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { getPortfolio } from '../server/portfolio.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
const wallet = process.argv[2];
if (!wallet || !isAddress(wallet) || /^0x0{40}$/i.test(wallet)) {
  console.error('Usage: npm run check:plasma -- 0xYourWalletAddress');
  process.exitCode = 1;
} else {
  try {
    const result = await getPortfolio(wallet, 'plasma');
    console.log(JSON.stringify(result, null, 2));
    if (result.protocols.some(protocol => protocol.status !== 'ok')) {
      console.error('Some Plasma positions or prices could not be checked. Review the warnings above.');
      process.exitCode = 1;
    }
  } catch {
    console.error('Could not read Plasma. Check PLASMA_RPC_URL and access to its mainnet provider (chain ID 9745).');
    process.exitCode = 1;
  }
}
