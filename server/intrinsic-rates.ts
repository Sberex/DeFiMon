import { savingsGroup, savingsRateService } from './savings-rates.js';
import type { Address } from 'viem';
import type { IntrinsicRate, NetworkId, ProtocolResult } from '../src/types.js';
import type { ChainClient } from './rpc.js';
import { networkNames } from '../src/networks.js';
import { configuredTokenRegistry } from './token-registry.js';
import { readOracleRoundRate } from './oracle-rounds.js';
export const SUSDAI = '0x0b2b2b2076d95dda7817e785989fe353fe955ef9';
const susdaiSource = () => Object.values(configuredTokenRegistry).find(t => t.addresses.ethereum === SUSDAI)?.intrinsicOracles?.[0];
// Compatibility export for diagnostics; the address comes from token-matches.json.
export const SUSDAI_FEED: Address = susdaiSource()?.address ?? '0x0000000000000000000000000000000000000000';
const unavailable = (): IntrinsicRate => ({ apr: null, estimated: true, note: 'The configured sUSDai oracle history could not be verified. Intrinsic earnings are unknown, not zero.', source: { chain: 'Ethereum', oracle: susdaiSource()?.address ?? '', kind: 'unavailable' } });
export async function readSusdaiIntrinsicRate(client: ChainClient, blockNumber: bigint): Promise<IntrinsicRate> {
  const source = susdaiSource();
  return source ? readOracleRoundRate(client, blockNumber, source) : unavailable();
}
export function createSusdaiRateCache(load: () => Promise<IntrinsicRate>, now = Date.now) {
  let cache: { expires: number; promise: Promise<IntrinsicRate> } | undefined;
  return () => {
    if (cache && cache.expires > now()) return cache.promise;
    const entry = { expires: now() + 300000, promise: Promise.resolve().then(load).catch(unavailable) };
    cache = entry;
    entry.promise = entry.promise.then(result => { entry.expires = now() + (result.apr === null ? 60000 : 300000); return result; });
    return entry.promise;
  };
}
export const getSusdaiIntrinsicRate = createSusdaiRateCache(async () => {
  const group = savingsGroup('ethereum', SUSDAI);
  return group ? savingsRateService.quote(group, { network: 'ethereum' }) : unavailable();
});
export async function intrinsicTokenRate(network: NetworkId, address: string, context: { protocol?: string; position?: string } = {}, load = getSusdaiIntrinsicRate, loadSavings = savingsRateService.quote): Promise<IntrinsicRate | undefined> {
  const group = savingsGroup(network, address);
  if (!group) return undefined;
  return address.toLowerCase() === SUSDAI ? load().catch(unavailable) : loadSavings(group, { ...context, network, address }).catch((): IntrinsicRate => ({ apr: null, estimated: true, note: `${group} intrinsic rate history is unavailable. Earnings are unknown, not zero.`, source: { chain: networkNames[network], oracle: '', kind: 'unavailable', label: `${group} rate history unavailable` } }));
}
export async function applyIntrinsicRates(protocols: ProtocolResult[], network: NetworkId, load = getSusdaiIntrinsicRate, loadSavings = savingsRateService.quote): Promise<ProtocolResult[]> {
  const jobs = new Map<string, { protocol: string; position: string; address: string }>();
  for (const p of protocols) for (const position of p.positions) for (const a of position.assets) {
    if (a.supplied <= 0) continue;
    const group = savingsGroup(network, a.address);
    if (group && (!jobs.has(group) || (p.id === 'morpho' && !jobs.get(group)!.position.startsWith('morpho-market-')))) jobs.set(group, { protocol: p.id, position: position.id, address: a.address });
  }
  if (!jobs.size) return protocols;
  const quotes = new Map<string, IntrinsicRate>();
  await Promise.all([...jobs].map(async ([group, context]) => {
    const quote = await intrinsicTokenRate(network, context.address, context, load, loadSavings);
    quotes.set(group, quote!);
  }));
  return protocols.map(p => ({ ...p, positions: p.positions.map(position => ({ ...position, assets: position.assets.map(a => {
    const group = a.supplied > 0 ? savingsGroup(network, a.address) : undefined;
    return group ? { ...a, intrinsicSupplyRate: quotes.get(group)! } : a;
  }) })) }));
}
