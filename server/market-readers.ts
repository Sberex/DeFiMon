import { parseAbi, type Address } from 'viem';
import type { ComparisonTarget, MarketAlternative } from '../src/market-comparison.js';
import type { NetworkId } from '../src/types.js';
import type { ChainClient } from './rpc.js';
import { networks } from './networks.js';
import { correspondingTokens, normalizeMarketToken, type TokenMatches } from './market-tokens.js';
import { aaveLiquidity, compoundLiquidity } from './market-liquidity.js';
import { perSecondApr, rayApr } from './rates.js';
export type Target = ComparisonTarget & { supplies: string[]; borrows: string[]; allSupplies: string[]; allBorrows: string[]; discovery?: boolean; anySupply?: boolean; anyBorrow?: boolean; marketTokens?: {supplied:string; borrowed?:string} };
export const matchesSupply = (t: Target, address: string) => !!t.anySupply || t.supplies.includes(address.toLowerCase());
export const matchesBorrow = (t: Target, address: string) => !!t.anyBorrow || t.borrows.includes(address.toLowerCase());
export const marketPair = (t: Target, supplied: string, borrowed?: string): Target => ({...t,marketTokens:{supplied:supplied.toLowerCase(),...(borrowed?{borrowed:borrowed.toLowerCase()}:{})}});
export type Reader = (client: ChainClient, network: NetworkId, block: bigint, targets: Target[], warn: (message: string) => void) => Promise<MarketAlternative[]>;
export function expandTargets(targets: ComparisonTarget[], network: NetworkId, matches?: TokenMatches): Target[] {
  return targets.map(t => ({ ...t, supplies: correspondingTokens(t.supplied, t.network, network, matches), borrows: t.borrowed ? correspondingTokens(t.borrowed, t.network, network, matches) : [], allSupplies: (t.supplyBasket ?? [t.supplied]).flatMap(a => correspondingTokens(a, t.network, network, matches)), allBorrows: (t.borrowBasket ?? (t.borrowed ? [t.borrowed] : [])).flatMap(a => correspondingTokens(a, t.network, network, matches)) })).filter(t => t.supplies.length && (!t.borrowed || t.borrows.length));
}
export function option(target: Target, protocol: string, network: NetworkId, block: bigint, market: string, label: string, supplyApr: number, borrowApr: number | null, lltv: number | null, note = ''): MarketAlternative {
  const url = protocol === 'Morpho' ? `https://app.morpho.org/${network}/market/${market}` : protocol === 'Fluid' ? 'https://fluid.io/' : protocol === 'Compound' ? 'https://app.compound.finance/' : protocol === 'Euler' ? 'https://app.euler.finance/' : protocol === 'Spark' ? 'https://app.spark.finance/borrow' : 'https://app.aave.com/';
  return { targetId: target.id, protocol, network, block: String(block), market, label, supplyApr, borrowApr, lltv, url, note, ...(target.discovery ? {marketTokens:target.marketTokens ?? {supplied:target.supplies[0],...(target.borrowed?{borrowed:target.borrows[0]}:{})}} : {}) };
}
export async function limited<T, R>(items: T[], run: (item: T) => Promise<R>, warn: (message: string) => void): Promise<R[]> {
  const results: R[] = []; let next = 0; const deadline = Date.now() + 45000;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => { while (next < items.length) { if (Date.now() > deadline) { warn('Search time limit reached; some markets were not checked.'); break; } const item = items[next++]; try { results.push(await run(item)); } catch { warn('Some markets could not be checked.'); } } }));
  return results;
}
const providerAbi = parseAbi(['function getPoolDataProvider() view returns (address)', 'function getPool() view returns (address)']);
const aaveAbi = parseAbi([
 'function getAllReservesTokens() view returns ((string symbol,address tokenAddress)[])',
 'function getReserveData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40)',
 'function getReserveConfigurationData(address) view returns (uint256,uint256,uint256,uint256,uint256,bool,bool,bool,bool,bool)',
 'function getPaused(address) view returns (bool)',
 'function getDebtCeiling(address) view returns (uint256)',
 'function getSiloedBorrowing(address) view returns (bool)',
]);
const poolAbi = parseAbi(['function getConfiguration(address) view returns ((uint256 data))']);
export function createAaveMarketReader(providerFor: (network: NetworkId) => Address, name = 'Aave v3', virtualLiquidity = true): Reader {
 return async (client, network, block, targets, warn) => {
  const [data, pool] = await Promise.all(['getPoolDataProvider', 'getPool'].map(functionName => client.readContract({ address: providerFor(network), abi: providerAbi, functionName: functionName as 'getPool' | 'getPoolDataProvider', blockNumber: block })));
  const reserves = await client.readContract({ address: data, abi: aaveAbi, functionName: 'getAllReservesTokens', blockNumber: block });
  const wanted = new Set(targets.flatMap(t => [...t.supplies, ...t.borrows]));
  const rows = await limited(reserves.filter(r => targets.some(t=>t.anySupply||t.anyBorrow) || wanted.has(r.tokenAddress.toLowerCase())), async r => {
    const [config, rates, flags] = await Promise.all([
      client.readContract({ address: data, abi: aaveAbi, functionName: 'getReserveConfigurationData', args: [r.tokenAddress], blockNumber: block }),
      client.readContract({ address: data, abi: aaveAbi, functionName: 'getReserveData', args: [r.tokenAddress], blockNumber: block }),
      client.readContract({ address: pool, abi: poolAbi, functionName: 'getConfiguration', args: [r.tokenAddress], blockNumber: block }),
    ]);
    const liquidity = targets.some(t => matchesBorrow(t, r.tokenAddress.toLowerCase())) ? await aaveLiquidity(client, data, pool, r.tokenAddress, flags.data, Number(config[0]), rates[3] + rates[4], block, virtualLiquidity) : null;
    return { address: r.tokenAddress.toLowerCase(), config, rates, bits: flags.data, liquidity };
  }, warn);
  return targets.flatMap(t => rows.filter(s => matchesSupply(t, s.address) && s.config[8] && !s.config[9] && (s.bits & (1n << 60n)) === 0n).flatMap(s => {
    if (!t.borrowed) return [{...option(marketPair(t,s.address), name, network, block, pool, 'Main market', rayApr(s.rates[5]), null, null),...(t.discovery?{liquidity:s.liquidity}:{})}];
    if (!s.config[5] || s.config[2] === 0n) return [];
    return rows.filter(b => matchesBorrow(t, b.address) && b.config[6] && b.config[8] && !b.config[9] && (b.bits & (1n << 60n)) === 0n && ((((s.bits >> 212n) & ((1n << 40n) - 1n)) === 0n) || (b.bits & (1n << 61n)) !== 0n)).map(b => ({ ...option(marketPair(t,s.address,b.address), name, network, block, pool, 'Main market', rayApr(s.rates[5]), rayApr(b.rates[6]), Number(s.config[2]) / 10000, 'Variable borrowing APR; standard collateral configuration. Caps, eMode and available liquidity must be checked before moving a loan.'), liquidity: b.liquidity, collateralLtv: Number(s.config[1]) / 10000 }));
  }));
 };
}
export const readAaveMarkets = createAaveMarketReader(network => networks[network].aaveProvider);
const comet = parseAbi([
 'function baseToken() view returns (address)', 'function getUtilization() view returns (uint256)',
 'function getSupplyRate(uint256) view returns (uint64)', 'function getBorrowRate(uint256) view returns (uint64)',
 'function isSupplyPaused() view returns (bool)', 'function isWithdrawPaused() view returns (bool)',
 'function numAssets() view returns (uint8)',
 'function getAssetInfo(uint8) view returns ((uint8 offset,address asset,address priceFeed,uint64 scale,uint64 borrowCollateralFactor,uint64 liquidateCollateralFactor,uint64 liquidationFactor,uint128 supplyCap))',
]);
export const readCompoundMarkets: Reader = async (client, network, block, targets, warn) => {
  const rows = await limited(networks[network].compoundMarkets, async market => {
    const [base, utilization, count] = await Promise.all([
      client.readContract({ address: market.address, abi: comet, functionName: 'baseToken', blockNumber: block }),
      client.readContract({ address: market.address, abi: comet, functionName: 'getUtilization', blockNumber: block }),
      client.readContract({ address: market.address, abi: comet, functionName: 'numAssets', blockNumber: block }),
    ]);
    const [supply, borrow, collateral, supplyPaused, borrowPaused] = await Promise.all([
      client.readContract({ address: market.address, abi: comet, functionName: 'getSupplyRate', args: [utilization], blockNumber: block }),
      client.readContract({ address: market.address, abi: comet, functionName: 'getBorrowRate', args: [utilization], blockNumber: block }),
      Promise.all(Array.from({ length: count }, (_, i) => client.readContract({ address: market.address, abi: comet, functionName: 'getAssetInfo', args: [i], blockNumber: block }))),
      client.readContract({ address: market.address, abi: comet, functionName: 'isSupplyPaused', blockNumber: block }),
      client.readContract({ address: market.address, abi: comet, functionName: 'isWithdrawPaused', blockNumber: block }),
    ]);
    const liquidity = targets.some(t => t.borrowed && matchesBorrow(t, base.toLowerCase())) ? await compoundLiquidity(client, market.address, base, block) : null;
    return targets.flatMap(t => {
      if (supplyPaused || (t.borrowed && borrowPaused)) return [];
      if (!t.borrowed) return matchesSupply(t, base.toLowerCase()) ? [{...option(marketPair(t,base), 'Compound', network, block, market.address, market.label, perSecondApr(supply), null, null),...(t.discovery?{liquidity}:{})}] : [];
      if (!matchesBorrow(t, base.toLowerCase())) return [];
      return collateral.filter(c => matchesSupply(t, c.asset.toLowerCase()) && c.borrowCollateralFactor > 0n && c.supplyCap > 0n).map(c => ({ ...option(marketPair(t,c.asset,base), 'Compound', network, block, market.address, market.label, 0, perSecondApr(borrow), Number(c.liquidateCollateralFactor) / 1e18, 'Collateral earns no protocol lending interest. Rates exclude COMP incentives; supply caps and available liquidity may limit entry.'), liquidity }));
    });
  }, warn);
  return rows.flat();
};
export { normalizeMarketToken };
