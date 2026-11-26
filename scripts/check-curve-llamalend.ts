import 'dotenv/config';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { isAddress } from 'viem';
import { makeClient } from '../server/rpc.js';
import { isNetworkId } from '../src/networks.js';
import { readCurveMarkets } from '../server/market-curve-llamalend.js';
import { expandTargets } from '../server/market-readers.js';
import { createCurveReader } from '../server/curve-llamalend.js';
import { readCurveLlamalend } from '../server/adapters/curve-llamalend.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
  setGlobalDispatcher(new EnvHttpProxyAgent());
const network = process.argv[2] ?? 'ethereum',
  wallet = process.argv[3];
if (!isNetworkId(network) || (wallet && !isAddress(wallet, { strict: false })))
  throw Error('Usage: tsx scripts/check-curve-llamalend.ts NETWORK [WALLET]');
try {
  const client = makeClient(
      network,
      network === 'ethereum'
        ? process.env.ETHEREUM_RPC_URL || 'https://eth.drpc.org'
        : undefined,
    ),
    block = await client.getBlockNumber(),
    reader = createCurveReader(client, network, block),
    catalog = await reader.catalog();
  const samples = [];
  for (const version of [1, 2]) {
    const m = catalog.markets.find((m) => m.version === version);
    if (m) {
      try {
        const q = await reader.quote(m);
        samples.push({
          version,
          controller: m.controller,
          vault: m.vault,
          label: q.label,
          borrowApr: q.borrowRate.apr,
          supplyApr: q.supplyRate.apr,
          availableLiquidity: q.liquidity,
          totalDebt: String(q.debt),
          totalAssets: String(q.total),
        });
      } catch {
        samples.push({ version, error: 'Sample quote unavailable' });
        process.exitCode = 1;
      }
    }
  }
  const primary =
    catalog.markets.find((m) => m.version === 2) ?? catalog.markets[0];
  const warnings: string[] = [];
  const recommendations = primary
    ? await readCurveMarkets(
        client,
        network,
        block,
        expandTargets(
          [
            {
              id: 'borrow-sample',
              network,
              supplied: primary.collateral,
              borrowed: primary.borrowed,
            },
            { id: 'deposit-sample', network, supplied: primary.borrowed },
          ],
          network,
        ),
        (message) => warnings.push(message),
      )
    : [];
  console.log(
    JSON.stringify(
      {
        network,
        block: String(block),
        catalogComplete: catalog.complete,
        markets: catalog.markets.length,
        samples,
        recommendations,
        warnings,
        ...(wallet
          ? {
              portfolio: await readCurveLlamalend(
                client,
                wallet as `0x${string}`,
                block,
                network,
              ),
            }
          : {}),
      },
      null,
      2,
    ),
  );
} catch {
  console.error(
    'Curve check failed. Check network connectivity and the verified factory deployment. Provider details are never printed.',
  );
  process.exitCode = 1;
}
