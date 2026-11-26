import 'dotenv/config';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import {
  discoverMarkets,
  parseDiscoveryQuery,
} from '../server/market-discovery.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
  setGlobalDispatcher(new EnvHttpProxyAgent());
const supply = process.argv[2] ?? 'sUSDai',
  borrow = process.argv[3] ?? 'USDC';
try {
  const result = await discoverMarkets(
    parseDiscoveryQuery({
      supply: supply.toLowerCase() === 'any' ? null : supply,
      borrow: borrow.toLowerCase() === 'any' ? null : borrow,
    }),
  );
  console.log(
    JSON.stringify(
      {
        query: result.query,
        checkedAt: result.checkedAt,
        count: result.markets.length,
        coverage: result.coverage,
        messages: result.messages,
        sample: result.markets.slice(0, 10),
      },
      null,
      2,
    ),
  );
  if (
    result.coverage.length &&
    result.coverage.every(
      (c) => c.status === 'error' || c.status === 'unsupported',
    )
  )
    process.exitCode = 1;
} catch {
  console.error(
    'Market discovery check failed. Use configured token group names, or "any". Provider details are never printed.',
  );
  process.exitCode = 1;
}
