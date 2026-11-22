import type { Address } from 'viem';
import type { NetworkId, ProtocolResult } from '../../src/types.js';
import type { ChainClient } from '../rpc.js';
import { AAVE_HORIZON } from '../deployments/aave-horizon.js';
import { readAave } from './aave.js';

/** Keep Ethereum's main pool and Horizon isolated, at the same snapshot block. */
export async function readAaveV3Markets(client: ChainClient, wallet: Address, block: bigint, network: NetworkId = 'ethereum'): Promise<ProtocolResult> {
  if (network !== 'ethereum') return readAave(client, wallet, block, network);
  const results = await Promise.allSettled([
    readAave(client, wallet, block, network),
    readAave(client, wallet, block, network, AAVE_HORIZON),
  ]);
  const markets = [{ id: 'aave-main', label: 'Ethereum main market' }, { id: 'aave-horizon-main', label: AAVE_HORIZON.label }];
  const failed = results.flatMap((r, i) => r.status === 'rejected' ? [markets[i].label] : []);
  return {
    id: 'aave-v3', name: 'Aave v3', status: failed.length === 2 ? 'error' : failed.length ? 'partial' : 'ok',
    coverage: 'Ethereum main market and Aave Horizon; excludes other Aave markets and vaults.',
    balanceDiscoveryComplete: failed.length === 0,
    message: failed.length ? `${failed.join(' and ')} could not be checked. Its balances and interest remain unknown. Refresh to retry.` : undefined,
    positions: results.flatMap((r, i) => r.status === 'fulfilled' ? r.value.positions : [{
      id: markets[i].id, label: markets[i].label, assets: [], notes: ['This Aave market could not be checked. Balances and interest are unknown, not zero.'],
      suppliedUsd: null, debtUsd: null, healthFactor: null, risk: 'unknown' as const,
    }]),
  };
}
