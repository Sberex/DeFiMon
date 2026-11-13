import { expect, it } from 'vitest';
import { getCombinedPortfolio } from '../server/portfolio';
import { example } from '../src/example';
import type { NetworkId, Portfolio } from '../src/types';
const wallet = example.address as `0x${string}`;
function snapshot(network: NetworkId): Portfolio {
  const plasma = network === 'plasma';
  return { ...structuredClone(example), chain: plasma ? 'Plasma' : 'Ethereum', blockNumber: plasma ? '202' : '101', updatedAt: plasma ? '2026-11-13T12:00:02Z' : '2026-11-13T12:00:01Z',
    protocols: structuredClone(example.protocols.filter(p => !plasma || p.id === 'aave-v3' || p.id === 'fluid')) };
}
it('groups Ethereum then Plasma for each protocol, retaining each network’s block and independent positions', async () => {
  const calls: string[] = [];
  const result = await getCombinedPortfolio(wallet, async (address, network) => { expect(address).toBe(wallet); calls.push(network); return snapshot(network); });
  expect(calls).toEqual(['ethereum', 'plasma']);
  expect(result.protocols.map(p => `${p.id}:${p.chain}`)).toEqual(['aave-v3:Ethereum', 'aave-v3:Plasma', 'aave-v4:Ethereum', 'morpho:Ethereum', 'compound:Ethereum', 'fluid:Ethereum', 'fluid:Plasma']);
  expect(result.networks?.map(n => [n.chain, n.blockNumber, n.updatedAt])).toEqual([['Ethereum', '101', '2026-11-13T12:00:01Z'], ['Plasma', '202', '2026-11-13T12:00:02Z']]);
  expect(result.blockNumber).toBeNull();
  expect(result.protocols.filter(p => p.id === 'fluid')).toHaveLength(2);
  expect(result.protocols[0].positions[0].id).toBe(result.protocols[1].positions[0].id); // Identical local IDs must not collapse cross-chain positions.
});
it('retains the other network when either provider fails, without leaking errors or claiming zero balances', async () => {
  for (const failed of ['ethereum', 'plasma'] as const) {
    const result = await getCombinedPortfolio(wallet, async (_address, network) => {
      if (network === failed) throw new Error('https://provider/private-api-key');
      return snapshot(network);
    });
    expect(result.protocols).toHaveLength(7);
    const chain = failed === 'plasma' ? 'Plasma' : 'Ethereum';
    expect(result.networks?.find(n => n.chain === chain)).toMatchObject({ status: 'error', blockNumber: null });
    expect(result.protocols.filter(p => p.chain === chain).every(p => p.status === 'error' && p.message?.includes('unknown'))).toBe(true);
    expect(result.protocols.filter(p => p.chain !== chain).every(p => p.status === 'ok' && p.positions.length > 0)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-api-key');
  }
});
it('shows all seven readers as unknown if neither network can be read', async () => {
  const result = await getCombinedPortfolio(wallet, async () => { throw new Error('secret'); });
  expect(result.networks?.every(n => n.status === 'error')).toBe(true);
  expect(result.protocols).toHaveLength(7);
  expect(result.protocols.every(p => p.status === 'error' && p.positions.length === 0)).toBe(true);
  expect(JSON.stringify(result)).not.toContain('secret');
});
it('retains partial Fluid estimates without changing their source or health on merging', async () => {
  const result = await getCombinedPortfolio(wallet, async (_address, network) => {
    const data = snapshot(network);
    if (network === 'plasma') {
      const fluid = data.protocols.find(p => p.id === 'fluid')!;
      fluid.status = 'partial'; fluid.message = 'Oracle estimate'; fluid.positions[0].assets[0].priceSource = 'fluid-oracle';
      fluid.positions[0].healthFactor = 1.02; fluid.positions[0].risk = 'high';
    }
    return data;
  });
  const fluid = result.protocols.find(p => p.id === 'fluid' && p.chain === 'Plasma')!;
  expect(fluid.status).toBe('partial'); expect(fluid.positions[0].healthFactor).toBe(1.02);
  expect(fluid.positions[0].assets[0].priceSource).toBe('fluid-oracle');
});

it('preserves separate network wallet values and forwards added token contracts to both readers', async () => {
  const watched = { plasma: ['0x2222222222222222222222222222222222222222'] };
  const result = await getCombinedPortfolio(wallet, async (_address, network, extra) => {
    expect(extra).toEqual(watched);
    const data = snapshot(network);
    data.wallets = [{ chain: network === 'plasma' ? 'Plasma' : 'Ethereum', status: 'ok', tokens: [], pricedValueUsd: network === 'plasma' ? 2 : 100, unpricedCount: 0, coverage: 'test' }];
    return data;
  }, watched);
  expect(result.wallets?.map(w => [w.chain, w.pricedValueUsd])).toEqual([['Ethereum', 100], ['Plasma', 2]]);
});
