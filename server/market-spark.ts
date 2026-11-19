import { parseAbi } from 'viem';
import { createAaveMarketReader, limited, option, type Reader } from './market-readers.js';
import { SPARK_LEND, sparkIsolatedMarkets, sparkVaults } from './deployments/spark.js';
import { sparkVaultAbi, sparkVaultQuote } from './spark.js';
import { createMorphoRates } from './morpho-rates.js';
import { liquidityQuote, tokenMetadata } from './market-liquidity.js';
import { networks } from './networks.js';
const lend = createAaveMarketReader(() => SPARK_LEND.provider, 'Spark', false);
const zero = '0x0000000000000000000000000000000000000000';
export const readSparkMarkets: Reader = async (client, network, block, targets, warn) => {
  const loans = network === 'ethereum' ? lend(client, network, block, targets, warn).catch(() => { warn('SparkLend rate search is unavailable.'); return []; }) : Promise.resolve([]);
  const core = networks[network].morphoBlue;
  const rates = core ? createMorphoRates(client, block, core) : null;
  const isolated = limited(sparkIsolatedMarkets[network], async id => {
    if (!rates) throw new Error('No Morpho deployment');
    const quote = await rates.marketQuote(id);
    const { params, state } = quote;
    const collateral = params.collateralToken.toLowerCase(), loan = params.loanToken.toLowerCase();
    const oracle = await client.readContract({ address: params.oracle, abi: parseAbi(['function price() view returns(uint256)']), functionName: 'price', blockNumber: block });
    if (oracle <= 0n) { warn('A Spark isolated market has an unavailable collateral oracle.'); return []; }
    const metadata = await tokenMetadata(client, params.loanToken, block);
    const liquidity = liquidityQuote(state.totalSupplyAssets > state.totalBorrowAssets ? state.totalSupplyAssets - state.totalBorrowAssets : 0n, metadata.decimals, metadata.symbol, params.loanToken, 'Spark isolated market total liquidity on Morpho: accrued loan assets supplied minus accrued loan assets borrowed.');
    return targets.flatMap(t => {
      if (t.borrowed ? !t.supplies.includes(collateral) || !t.borrows.includes(loan) || quote.borrowApr === null || params.lltv === 0n : !t.supplies.includes(loan)) return [];
      return [{ ...option(t, 'Spark', network, block, id, `Spark isolated market · ${metadata.symbol}`, t.borrowed ? 0 : quote.apr, t.borrowed ? quote.borrowApr : null, t.borrowed ? Number(params.lltv) / 1e18 : null, 'Spark curated isolated market on Morpho Blue. Current on-chain rates after simulated accrual; external rewards excluded.'), url: `https://app.spark.finance/isolated-markets/${network}/${id}`, liquidity: t.borrowed ? liquidity : undefined }];
    });
  }, warn);
  const vaults = limited(targets.some(t => !t.borrowed) ? sparkVaults[network] : [], async vault => {
    const quote = await sparkVaultQuote(client, network, block, vault);
    if (quote.supplyRate.apr === null) { warn('Some Spark savings rates could not be checked.'); return []; }
    const capacity = await client.readContract({ address: vault.address, abi: sparkVaultAbi, functionName: 'maxDeposit', args: [zero], blockNumber: block });
    if (capacity === 0n) return [];
    return targets.filter(t => !t.borrowed && t.supplies.includes(quote.asset.toLowerCase())).map(t => ({ ...option(t, 'Spark', network, block, vault.address, quote.name, quote.supplyRate.apr!, null, null, 'Spark savings deposit APR, without compounding or external rewards. Deposits depend on current capacity and access rules.'), url: 'https://app.spark.finance/savings' }));
  }, warn);
  return [...await loans, ...(await isolated).flat(), ...(await vaults).flat()];
};
