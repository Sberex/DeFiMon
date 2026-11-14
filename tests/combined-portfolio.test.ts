import { expect, it } from 'vitest';
import { getCombinedPortfolio } from '../server/portfolio';
import { example } from '../src/example';
import { networks } from '../server/networks';
import type { NetworkId, Portfolio } from '../src/types';
const wallet = example.address as `0x${string}`;
function snapshot(network: NetworkId): Portfolio {
  return { ...structuredClone(example), chain: networks[network].name, blockNumber: network === 'ethereum' ? '101' : network === 'plasma' ? '202' : '303', updatedAt: network === 'ethereum' ? '2026-11-13T12:00:01Z' : network === 'plasma' ? '2026-11-13T12:00:02Z' : '2026-11-13T12:00:03Z',
    protocols: structuredClone(example.protocols.filter(p => networks[network].protocolIds.includes(p.id))) };
}
it('groups Ethereum then Plasma for each protocol, retaining each network’s block and independent positions', async () => {
  const calls: string[] = [];
  const result = await getCombinedPortfolio(wallet, async (address, network) => { expect(address).toBe(wallet); calls.push(network); return snapshot(network); });
  expect(calls).toEqual(['ethereum', 'plasma', 'arbitrum']);
  expect(result.protocols.map(p => `${p.id}:${p.chain}`)).toEqual(['aave-v3:Ethereum', 'aave-v3:Plasma', 'aave-v3:Arbitrum', 'aave-v4:Ethereum', 'morpho:Ethereum', 'morpho:Arbitrum', 'compound:Ethereum', 'compound:Arbitrum', 'fluid:Ethereum', 'fluid:Plasma', 'fluid:Arbitrum']);
  expect(result.networks?.map(n => [n.chain, n.blockNumber, n.updatedAt])).toEqual([['Ethereum', '101', '2026-11-13T12:00:01Z'], ['Plasma', '202', '2026-11-13T12:00:02Z'], ['Arbitrum', '303', '2026-11-13T12:00:03Z']]);
  expect(result.blockNumber).toBeNull();
  expect(result.protocols.filter(p => p.id === 'fluid')).toHaveLength(3);
  expect(result.protocols[0].positions[0].id).toBe(result.protocols[1].positions[0].id); // Identical local IDs must not collapse cross-chain positions.
});
it('retains the other network when either provider fails, without leaking errors or claiming zero balances', async () => {
  for (const failed of ['ethereum', 'plasma', 'arbitrum'] as const) {
    const result = await getCombinedPortfolio(wallet, async (_address, network) => {
      if (network === failed) throw new Error('https://provider/private-api-key');
      return snapshot(network);
    });
    expect(result.protocols).toHaveLength(11);
    const chain = networks[failed].name;
    expect(result.networks?.find(n => n.chain === chain)).toMatchObject({ status: 'error', blockNumber: null });
    expect(result.protocols.filter(p => p.chain === chain).every(p => p.status === 'error' && p.message?.includes('unknown'))).toBe(true);
    expect(result.protocols.filter(p => p.chain !== chain).every(p => p.status === 'ok' && p.positions.length > 0)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-api-key');
  }
});
it('shows all eleven readers as unknown if no network can be read', async () => {
  const result = await getCombinedPortfolio(wallet, async () => { throw new Error('secret'); });
  expect(result.networks?.every(n => n.status === 'error')).toBe(true);
  expect(result.protocols).toHaveLength(11);
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
    data.wallets = [{ chain: networks[network].name, status: 'ok', tokens: [], pricedValueUsd: network === 'plasma' ? 2 : 100, unpricedCount: 0, coverage: 'test' }];
    return data;
  }, watched);
  expect(result.wallets?.map(w => [w.chain, w.pricedValueUsd])).toEqual([['Ethereum', 100], ['Plasma', 2], ['Arbitrum', 100]]);
});
