import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => ({ chainId: 1 }));
const readers = vi.hoisted(() => ({ curve: vi.fn(), aave: vi.fn(), aaveV4: vi.fn(), morpho: vi.fn(), compound: vi.fn(), fluid: vi.fn(), euler: vi.fn(), spark: vi.fn(), lista: vi.fn() }));
vi.mock('../server/rpc', () => ({ makeClient: () => ({ getChainId: async () => rpc.chainId, getBlockNumber: async () => 456n }) }));
vi.mock('../server/wallet', () => ({ readWallet: async (_client: unknown, _wallet: unknown, _block: unknown, network: string) => ({ chain: network === 'arbitrum' ? 'Arbitrum' : network === 'plasma' ? 'Plasma' : 'Ethereum', status: 'ok', tokens: [], pricedValueUsd: 0, unpricedCount: 0, coverage: 'test' }), unavailableWallet: () => ({ status: 'error' }) }));
vi.mock('../server/adapters/spark', async importOriginal => ({ ...await importOriginal<typeof import('../server/adapters/spark')>(), readSpark: readers.spark }));
vi.mock('../server/adapters/curve-llamalend', () => ({ readCurveLlamalend: readers.curve }));
vi.mock('../server/adapters/lista', () => ({ readLista: readers.lista }));
vi.mock('../server/adapters/euler', () => ({ readEuler: readers.euler }));
vi.mock('../server/adapters/aave', () => ({ readAave: readers.aave }));
vi.mock('../server/adapters/aave-v4', () => ({ readAaveV4: readers.aaveV4, AAVE_V4_COVERAGE: 'V4 lending and tokenized deposits' }));
vi.mock('../server/adapters/morpho', () => ({ readMorpho: readers.morpho, MORPHO_COVERAGE: 'Ethereum markets and vaults' }));
vi.mock('../server/adapters/compound', () => ({ readCompound: readers.compound }));
vi.mock('../server/adapters/fluid', () => ({ readFluid: readers.fluid, FLUID_COVERAGE: 'Fluid vaults and lending' }));
vi.mock('../server/pendle', async importOriginal => { const actual = await importOriginal<typeof import('../server/pendle')>(); return { ...actual, readPendle: vi.fn(async () => ({ tokens: [], coverage: { status: 'ok', coverage: 'Pendle test', marketCount: 0, blockNumber: '456' } })) }; });
import { getPortfolio } from '../server/portfolio';
import { readPendle } from '../server/pendle';
const wallet = '0x1111111111111111111111111111111111111111';
beforeEach(() => {
  rpc.chainId = 1;
  readers.curve.mockReset().mockResolvedValue({ id:'curve-llamalend',name:'Curve LlamaLend',status:'ok',positions:[] });
  readers.lista.mockReset().mockResolvedValue({ id: 'lista', name: 'Lista DAO', status: 'ok', positions: [] });
  readers.spark.mockReset().mockResolvedValue({ id: 'spark', name: 'Spark', status: 'ok', positions: [] });
  readers.aave.mockReset().mockResolvedValue({ id: 'aave-v3', name: 'Aave v3', status: 'ok', positions: [] });
  readers.aaveV4.mockReset().mockResolvedValue({ id: 'aave-v4', name: 'Aave v4', status: 'ok', positions: [] });
  readers.morpho.mockReset().mockResolvedValue({ id: 'morpho', name: 'Morpho', status: 'ok', positions: [] });
  readers.compound.mockReset().mockResolvedValue({ id: 'compound', name: 'Compound', status: 'ok', positions: [] });
  readers.euler.mockReset().mockResolvedValue({ id: 'euler', name: 'Euler', status: 'ok', positions: [] });
  readers.fluid.mockReset().mockResolvedValue({ id: 'fluid', name: 'Fluid', status: 'ok', positions: [] });
});
it('includes the live Fluid reader at the same wallet and block as other protocols', async () => {
  const result = await getPortfolio(wallet);
  expect(readers.curve).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'ethereum');
  expect(readers.fluid).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'ethereum');
  expect(readPendle).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'ethereum');
  expect(result.protocols.map(p => p.id)).toEqual(['aave-v3', 'aave-v4', 'morpho', 'compound', 'fluid', 'euler', 'spark', 'lista', 'curve-llamalend']);
  expect(result.protocols.find(p => p.id === 'fluid')?.status).toBe('ok');
  expect(result.protocols.filter(p => p.status === 'not-integrated')).toHaveLength(0);
  expect(readers.aaveV4).toHaveBeenCalledWith(expect.anything(), wallet, 456n, expect.objectContaining({spokes:expect.any(Array),tokenizations:expect.any(Array)}));
  expect(readers.morpho).toHaveBeenCalledWith(expect.anything(), wallet, 456n, undefined, 'ethereum');
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

it('isolates unavailable Morpho discovery without losing other protocol balances or claiming zero positions', async () => {
  readers.morpho.mockRejectedValueOnce(new Error('private-provider-details'));
  const result = await getPortfolio(wallet);
  const morpho = result.protocols.find(p => p.id === 'morpho')!;
  expect(morpho.status).toBe('error'); expect(morpho.message).toContain('api.morpho.org');
  expect(result.protocols.find(p => p.id === 'fluid')?.status).toBe('ok');
  expect(JSON.stringify(result)).not.toContain('private-provider-details');
});

it('reads Aave v3, Fluid and Euler on Plasma at the same Plasma block', async () => {
  rpc.chainId = 9745;
  const result = await getPortfolio(wallet, 'plasma');
  expect(result.chain).toBe('Plasma');
  expect(readPendle).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'plasma');
  expect(result.protocols.map(p => p.id)).toEqual(['aave-v3', 'fluid', 'euler']);
  expect(readers.aave).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'plasma');
  expect(readers.fluid).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'plasma');
  expect(readers.aaveV4).not.toHaveBeenCalled(); expect(readers.morpho).not.toHaveBeenCalled(); expect(readers.compound).not.toHaveBeenCalled();
});
it('rejects an Ethereum provider configured for Plasma before any protocol reads', async () => {
  await expect(getPortfolio(wallet, 'plasma')).rejects.toThrow('not Plasma mainnet');
  expect(readers.aave).not.toHaveBeenCalled(); expect(readers.fluid).not.toHaveBeenCalled();
});
it('keeps Plasma Aave results when Fluid fails, with a safe Plasma-specific error', async () => {
  rpc.chainId = 9745; readers.fluid.mockRejectedValueOnce(new Error('private-provider-key'));
  const result = await getPortfolio(wallet, 'plasma');
  expect(result.protocols[0].status).toBe('ok'); expect(result.protocols[1].status).toBe('error');
  expect(result.protocols[1].message).toContain('Plasma'); expect(JSON.stringify(result)).not.toContain('private-provider-key');
});

it('reads the five supported Arbitrum protocols at one block and skips Aave v4', async () => {
  rpc.chainId = 42161;
  const result = await getPortfolio(wallet, 'arbitrum');
  expect(result.chain).toBe('Arbitrum');
  expect(readPendle).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'arbitrum');
  expect(result.protocols.map(p => p.id)).toEqual(['aave-v3', 'morpho', 'compound', 'fluid', 'euler', 'spark', 'curve-llamalend']);
  expect(readers.aave).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'arbitrum');
  expect(readers.morpho).toHaveBeenCalledWith(expect.anything(), wallet, 456n, undefined, 'arbitrum');
  expect(readers.compound).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'arbitrum');
  expect(readers.fluid).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'arbitrum');
  expect(readers.aaveV4).not.toHaveBeenCalled();
});
it('rejects a provider on the wrong chain before attempting Arbitrum reads', async () => {
  await expect(getPortfolio(wallet, 'arbitrum')).rejects.toThrow('not Arbitrum mainnet');
  expect(readers.aave).not.toHaveBeenCalled(); expect(readers.fluid).not.toHaveBeenCalled();
});

it('routes all five Base readers to the same Base wallet and block, excluding Ethereum-only Aave v4', async () => {
  rpc.chainId = 8453;
  const result = await getPortfolio(wallet, 'base');
  expect(result.chain).toBe('Base');
  expect(readPendle).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'base');
  expect(result.protocols.map(p => p.id)).toEqual(['aave-v3', 'morpho', 'compound', 'fluid', 'euler', 'spark']);
  for (const reader of [readers.aave, readers.compound, readers.fluid, readers.euler]) expect(reader).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'base');
  expect(readers.morpho).toHaveBeenCalledWith(expect.anything(), wallet, 456n, undefined, 'base');
  expect(readers.aaveV4).not.toHaveBeenCalled();
});

it('routes BSC Aave, Fluid, Euler and Pendle reads to the same BSC block', async () => {
  rpc.chainId = 56;
  const result = await getPortfolio(wallet, 'bsc');
  expect(result.chain).toBe('Binance Smart Chain');
  expect(result.protocols.map(p => p.id)).toEqual(['aave-v3', 'fluid', 'euler', 'lista']);
  expect(readers.lista).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'bsc');
  for (const reader of [readers.aave, readers.fluid, readers.euler]) expect(reader).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'bsc');
  expect(readers.morpho).not.toHaveBeenCalled();
  expect(readPendle).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'bsc');
  expect(readers.aaveV4).not.toHaveBeenCalled(); expect(readers.compound).not.toHaveBeenCalled();
});
it('rejects a non-BSC provider before any BSC balances or positions are read', async () => {
  await expect(getPortfolio(wallet, 'bsc')).rejects.toThrow('not Binance Smart Chain mainnet');
  expect(readers.aave).not.toHaveBeenCalled(); expect(readers.fluid).not.toHaveBeenCalled();
});

it('includes the Horizon deployment when checking Ethereum Aave positions', async () => {
  const { AAVE_HORIZON } = await import('../server/deployments/aave-horizon');
  await getPortfolio(wallet);
  expect(readers.aave).toHaveBeenCalledWith(expect.anything(), wallet, 456n, 'ethereum', AAVE_HORIZON);
});

it('isolates Curve failures while retaining verified positions from other protocols', async () => {
  readers.curve.mockRejectedValueOnce(new Error('private-curve-provider-key'));
  const result = await getPortfolio(wallet);
  expect(result.protocols.find(p => p.id === 'curve-llamalend')?.status).toBe('error');
  expect(result.protocols.find(p => p.id === 'fluid')?.status).toBe('ok');
  expect(JSON.stringify(result)).not.toContain('private-curve-provider-key');
});
