import { eulerRegistry, createEulerReader, eulerAddress, resolveEulerCap } from './euler.js';
import { eulerVaultAbi } from './abis/euler.js';
import { limited, option, type Reader } from './market-readers.js';
export const readEulerMarkets: Reader = async (client, network, block, targets, warn) => {
  const registry = await eulerRegistry(client, network, block, warn), reader = createEulerReader(client, network, block);
  const wanted = new Set(targets.flatMap(t => t.borrowed ? t.borrows : t.supplies));
  const assetsByVault = new Map<string, string>();
  const chunks = Array.from({ length: Math.ceil(registry.vaults.length / 100) }, (_, i) => registry.vaults.slice(i * 100, (i + 1) * 100));
  const relevant = (await limited(chunks, async addresses => {
    const rows = await client.multicall({ contracts: addresses.map(address => ({ address, abi: eulerVaultAbi, functionName: 'asset' as const })), blockNumber: block, allowFailure: true, batchSize: 8192 });
    if (rows.length !== addresses.length) throw new Error('Incomplete metadata batch');
    return rows.flatMap((row, index) => {
      if (row.status !== 'success' || typeof row.result !== 'string') { warn('Some Euler vault assets could not be discovered.'); return []; }
      assetsByVault.set(addresses[index].toLowerCase(), row.result.toLowerCase());
      return wanted.has(row.result.toLowerCase()) ? [addresses[index]] : [];
    });
  }, warn)).flat();
  return (await limited(relevant, async address => {
    const info = await reader.vault(address), rates = await reader.interest(address);
    const hooks = await client.readContract({ address, abi: eulerVaultAbi, functionName: 'hookConfig', blockNumber: block });
    const results = [];
    for (const target of targets) {
      if (!target.borrowed) {
        if (!target.supplies.includes(info.asset.toLowerCase()) || (hooks[1] & 1) !== 0) continue;
        if (rates.supplyRate.apr === null) { warn('Some Euler supply APRs are unavailable.'); continue; }
        const caps = await client.readContract({ address, abi: eulerVaultAbi, functionName: 'caps', blockNumber: block });
        const cap = resolveEulerCap(caps[0]);
        if (cap !== null && rates.cash !== null && rates.borrowed !== null && cap <= rates.cash + rates.borrowed) continue;
        const candidate = option(target, 'Euler', network, block, address, info.name, rates.supplyRate.apr, null, null, 'Euler V2 EVK direct vault deposit. APR is current interest after the vault fee; custom deposit hooks and exhausted caps are excluded.');
        candidate.url = `https://app.euler.finance/vault/${address}?network=${network}`; results.push(candidate); continue;
      }
      if (!target.borrows.includes(info.asset.toLowerCase()) || (hooks[1] & (1 << 6)) !== 0) continue;
      if (rates.borrowRate.apr === null) { warn('Some Euler borrow APRs are unavailable.'); continue; }
      const collateral = await client.readContract({ address, abi: eulerVaultAbi, functionName: 'LTVList', blockNumber: block });
      const liquidity = await reader.liquidity(address);
      const rows = await limited([...collateral], async raw => {
        const collateralAddress = eulerAddress(raw);
        const underlying = assetsByVault.get(collateralAddress.toLowerCase());
        if (underlying && !target.supplies.includes(underlying)) return [];
        const collateralInfo = await reader.vault(collateralAddress);
        if (!target.supplies.includes(collateralInfo.asset.toLowerCase())) return [];
        const [borrowLtv, liquidationLtv, collateralRate, collateralHooks] = await Promise.all([
          client.readContract({ address, abi: eulerVaultAbi, functionName: 'LTVBorrow', args: [collateralAddress], blockNumber: block }),
          client.readContract({ address, abi: eulerVaultAbi, functionName: 'LTVLiquidation', args: [collateralAddress], blockNumber: block }),
          reader.interest(collateralAddress),
          client.readContract({ address: collateralAddress, abi: eulerVaultAbi, functionName: 'hookConfig', blockNumber: block }),
        ]);
        if (borrowLtv === 0 || liquidationLtv > 10000 || (collateralHooks[1] & 1) !== 0) return [];
        if (collateralRate.supplyRate.apr === null) { warn('Some Euler collateral lending APRs are unavailable.'); return []; }
        return [{ ...option(target, 'Euler', network, block, address, `${info.name} · collateral ${collateralInfo.name}`, collateralRate.supplyRate.apr, rates.borrowRate.apr!, liquidationLtv / 10000, 'Euler V2 isolated debt vault with the listed receipt vault accepted as collateral. Current liquidation LTV may ramp over time. External incentives and custom borrow/deposit hooks are excluded.'), route: collateralAddress.toLowerCase(), liquidity, url: `https://app.euler.finance/vault/${address}?network=${network}` }];
      }, warn);
      results.push(...rows.flat());
    }
    return results;
  }, warn)).flat();
};
