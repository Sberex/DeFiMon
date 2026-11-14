import { expect, it, vi } from 'vitest';
import type { ChainClient } from '../server/rpc';
import { readWallet } from '../server/wallet';
import { networks } from '../server/networks';
const wallet = '0x1111111111111111111111111111111111111111';
const usdc = '0x2222222222222222222222222222222222222222';
const eul = '0x3333333333333333333333333333333333333333';
const receipt = '0x4444444444444444444444444444444444444444';
const catalog = [{ address: usdc, symbol: 'USDC' }, { address: eul, symbol: 'EUL' }, { address: receipt, symbol: 'aUSDC' }] as const;
function fixture(options: { noPrice?: boolean; failBalance?: boolean; failReceiptCheck?: boolean; failNative?: boolean } = {}) {
  const blocks: bigint[] = [];
  const client = {
    getBalance: async ({ blockNumber }: any) => { blocks.push(blockNumber); if (options.failNative) throw new Error('private-rpc'); return 2n * 10n ** 18n; },
    multicall: async ({ contracts, blockNumber }: any) => { blocks.push(blockNumber); return contracts.map((c: any) => options.failBalance ? { status: 'failure', error: new Error('private-key') } : { status: 'success', result: c.address.toLowerCase() === usdc ? 5000000n : 3n * 10n ** 18n }); },
    readContract: async ({ functionName, address, blockNumber }: any) => {
      blocks.push(blockNumber);
      if (functionName === 'getPoolDataProvider') return usdc;
      if (functionName === 'getPool') return usdc;
      if (functionName === 'getAllATokens') { if (options.failReceiptCheck) throw new Error('secret'); return [{ tokenAddress: receipt, symbol: 'aUSDC' }]; }
      if (functionName === 'getAllFTokens') return [];
      if (functionName === 'symbol') return address.toLowerCase() === usdc ? 'USDC' : address.toLowerCase() === receipt ? 'aUSDC' : 'EUL';
      if (functionName === 'decimals') return address.toLowerCase() === usdc ? 6 : 18;
      throw new Error(functionName);
    },
  } as unknown as ChainClient;
  const prices = vi.fn(async (..._args: any[]) => options.noPrice ? new Map<string, number>() : new Map([[networks.ethereum.wrappedNative.toLowerCase(), 3000], [networks.plasma.wrappedNative.toLowerCase(), 0.5], [usdc, 0.98], [eul, 2]]));
  return { client, prices, blocks };
}
it('reads native and token balances at one block, handles decimals, excludes receipt shares, and sums only wallet values', async () => {
  const f = fixture();
  const result = await readWallet(f.client, wallet, 123n, 'ethereum', [], [], [...catalog], f.prices);
  expect(result.tokens.find(t => t.symbol === 'ETH')).toMatchObject({ balance: 2, valueUsd: 6000 });
  expect(result.tokens.find(t => t.symbol === 'USDC')).toMatchObject({ balance: 5, valueUsd: 4.9 });
  expect(result.tokens.find(t => t.symbol === 'aUSDC')).toMatchObject({ valueUsd: null, excludedReason: expect.stringContaining('receipt') });
  expect(result.pricedValueUsd).toBeCloseTo(6010.9);
  expect(f.blocks.every(b => b === 123n)).toBe(true);
  expect(f.prices.mock.calls[0][3].some((t: any) => t.address === receipt)).toBe(false);
});
it('uses Plasma native XPL with its own price and deduplicates added tokens per network', async () => {
  const f = fixture();
  const result = await readWallet(f.client, wallet, 123n, 'plasma', [], [usdc, eul, usdc], [...catalog], f.prices);
  expect(result.tokens.find(t => t.symbol === 'XPL')).toMatchObject({ balance: 2, priceUsd: 0.5, valueUsd: 1 });
  expect(result.tokens.filter(t => t.address.toLowerCase() === usdc)).toHaveLength(1);
  expect(result.pricedValueUsd).toBeCloseTo(11.9);
});
it('leaves unavailable prices unknown, without assuming USDC is worth $1', async () => {
  const f = fixture({ noPrice: true });
  const result = await readWallet(f.client, wallet, 123n, 'ethereum', [], [], [...catalog], f.prices);
  expect(result.status).toBe('partial'); expect(result.pricedValueUsd).toBeNull();
  expect(result.tokens.find(t => t.symbol === 'USDC')).toMatchObject({ balance: 5, priceUsd: null, valueUsd: null });
});
it('keeps a native balance when token reads fail, with unknown additional holdings and no raw provider details', async () => {
  const f = fixture({ failBalance: true });
  const result = await readWallet(f.client, wallet, 123n, 'ethereum', [], [], [...catalog], f.prices);
  expect(result.status).toBe('partial'); expect(result.pricedValueUsd).toBe(6000);
  expect(result.unpricedCount).toBe(3); expect(JSON.stringify(result)).not.toContain('private');
});
it('excludes ERC20 values when receipt classification fails instead of risking double-counted deposits', async () => {
  const f = fixture({ failReceiptCheck: true });
  const result = await readWallet(f.client, wallet, 123n, 'ethereum', [], [], [...catalog], f.prices);
  expect(result.status).toBe('partial'); expect(result.pricedValueUsd).toBe(6000);
  expect(result.tokens.find(t => t.symbol === 'USDC')?.excludedReason).toContain('receipt-token check');
});
it('excludes a held Morpho vault already represented by its protocol position', async () => {
  const f = fixture();
  const result = await readWallet(f.client, wallet, 123n, 'ethereum', [{ id: 'morpho', name: 'Morpho', status: 'ok', coverage: 'test', positions: [{ id: `morpho-vault-${eul}` } as any] }], [], [...catalog], f.prices);
  expect(result.tokens.find(t => t.address.toLowerCase() === eul)?.excludedReason).toContain('receipt');
  expect(result.pricedValueUsd).toBeCloseTo(6004.9);
});

it('does not count an added Aave debt-accounting token as a positive wallet asset', async () => {
  const f = fixture();
  const client = { ...f.client, readContract: async (args: any) => args.functionName === 'POOL' && args.address.toLowerCase() === eul ? usdc : f.client.readContract(args) } as unknown as ChainClient;
  const result = await readWallet(client, wallet, 123n, 'ethereum', [], [eul], [...catalog], f.prices);
  expect(result.tokens.find(t => t.address.toLowerCase() === eul)?.excludedReason).toContain('debt accounting');
  expect(result.pricedValueUsd).toBeCloseTo(6004.9);
});

it('keeps Arbitrum native ETH and excludes Arbitrum Compound receipt shares from wallet totals', async () => {
  const f = fixture();
  const prices = async () => new Map([[networks.arbitrum.wrappedNative.toLowerCase(), 3000], [usdc, 0.98], [eul, 2]]);
  const comet = networks.arbitrum.compoundMarkets[0].address;
  const result = await readWallet(f.client, wallet, 42161n, 'arbitrum', [], [], [...catalog, { address: comet, symbol: 'cUSDC' }], prices);
  expect(result.chain).toBe('Arbitrum');
  expect(result.tokens.find(t => t.address === 'native')).toMatchObject({ symbol: 'ETH', balance: 2, valueUsd: 6000 });
  expect(result.tokens.find(t => t.address.toLowerCase() === comet.toLowerCase())?.excludedReason).toContain('receipt');
  expect(result.pricedValueUsd).toBeCloseTo(6010.9);
});
