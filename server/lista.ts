import { getAddress, isAddress, parseAbi, type Address, type Hex } from 'viem';
import type { NetworkId, InterestRate } from '../src/types.js';
import { listaDeployments } from './deployments/lista.js';
import { morphoCoreAbi, morphoVaultAbi } from './abis/morpho.js';
import type { ChainClient } from './rpc.js';
import { tokenMetadata } from './market-liquidity.js';
import { walletPrices } from './wallet-prices.js';
import type { MorphoDiscovery, MorphoToken } from './morpho-discovery.js';
export const LISTA_API = 'https://api.lista.org';
export interface ListaCatalog { markets: Hex[]; vaults: { address: Address; name: string; asset: Address }[] }
const zero = /^0x0{40}$/i;
const brokerAbi = parseAbi(['function brokers(bytes32) view returns(address)']);
function address(value: unknown): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false }) || zero.test(value)) throw new Error('Invalid Lista address');
  return getAddress(value.toLowerCase());
}
export const listaNote = (text: string) => text.replaceAll('Morpho', 'Lista DAO Moolah').replace('from Lista DAO Moolah’s lookup service', 'from independently checked price sources').replace('the Ethereum balances', 'the on-chain balances');
export const listaRate = (quote: InterestRate | undefined) => quote && { ...quote, note: listaNote(quote.note) };
/** Public catalogs discover identities only; API balances/APYs never replace on-chain accounting. */
export function createListaCatalog(fetcher: typeof fetch = fetch, now = Date.now) {
  const cache = new Map<NetworkId, { expires: number; promise: Promise<ListaCatalog> }>();
  async function pages(network: NetworkId, family: 'markets' | 'vaults') {
    const rows: Record<string, unknown>[] = []; const seen = new Set<string>(); let total = -1;
    for (let page = 1; page <= 40; page++) {
      const path = family === 'markets' ? 'borrow/markets' : 'vault/list';
      const response = await fetcher(`${LISTA_API}/api/moolah/${path}?chain=${network}&page=${page}&pageSize=50`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Lista catalog unavailable');
      const body = await response.text(); if (body.length > 3_000_000) throw new Error('Lista catalog too large');
      const json = JSON.parse(body), data = json?.data;
      if (json?.code !== '000000000' || !Number.isInteger(data?.total) || data.total < 0 || data.total > 2000 || !Array.isArray(data.list)) throw new Error('Invalid Lista catalog');
      if (total === -1) total = data.total;
      if (data.total !== total || data.list.length !== Math.min(50, total - rows.length)) throw new Error('Incomplete Lista catalog');
      for (const row of data.list) {
        if (!row || row.chain !== network) throw new Error('Wrong Lista network');
        const key = family === 'markets' ? row.id : row.address;
        if (typeof key !== 'string' || !(family === 'markets' ? /^0x[0-9a-f]{64}$/i.test(key) : isAddress(key, { strict: false }) && !zero.test(key)) || seen.has(key.toLowerCase())) throw new Error('Invalid or duplicate Lista identity');
        seen.add(key.toLowerCase()); rows.push(row);
      }
      if (rows.length === total) return rows;
    }
    throw new Error('Lista catalog discovery limit');
  }
  return (network: NetworkId): Promise<ListaCatalog> => {
    if (!listaDeployments[network]) return Promise.reject(new Error('Unsupported Lista network'));
    const old = cache.get(network); if (old && old.expires > now()) return old.promise;
    const promise = Promise.all([pages(network, 'markets'), pages(network, 'vaults')]).then(([markets, vaults]) => ({ markets: markets.map(m => m.id as Hex), vaults: vaults.map(v => {
      if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 256) throw new Error('Invalid Lista vault name');
      return { address: address(v.address), asset: address(v.asset), name: v.name };
    }) }));
    const entry = { expires: now() + 300000, promise }; cache.set(network, entry);
    void promise.catch(() => { if (cache.get(network) === entry) cache.delete(network); });
    return promise;
  };
}
export const listaCatalog = createListaCatalog();
export async function listaDiscovery(client: ChainClient, wallet: Address, block: bigint, network: NetworkId, catalog = listaCatalog): Promise<MorphoDiscovery> {
  const deployment = listaDeployments[network]; if (!deployment) throw new Error('Unsupported Lista network');
  const listed = await catalog(network), warnings = new Set<string>(); let complete = true;
  const [positions, balances] = await Promise.all([
    listed.markets.length ? client.multicall({ contracts: listed.markets.map(id => ({ address: deployment.core, abi: morphoCoreAbi, functionName: 'position' as const, args: [id, wallet] as const })), blockNumber: block, allowFailure: true, batchSize: 8192 }) : [],
    listed.vaults.length ? client.multicall({ contracts: listed.vaults.map(v => ({ address: v.address, abi: morphoVaultAbi, functionName: 'balanceOf' as const, args: [wallet] as const })), blockNumber: block, allowFailure: true, batchSize: 8192 }) : [],
  ]);
  if (positions.length !== listed.markets.length || balances.length !== listed.vaults.length) throw new Error('Incomplete Lista balances');
  const markets: MorphoDiscovery['markets'] = [], vaults: MorphoDiscovery['vaults'] = [];
  const metadata = new Map<string, Promise<MorphoToken>>();
  function token(address: Address) {
    const key = address.toLowerCase(); if (!metadata.has(key)) metadata.set(key, (async () => {
      const info = await tokenMetadata(client, address, block); if (info.decimals > 36 || !info.symbol || info.symbol.length > 128) throw new Error('Invalid Lista token');
      const prices = await walletPrices(client, network, block, [{ address, decimals: info.decimals }]);
      return { address, ...info, priceUsd: prices.get(key) ?? null };
    })()); return metadata.get(key)!;
  }
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (p.status !== 'success') { complete = false; warnings.add('Some Lista market balances could not be checked. Holdings remain unknown.'); continue; }
    if (p.result.supplyShares === 0n && p.result.borrowShares === 0n && p.result.collateral === 0n) continue;
    try {
      const params = await client.readContract({ address: deployment.core, abi: morphoCoreAbi, functionName: 'idToMarketParams', args: [listed.markets[i]], blockNumber: block });
      if (p.result.borrowShares > 0n) {
        const broker = await client.readContract({ address: deployment.core, abi: brokerAbi, functionName: 'brokers', args: [listed.markets[i]], blockNumber: block });
        if (!zero.test(broker)) { complete = false; warnings.add('A Lista broker-managed loan was found. Its extra broker interest cannot be verified by the direct-market reader; debt and NPL remain incomplete.'); continue; }
      }
      markets.push({ id: listed.markets[i], loan: await token(params.loanToken), collateral: zero.test(params.collateralToken) ? null : await token(params.collateralToken) });
    } catch { complete = false; warnings.add('A held Lista market identity or token could not be verified. Its value is unknown.'); }
  }
  for (let i = 0; i < balances.length; i++) {
    const b = balances[i], v = listed.vaults[i];
    // Keep an unreadable holding in the adapter so its receipt remains excluded from wallet totals.
    if (b.status !== 'success') { complete = false; warnings.add('Some Lista vault balances could not be checked. Holdings remain unknown.'); }
    if (b.status === 'success' && b.result === 0n) continue;
    try { vaults.push({ ...v, version: 1, factory: deployment.factory, asset: await token(v.asset) }); }
    catch { complete = false; warnings.add('A held Lista vault underlying could not be verified. Its value is unknown.'); }
  }
  return { markets, vaults, warnings: [...warnings], holdingsComplete: complete, successfulFamilies: 2 };
}
