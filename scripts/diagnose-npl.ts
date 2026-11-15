import 'dotenv/config';
import { isAddress } from 'viem';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { getCombinedPortfolio } from '../server/portfolio.js';
import { monthlyInterestIssues, totalMonthlyInterest } from '../src/monthly-interest.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
const address = process.argv[2];
if (!address || !isAddress(address) || /^0x0{40}$/i.test(address)) {
  console.error('Usage: npm run diagnose:npl -- 0xWalletAddress');
  process.exitCode = 1;
} else {
  console.log('Checking current lending interest. Provider keys and .env contents will not be printed. Merkl incentives are excluded from this diagnostic.');
  try {
    const portfolio = await getCombinedPortfolio(address);
    const interest = totalMonthlyInterest(portfolio.protocols);
    console.log(JSON.stringify({ checkedAt: portfolio.updatedAt, totalInterest: { earnedUsd: interest.earnedUsd, paidUsd: interest.paidUsd, nplUsd: interest.nplUsd }, blockers: monthlyInterestIssues(portfolio.protocols) }, null, 2));
  } catch {
    console.error('Could not complete the lookup. Check the configured network providers. No provider details have been printed.');
    process.exitCode = 1;
  }
}
