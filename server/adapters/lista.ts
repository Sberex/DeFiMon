import type { Address } from 'viem';
import type { NetworkId, ProtocolResult } from '../../src/types.js';
import type { ChainClient } from '../rpc.js';
import { readMorpho } from './morpho.js';
import { listaDiscovery, listaNote, listaRate } from '../lista.js';
import { listaDeployments, listaLegacyVaults, LISTA_COVERAGE } from '../deployments/lista.js';
export async function readLista(client: ChainClient, wallet: Address, block: bigint, network: NetworkId, discover = () => listaDiscovery(client, wallet, block, network)): Promise<ProtocolResult> {
  const deployment = listaDeployments[network]; if (!deployment) throw new Error('Unsupported Lista network');
  const result = await readMorpho(client, wallet, block, discover, network, { core: deployment.core, family: 'lista', legacyVaults: listaLegacyVaults[network] });
  return { ...result, id: 'lista', name: 'Lista DAO', coverage: LISTA_COVERAGE, message: result.message && listaNote(result.message), positions: result.positions.map(p => ({ ...p, id: p.id.replace(/^morpho-/, 'lista-'), depositOnly: !!p.vault || p.morphoMarket?.supplyOnly, receiptTokens: p.vault ? [p.vault.address] : p.receiptTokens, label: listaNote(p.label), notes: p.notes.filter(n => !n.includes('Creator roles')).map(listaNote), assets: p.assets.map(a => ({ ...a, supplyRate: listaRate(a.supplyRate), borrowRate: listaRate(a.borrowRate) })) })) };
}
