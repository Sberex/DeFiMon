import type { ComparisonTarget, MarketSearch } from '../src/market-comparison.js';
import { networkOrder } from '../src/networks.js';
import type { NetworkId } from '../src/types.js';
import { resolveTokenMatches } from './token-discovery.js';
import { networks } from './networks.js';
import { makeClient, type ChainClient } from './rpc.js';
import { expandTargets, readAaveMarkets, readCompoundMarkets, type Reader } from './market-readers.js';
import { readV4Markets } from './market-v4.js';
import { readFluidMarkets } from './market-fluid.js';
import { readMorphoMarkets } from './market-morpho.js';
const readers: Record<string, { name: string; read: Reader }> = {
 'aave-v3': { name: 'Aave v3', read: readAaveMarkets }, 'aave-v4': { name: 'Aave v4', read: readV4Markets },
 compound: { name: 'Compound', read: readCompoundMarkets }, morpho: { name: 'Morpho', read: readMorphoMarkets }, fluid: { name: 'Fluid', read: readFluidMarkets },
};
export async function searchMarkets(targets: ComparisonTarget[], clientFor: (network: NetworkId) => ChainClient = makeClient, sources = readers, discover = resolveTokenMatches): Promise<MarketSearch> {
  const tokenMatches = await discover(targets);
  const results = await Promise.all(networkOrder.map(async network => {
    const coverage: MarketSearch['coverage'] = [], alternatives: MarketSearch['alternatives'] = [];
    const expanded = expandTargets(targets, network, tokenMatches.matches);
    if (!expanded.length) return { coverage, alternatives };
    try {
      const client = clientFor(network);
      const [chain, block] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
      if (chain !== networks[network].id) throw new Error('Wrong network');
      await Promise.all(networks[network].protocolIds.map(async id => {
        const source = sources[id]; const warnings = new Set<string>();
        try {
          const rows = await source.read(client, network, block, expanded, message => warnings.add(message));
          alternatives.push(...rows.filter(row => Number.isFinite(row.supplyApr) && (row.borrowApr === null || Number.isFinite(row.borrowApr))));
          coverage.push({ protocol: source.name, network, status: warnings.size ? 'partial' : 'ok', message: warnings.size ? [...warnings].join(' ') : undefined });
        } catch { coverage.push({ protocol: source.name, network, status: 'error', message: 'Market search could not reach or verify this source. More alternatives may exist.' }); }
      }));
    } catch {
      networks[network].protocolIds.forEach(id => coverage.push({ protocol: sources[id].name, network, status: 'error', message: 'Network provider unavailable. These markets were not searched.' }));
    }
    return { coverage, alternatives };
  }));
  return { tokenDiscovery: tokenMatches.reports, targetIds: targets.map(t => t.id), checkedAt: new Date().toISOString(), alternatives: results.flatMap(r => r.alternatives), coverage: results.flatMap(r => r.coverage) };
}
