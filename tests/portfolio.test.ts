import { beforeEach, expect, it, vi } from 'vitest';
const readers = vi.hoisted(() => ({ aave: vi.fn(), aaveV4: vi.fn(), compound: vi.fn(), fluid: vi.fn() }));
vi.mock('../server/rpc', () => ({ makeClient: () => ({ getChainId: async () => 1, getBlockNumber: async () => 456n }) }));
vi.mock('../server/adapters/aave', () => ({ readAave: readers.aave }));
vi.mock('../server/adapters/aave-v4', () => ({ readAaveV4: readers.aaveV4, AAVE_V4_COVERAGE: 'V4 lending and tokenized deposits' }));
vi.mock('../server/adapters/compound', () => ({ readCompound: readers.compound }));
vi.mock('../server/adapters/fluid', () => ({ readFluid: readers.fluid, FLUID_COVERAGE: 'Fluid vaults and lending' }));
import { getPortfolio } from '../server/portfolio';
const wallet = '0x1111111111111111111111111111111111111111';
beforeEach(() => {
  readers.aave.mockReset().mockResolvedValue({ id: 'aave-v3', name: 'Aave v3', status: 'ok', positions: [] });
  readers.aaveV4.mockReset().mockResolvedValue({ id: 'aave-v4', name: 'Aave v4', status: 'ok', positions: [] });
  readers.compound.mockReset().mockResolvedValue({ id: 'compound', name: 'Compound', status: 'ok', positions: [] });
  readers.fluid.mockReset().mockResolvedValue({ id: 'fluid', name: 'Fluid', status: 'ok', positions: [] });
});
it('includes the live Fluid reader at the same wallet and block as other protocols', async () => {
  const result = await getPortfolio(wallet);
  expect(readers.fluid).toHaveBeenCalledWith(expect.anything(), wallet, 456n);
  expect(result.protocols.map(p => p.id)).toEqual(['aave-v3', 'aave-v4', 'morpho', 'compound', 'fluid']);
  expect(result.protocols.find(p => p.id === 'fluid')?.status).toBe('ok');
  expect(result.protocols.filter(p => p.status === 'not-integrated')).toHaveLength(1);
  expect(readers.aaveV4).toHaveBeenCalledWith(expect.anything(), wallet, 456n);
});
it('isolates Fluid discovery failure without losing other protocols or exposing provider details', async () => {
  readers.fluid.mockRejectedValueOnce(new Error('secret-provider-key'));
  const result = await getPortfolio(wallet);
  expect(result.protocols.find(p => p.id === 'fluid')?.status).toBe('error');
  expect(result.protocols.find(p => p.id === 'aave-v3')?.status).toBe('ok');
  expect(JSON.stringify(result)).not.toContain('secret-provider-key');
});

it('isolates Aave v4 failures without marking unknown positions as empty or losing Fluid', async () => {
  readers.aaveV4.mockRejectedValueOnce(new Error('private-rpc-key'));
  const result = await getPortfolio(wallet);
  expect(result.protocols.find(p => p.id === 'aave-v4')?.status).toBe('error');
  expect(result.protocols.find(p => p.id === 'fluid')?.status).toBe('ok');
  expect(JSON.stringify(result)).not.toContain('private-rpc-key');
});
