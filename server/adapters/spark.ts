import type { Address } from 'viem';
import type { NetworkId, Position, ProtocolResult } from '../../src/types.js';
import type { ChainClient } from '../rpc.js';
import { readAave } from './aave.js';
import { readMorpho } from './morpho.js';
import { SPARK_LEND, sparkCoverage, sparkIsolatedMarkets, sparkVaults } from '../deployments/spark.js';
import { sparkMorphoDiscovery, sparkUnits, sparkVaultAbi, sparkVaultQuote } from '../spark.js';
import { walletPrices } from '../wallet-prices.js';
const unknown = (id: string, label: string, receiptTokens: string[] = []): Position => ({ id, label, receiptTokens, assets: [], suppliedUsd: null, debtUsd: null, healthFactor: null, risk: 'unknown', notes: ['This Spark position could not be checked. Its balances are unknown, not zero.'] });
export async function readSpark(client: ChainClient, wallet: Address, block: bigint, network: NetworkId = 'ethereum'): Promise<ProtocolResult> {
  if (network === 'plasma') throw new Error('Spark is unsupported on Plasma');
  const warnings = new Set<string>(); let complete = true;
  const positions: Position[] = [];
  const lending = network === 'ethereum' ? readAave(client, wallet, block, network, { ...SPARK_LEND, id: 'spark', name: 'SparkLend', legacyEMode: true }) : sparkIsolatedMarkets[network].length
    ? readMorpho(client, wallet, block, () => sparkMorphoDiscovery(client, network, block), network) : Promise.resolve(null);
  const [loans, vaults] = await Promise.all([
    lending.then(result => {
      if (result?.status === 'partial') { warnings.add(result.message ?? 'Some Spark isolated markets could not be checked.'); if (result.positions.some(p => p.assets.length === 0)) complete = false; }
      return result?.positions.map(p => ({ ...p, label: p.morphoMarket ? p.label.replace(/^Morpho/, 'Spark isolated market') : 'SparkLend main market' })) ?? [];
    }).catch(() => { complete = false; warnings.add('Spark lending positions could not be checked. Their balances remain unknown.'); return [unknown('spark-lending-unavailable', 'Spark lending markets')]; }),
    Promise.all(sparkVaults[network].map(async vault => {
      try {
        const shares = await client.readContract({ address: vault.address, abi: sparkVaultAbi, functionName: 'balanceOf', args: [wallet], blockNumber: block });
        if (shares === 0n) return null;
        const [quote, raw] = await Promise.all([sparkVaultQuote(client, network, block, vault), client.readContract({ address: vault.address, abi: sparkVaultAbi, functionName: 'convertToAssets', args: [shares], blockNumber: block })]);
        const prices = await walletPrices(client, network, block, [{ address: quote.asset, decimals: quote.decimals }]);
        const priceUsd = prices.get(quote.asset.toLowerCase()) ?? null, supplied = sparkUnits(raw, quote.decimals);
        if (priceUsd === null || quote.supplyRate.apr === null) warnings.add('Some Spark vault prices or rates are unavailable. Known balances remain visible.');
        return { id: vault.kind === 'morpho' ? `morpho-vault-${vault.address}` : `spark-vault-${vault.address}`, label: `Spark savings · ${quote.name}`, marketAddress: vault.address, receiptTokens: [vault.address], depositOnly: true, suppliedUsd: priceUsd === null ? null : supplied * priceUsd, debtUsd: 0, healthFactor: null, risk: 'no-debt', assets: [{ address: quote.asset, symbol: quote.symbol, supplied, borrowed: 0, priceUsd, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null, supplyRate: quote.supplyRate }], notes: ['ERC-4626 shares are converted to the current underlying amount once. Receipt shares are excluded from wallet totals.', 'Monthly interest uses the current underlying USD value × current APR ÷ 12. External rewards are excluded.'] } satisfies Position;
      } catch { complete = false; warnings.add('Some Spark savings vault balances could not be checked.'); return unknown(`spark-vault-${vault.address}`, 'Spark savings vault', [vault.address]); }
    })),
  ]);
  positions.push(...loans, ...vaults.filter((p): p is NonNullable<typeof p> => p !== null));
  return { id: 'spark', name: 'Spark', status: warnings.size ? 'partial' : 'ok', coverage: sparkCoverage(network), balanceDiscoveryComplete: complete, message: warnings.size ? [...warnings].join(' ') : undefined, positions };
}
/** Spark's Base markets also appear in Morpho's indexer. Keep each holding once. */
export function deduplicateSparkPositions(protocols: ProtocolResult[]): ProtocolResult[] {
  const owned = new Set(protocols.filter(p => p.id === 'spark').flatMap(p => p.positions.filter(x => x.assets.some(a => a.supplied > 0 || a.borrowed > 0)).map(x => `${p.chain ?? ''}:${x.id.toLowerCase()}`)));
  return protocols.map(p => p.id !== 'morpho' ? p : { ...p, positions: p.positions.filter(x => !owned.has(`${p.chain ?? ''}:${x.id.toLowerCase()}`)) });
}
