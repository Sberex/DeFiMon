import { aaveV4SpokeAbi as spoke, aaveV4TokenAbi as token } from './abis/aave-v4.js';
import { AAVE_V4_SPOKES, AAVE_V4_TOKENIZATION_SPOKES } from './deployments/aave-v4.js';
import { v4Liquidity } from './market-liquidity.js';
import { readV4HubRates } from './aave-v4-rates.js';
import { limited, option, type Reader } from './market-readers.js';
export const readV4Markets: Reader = async (client, network, block, targets, warn) => {
  const hubs = new Map<string, ReturnType<typeof readV4HubRates>>();
  const liquidities = new Map<string, ReturnType<typeof v4Liquidity>>();
  const rates = (reserve: { hub: `0x${string}`; assetId: number; underlying: `0x${string}` }) => {
    const key = `${reserve.hub}:${reserve.assetId}`;
    if (!hubs.has(key)) hubs.set(key, readV4HubRates(client, reserve.hub, BigInt(reserve.assetId), reserve.underlying, block));
    return hubs.get(key)!;
  };
  const markets = await limited([...AAVE_V4_SPOKES], async market => {
    const count = await client.readContract({ address: market.address, abi: spoke, functionName: 'getReserveCount', blockNumber: block });
    if (count > 1000n) throw new Error('Unexpected count');
    const reserves = await limited(Array.from({ length: Number(count) }, (_, i) => BigInt(i)), async id => {
      const reserve = await client.readContract({ address: market.address, abi: spoke, functionName: 'getReserve', args: [id], blockNumber: block });
      return { id, ...reserve };
    }, warn);
    const options = [];
    for (const target of targets) {
      for (const supply of reserves.filter(r => target.supplies.includes(r.underlying.toLowerCase()) && (r.flags & 3) === 0)) {
        const sr = await rates(supply);
        if (sr?.supplyRate.apr == null) { warn('Some Aave v4 rates are unavailable.'); continue; }
        if (!target.borrowed) { options.push({ ...option(target, 'Aave v4', network, block, market.address, `${market.label} · reserve ${supply.assetId}@${supply.hub.slice(0, 8)}`, sr.supplyRate.apr, null, null), route: `${supply.hub.toLowerCase()}/${supply.assetId}` }); continue; }
        const config = await client.readContract({ address: market.address, abi: spoke, functionName: 'getDynamicReserveConfig', args: [supply.id, supply.dynamicConfigKey], blockNumber: block });
        if (config.collateralFactor === 0) continue;
        for (const borrow of reserves.filter(r => target.borrows.includes(r.underlying.toLowerCase()) && (r.flags & 3) === 0 && (r.flags & 4) !== 0)) {
          const br = await rates(borrow);
          if (!br) { warn('Some Aave v4 rates are unavailable.'); continue; }
          const liquidityKey = `${market.address}:${borrow.hub}:${borrow.assetId}`;
          if (!liquidities.has(liquidityKey)) liquidities.set(liquidityKey, v4Liquidity(client, borrow.hub, BigInt(borrow.assetId), market.address, borrow.underlying, block));
          const liquidity = await liquidities.get(liquidityKey)!;
          options.push({ ...option(target, 'Aave v4', network, block, market.address, `${market.label} · reserves ${supply.assetId}/${borrow.assetId}`, sr.supplyRate.apr, br.baseApr * (1 + supply.collateralRisk / 10000), config.collateralFactor / 10000, 'Estimated new-loan APR for this single collateral, including its current risk premium. A multi-collateral loan can have a different premium. Caps and available liquidity are not a transaction quote.'), liquidity, route: `${supply.hub.toLowerCase()}/${supply.assetId}:${borrow.hub.toLowerCase()}/${borrow.assetId}` });
        }
      }
    }
    return options;
  }, warn);
  const deposits = targets.filter(t => !t.borrowed);
  const tokenized = deposits.length ? await limited([...AAVE_V4_TOKENIZATION_SPOKES], async market => {
    const asset = await client.readContract({ address: market.address, abi: token, functionName: 'asset', blockNumber: block });
    const relevant = deposits.filter(t => t.supplies.includes(asset.toLowerCase()));
    if (!relevant.length) return [];
    const [hub, assetId] = await Promise.all([
      client.readContract({ address: market.address, abi: token, functionName: 'hub', blockNumber: block }),
      client.readContract({ address: market.address, abi: token, functionName: 'assetId', blockNumber: block }),
    ]);
    const rate = await readV4HubRates(client, hub, assetId, asset, block);
    if (rate?.supplyRate.apr == null) { warn('Some tokenized deposit rates are unavailable.'); return []; }
    return relevant.map(t => option(t, 'Aave v4', network, block, market.address, `${market.label} tokenized deposit`, rate.supplyRate.apr!, null, null));
  }, warn) : [];
  return [...markets.flat(), ...tokenized.flat()];
};
