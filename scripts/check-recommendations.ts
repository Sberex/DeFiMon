import 'dotenv/config';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { searchMarkets } from '../server/market-search.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
console.log('Checking public wstETH/GHO borrowing and USDC deposit markets. No wallet address, provider URL, keys or .env contents will be printed.');
try {
  const result = await searchMarkets([
    { id: 'wsteth-gho', network: 'ethereum', supplied: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', borrowed: '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f' },
    { id: 'usdc-deposit', network: 'ethereum', supplied: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
  ]);
  console.log(JSON.stringify({ checkedAt: result.checkedAt, coverage: result.coverage, marketsFound: result.alternatives.length, sample: result.alternatives.slice(0, 12) }, null, 2));
} catch { console.error('Market check could not complete. Check the configured public data sources and network providers.'); process.exitCode = 1; }
