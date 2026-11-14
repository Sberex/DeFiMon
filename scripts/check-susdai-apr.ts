import 'dotenv/config';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { getSusdaiIntrinsicRate } from '../server/intrinsic-rates.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
const result = await getSusdaiIntrinsicRate();
console.log(JSON.stringify(result, null, 2));
if (result.apr === null) process.exitCode = 1;
