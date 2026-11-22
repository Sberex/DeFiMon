import 'dotenv/config';
import { isAddress } from 'viem';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { makeClient } from '../server/rpc.js';
import { readAaveV3Markets } from '../server/adapters/aave-markets.js';
import { applyIntrinsicRates } from '../server/intrinsic-rates.js';
import { positionMonthlyInterest } from '../src/monthly-interest.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());
const wallet = process.argv[2];
if (!wallet || !isAddress(wallet)) { console.error('Usage: npm run check:horizon -- 0xWalletAddress'); process.exitCode = 1; }
else {
  try {
    const client = makeClient();
    if (await client.getChainId() !== 1) throw Error('Wrong network');
    const block = await client.getBlockNumber();
    const [result] = await applyIntrinsicRates([await readAaveV3Markets(client, wallet, block)], 'ethereum');
    const position = result.positions.find(p => p.id === 'aave-horizon-main');
    console.log(JSON.stringify({ block: String(block), status: result.status, position, monthlyInterest: position ? positionMonthlyInterest(position) : null }, null, 2));
    if (!position?.assets.length) process.exitCode = 1;
  } catch { console.error('Horizon lookup failed. Check the Ethereum provider connection. No provider credentials are printed.'); process.exitCode = 1; }
}
