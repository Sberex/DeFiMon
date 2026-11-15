import { isAddress, type Address, type Hex } from 'viem';
import { createMorphoQuery } from './morpho-api.js';
import { createMorphoRates } from './morpho-rates.js';
import { morphoFactoryAbi } from './abis/morpho.js';
import { networks } from './networks.js';
import { limited, option, type Reader } from './market-readers.js';
type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid metadata'); return value as Obj; };
export const readMorphoMarkets: Reader = async (client, network, block, targets, warn) => {
  const warnings = new Set<string>();
  const query = createMorphoQuery(fetch, network, warnings);
  const rates = createMorphoRates(client, block, networks[network].morphoBlue!);
  async function pages(field: string, filters: string, fields: string): Promise<Obj[]> {
    const rows: Obj[] = [], seen = new Set<string>();
    for (let skip = 0; skip < 500; skip += 100) {
      const data = await query(`query MarketAlternatives { ${field}(first:100,skip:${skip},where:{chainId_in:[1],${filters}}){items{${fields}} pageInfo{count countTotal skip limit}}}`, {});
      const connection = object(data[field]), info = object(connection.pageInfo);
      if (!Array.isArray(connection.items) || info.skip !== skip || info.count !== connection.items.length || !Number.isSafeInteger(info.countTotal) || Number(info.countTotal) < skip + connection.items.length) throw new Error('Incomplete pagination');
      for (const value of connection.items) {
        const row = object(value), key = String(row.address ?? row.uniqueKey).toLowerCase();
        if (seen.has(key)) { warn('Morpho returned duplicate discovery rows. Search coverage is incomplete.'); continue; }
        seen.add(key); rows.push(row);
      }
      if (skip + connection.items.length >= Number(info.countTotal)) return rows;
      if (!connection.items.length) throw new Error('No pagination progress');
    }
    warn('Morpho search reached its 500-record limit. More alternatives may exist.'); return rows;
  }
  const results = await limited(targets, async target => {
    const supplyList = JSON.stringify(target.supplies), borrowList = JSON.stringify(target.borrows);
    const filters = target.borrowed ? `collateralAssetAddress_in:${supplyList},loanAssetAddress_in:${borrowList}` : `loanAssetAddress_in:${supplyList}`;
    let records: Obj[] = [];
    try { records = await pages('markets', filters, 'uniqueKey: marketId'); } catch { warn('Morpho direct-market discovery was unavailable.'); }
    const markets = await limited(records, async row => {
      if (typeof row.uniqueKey !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(row.uniqueKey)) throw new Error('Invalid ID');
      const entry = await rates.marketQuote(row.uniqueKey as Hex);
      if (target.borrowed) {
        if (!target.supplies.includes(entry.params.collateralToken.toLowerCase()) || !target.borrows.includes(entry.params.loanToken.toLowerCase()) || entry.params.lltv === 0n || entry.state.totalSupplyAssets <= entry.state.totalBorrowAssets || entry.borrowApr === null) return [];
        return [option(target, 'Morpho', network, block, row.uniqueKey, `Blue market ${row.uniqueKey.slice(0, 10)}…`, 0, entry.borrowApr, Number(entry.params.lltv) / 1e18, 'Isolated collateral earns no protocol lending interest. Instant IRM rate after simulated accrual; excludes reward-token incentives.')];
      }
      if (!target.supplies.includes(entry.params.loanToken.toLowerCase())) return [];
      return [option(target, 'Morpho', network, block, row.uniqueKey, `Blue lending market ${row.uniqueKey.slice(0, 10)}…`, entry.apr, null, null, 'Direct lending into one isolated market, not a diversified vault. Rate excludes reward-token incentives.')];
    }, warn);
    const vaultResults = target.borrowed ? [] : await Promise.allSettled(([1, 2] as const).map(async version => {
      const vaults = await pages(version === 1 ? 'vaults' : 'vaultV2s', `assetAddress_in:${supplyList}`, 'address name asset{address} factory{address}');
      return (await limited(vaults, async row => {
        const address = row.address, asset = object(row.asset).address, factory = object(row.factory).address;
        if (typeof address !== 'string' || !isAddress(address, { strict: false }) || typeof factory !== 'string' || !isAddress(factory, { strict: false }) || typeof asset !== 'string' || !target.supplies.includes(asset.toLowerCase())) throw new Error('Invalid vault');
        const registered = await client.readContract({ address: factory as Address, abi: morphoFactoryAbi, functionName: version === 1 ? 'isMetaMorpho' : 'isVaultV2', args: [address as Address], blockNumber: block });
        if (!registered) throw new Error('Unregistered vault');
        const rate = await rates.vault(address as Address, version, asset as Address);
        if (rate.apr === null) { warn('Some Morpho vault allocation rates are unavailable.'); return []; }
        const candidate = option(target, 'Morpho', network, block, address, `Vault V${version} · ${typeof row.name === 'string' ? row.name.slice(0, 160) : address}`, rate.apr, null, null, 'Current allocation-weighted APR after vault fees. Deposit caps and access restrictions must be checked.');
        candidate.url = `https://app.morpho.org/${network}/vault/${address}`;
        return [candidate];
      }, warn)).flat();
    }));
    for (const result of vaultResults) if (result.status === 'rejected') warn('A Morpho vault-version search was unavailable. Other verified markets remain visible.');
    return [...markets.flat(), ...vaultResults.flatMap(r => r.status === 'fulfilled' ? r.value : [])];
  }, warn);
  warnings.forEach(warn);
  return results.flat();
};
