import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { lidoStakingApr } from '../server/lido-rates.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
console.log('Checking Lido public staking APR. No wallet address or credentials are sent.');
const quote = await lidoStakingApr();
console.log(JSON.stringify({ ...quote, percentApr: quote.apr === null ? null : quote.apr * 100 }, null, 2));
if (quote.apr === null) process.exitCode = 1;
