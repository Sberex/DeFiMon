import { formatUnits, parseAbi, type Address } from 'viem';
import type { NetworkId, InterestRate } from '../src/types.js';
import type { ChainClient } from './rpc.js';
import type { MorphoDiscovery, MorphoToken } from './morpho-discovery.js';
import { morphoCoreAbi } from './abis/morpho.js';
import { tokenMetadata } from './market-liquidity.js';
import { walletPrices } from './wallet-prices.js';
import { networks } from './networks.js';
import { createMorphoRates } from './morpho-rates.js';
import { rate, unavailableRate } from './rates.js';
import { sparkIsolatedMarkets, type SparkVault } from './deployments/spark.js';
export const sparkVaultAbi = parseAbi([
  'function balanceOf(address) view returns(uint256)', 'function asset() view returns(address)',
  'function convertToAssets(uint256) view returns(uint256)', 'function totalAssets() view returns(uint256)',
  'function maxDeposit(address) view returns(uint256)', 'function name() view returns(string)',
  'function vsr() view returns(uint256)', 'function rateProvider() view returns(address)',
  'function getSSR() view returns(uint256)', 'function MORPHO() view returns(address)',
]);
const RAY = 10n ** 27n;
export function sparkSavingsApr(factor: bigint) {
  if (factor < RAY) throw new Error('Invalid Spark savings factor');
  const apr = Number(factor - RAY) / 1e27 * 31536000;
  if (!Number.isFinite(apr)) throw new Error('Invalid Spark savings rate');
  return apr;
}
export async function sparkVaultRate(client: ChainClient, network: NetworkId, block: bigint, vault: SparkVault, underlying: Address): Promise<InterestRate> {
  try {
    if (vault.kind === 'morpho') {
      const core = await client.readContract({ address: vault.address, abi: sparkVaultAbi, functionName: 'MORPHO', blockNumber: block });
      if (core.toLowerCase() !== networks[network].morphoBlue?.toLowerCase()) throw new Error('Wrong vault core');
      return await createMorphoRates(client, block, core).vault(vault.address, 1, underlying);
    }
    const source = vault.kind === 'ssr' ? await client.readContract({ address: vault.address, abi: sparkVaultAbi, functionName: 'rateProvider', blockNumber: block }) : vault.address;
    if (vault.kind === 'ssr' && source.toLowerCase() !== vault.oracle?.toLowerCase()) throw new Error('Wrong Spark SSR oracle');
    const factor = await client.readContract({ address: source, abi: sparkVaultAbi, functionName: vault.kind === 'vsr' ? 'vsr' : 'getSSR', blockNumber: block });
    return rate(sparkSavingsApr(factor), 'Current Spark savings APR from the on-chain per-second ray factor, annualized over 365 days without compounding. Not APY; excludes SPK rewards.');
  } catch { return unavailableRate(); }
}
export async function sparkVaultQuote(client: ChainClient, network: NetworkId, block: bigint, vault: SparkVault) {
  const [asset, name] = await Promise.all([
    client.readContract({ address: vault.address, abi: sparkVaultAbi, functionName: 'asset', blockNumber: block }),
    client.readContract({ address: vault.address, abi: sparkVaultAbi, functionName: 'name', blockNumber: block }),
  ]);
  if (/^0x0{40}$/i.test(asset) || !name || name.length > 256) throw new Error('Invalid Spark vault identity');
  const metadata = await tokenMetadata(client, asset, block);
  if (metadata.decimals > 36) throw new Error('Invalid Spark asset precision');
  return { asset, name, ...metadata, supplyRate: await sparkVaultRate(client, network, block, vault, asset) };
}
export async function sparkMorphoDiscovery(client: ChainClient, network: NetworkId, block: bigint): Promise<MorphoDiscovery> {
  const core = networks[network].morphoBlue;
  if (!core || !sparkIsolatedMarkets[network].length) return { markets: [], vaults: [], warnings: [], successfulFamilies: 1, holdingsComplete: true };
  const entries = await Promise.all(sparkIsolatedMarkets[network].map(async id => ({ id, params: await client.readContract({ address: core, abi: morphoCoreAbi, functionName: 'idToMarketParams', args: [id], blockNumber: block }) })));
  const addresses = [...new Set(entries.flatMap(e => [e.params.loanToken, e.params.collateralToken]))];
  const tokens = await Promise.all(addresses.map(async address => ({ address, ...await tokenMetadata(client, address, block) })));
  const prices = await walletPrices(client, network, block, tokens);
  const token = (address: Address): MorphoToken => ({ ...tokens.find(t => t.address.toLowerCase() === address.toLowerCase())!, priceUsd: prices.get(address.toLowerCase()) ?? null });
  return { vaults: [], warnings: [], successfulFamilies: 1, holdingsComplete: true, markets: entries.map(e => ({ id: e.id, loan: token(e.params.loanToken), collateral: token(e.params.collateralToken) })) };
}
export const sparkUnits = (raw: bigint, decimals: number) => Number(formatUnits(raw, decimals));
