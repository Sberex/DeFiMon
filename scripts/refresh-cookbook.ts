import 'dotenv/config';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { getAddress, isAddress } from 'viem';
import { parseCookbook, updateCookbook, cookbookPositions } from '../src/cookbook.js';
import { applyMerklApr } from '../src/merkl-rates.js';
import type { MerklRewards, Portfolio } from '../src/types.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());
async function main() {
  const args = process.argv.slice(2);
  const wallets: string[] = args.length === 1 && args[0] === '--test-cases' ? JSON.parse(await readFile('test-cases.json', 'utf8')) : args;
  if (!wallets.length || wallets.some(w => !isAddress(w, { strict: false }) || /^0x0{40}$/i.test(w))) throw new Error('Usage: npm run refresh:cookbook -- --test-cases OR 0xWallet [0xWallet ...]');
  const base = new URL(process.env.COOKBOOK_API_BASE_URL || 'https://defimon-api.onrender.com');
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Use a public HTTPS DeFiMon API origin');
  let file = parseCookbook(JSON.parse(await readFile('analysis/cookbook.json', 'utf8')));
  let failed = 0;
  for (const input of [...new Set(wallets.map(w => w.toLowerCase()))]) {
    const address = getAddress(input);
    try {
      const [portfolioResponse, rewardsResponse] = await Promise.all([
        fetch(new URL(`/api/portfolio/${address}?chain=all`, base), { signal: AbortSignal.timeout(180000), cache: 'no-store' }),
        fetch(new URL(`/api/rewards/${address}`, base), { signal: AbortSignal.timeout(60000), cache: 'no-store' }).catch(() => null),
      ]);
      if (!portfolioResponse.ok) throw new Error();
      const portfolio: Portfolio = await portfolioResponse.json();
      if (portfolio.address.toLowerCase() !== input || !Array.isArray(portfolio.protocols) || !Array.isArray(portfolio.networks)) throw new Error();
      const rewards: MerklRewards | null = rewardsResponse?.ok ? await rewardsResponse.json() : null;
      if (rewards && rewards.address.toLowerCase() !== input) throw new Error();
      file = updateCookbook(file, applyMerklApr(portfolio, rewards).portfolio);
      parseCookbook(file);
      await writeFile('analysis/cookbook.json.refresh.tmp', `${JSON.stringify(file, null, 2)}\n`);
      await rename('analysis/cookbook.json.refresh.tmp', 'analysis/cookbook.json');
      console.log(`${address}: ${cookbookPositions(file).filter(p => p.address === input).length} qualifying positions saved`);
    } catch { failed++; console.error(`${address}: lookup failed; its previous snapshots were retained`); }
  }
  console.log(`Cookbook now contains ${cookbookPositions(file).length} qualifying snapshots.`);
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error && error.message.startsWith('Usage:') ? error.message : 'Cookbook refresh failed. Existing JSON data was retained.'); process.exitCode = 1; });
