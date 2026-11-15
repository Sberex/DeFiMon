import { expect, it } from 'vitest';
import { correspondingTokens, parseTokenMatches } from '../server/market-tokens';
import { expandTargets } from '../server/market-readers';
import { searchMarkets } from '../server/market-search';
import type { ChainClient } from '../server/rpc';
const susdai = '0x0b2b2b2076d95dda7817e785989fe353fe955ef9';
const usdt = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const usdt0 = '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb';
it('uses the explicit USDT/USDT0 match in both directions without relying on matching symbols', () => {
  expect(correspondingTokens(usdt, 'ethereum', 'plasma')).toEqual([usdt0]);
  expect(correspondingTokens(usdt0.toUpperCase().replace('0X', '0x'), 'plasma', 'ethereum')).toEqual([usdt]);
  expect(correspondingTokens(usdt0, 'plasma', 'arbitrum')).toEqual(['0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9']);
});
it('keeps unlisted chain deployments and different USDC wrappers out of cross-network searches', () => {
  expect(correspondingTokens('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'ethereum', 'plasma')).toEqual(['0x2d661c89d812261039af9764eceaaee884f5f67f']);
  expect(correspondingTokens('0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', 'ethereum', 'plasma')).toEqual([]);
  expect(correspondingTokens('0xaf88d065e77c8cc2239327c5edb3a432268e5831', 'arbitrum', 'ethereum')).toEqual(['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48']);
  expect(correspondingTokens('0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', 'arbitrum', 'ethereum')).toEqual([]);
});
it('expands same-address sUSDai plus USDT debt and GHO debt to the correct Plasma contracts', () => {
  const expanded = expandTargets([{ id: 'loan', network: 'ethereum', supplied: susdai, borrowed: usdt }, { id: 'gho', network: 'arbitrum', supplied: susdai, borrowed: '0x7dff72693f6a4149b17e7c6314655f6a9f7c8b33' }], 'plasma');
  expect(expanded[0]).toMatchObject({ supplies: [susdai], borrows: [usdt0], allSupplies: [susdai], allBorrows: [usdt0] });
  expect(expanded[1].borrows).toEqual(['0xb77e872a68c62cfc0dfb02c067ecc3da23b4bbf3']);
});
it('supports adding a new token through configuration without changing matching code', () => {
  const matches = parseTokenMatches({ NEW_TOKEN: { ethereum: usdt, plasma: usdt0 } });
  expect(correspondingTokens(usdt0, 'plasma', 'ethereum', matches)).toEqual([usdt]);
  expect(correspondingTokens(usdt, 'ethereum', 'arbitrum', matches)).toEqual([]);
  expect(correspondingTokens(usdt, 'ethereum', 'ethereum', {})).toEqual([usdt]);
});
it('rejects invalid and ambiguous configuration instead of guessing a token identity', () => {
  for (const invalid of [null, [], { TOKEN: [] }, { TOKEN: {} }, { TOKEN: { base: usdt } }, { TOKEN: { ethereum: 'bad' } }, { TOKEN: { ethereum: '0x0000000000000000000000000000000000000000' } }, { TOKEN: { ethereum: usdt }, OTHER: { ethereum: usdt.toUpperCase().replace('0X', '0x') } }]) {
    expect(() => parseTokenMatches(invalid)).toThrow();
  }
});
it('dispatches the configured sUSDai/USDT pair to all eleven supported protocol-network searches', async () => {
  const reached: string[] = [];
  const sources = Object.fromEntries(['aave-v3', 'aave-v4', 'compound', 'fluid', 'morpho'].map(id => [id, { name: id, read: async (_client: ChainClient, network: string, _block: bigint, targets: ReturnType<typeof expandTargets>) => {
    reached.push(`${id}:${network}`);
    if (network === 'plasma') expect(targets[0].borrows).toEqual([usdt0]);
    if (network === 'arbitrum') expect(targets[0].borrows).toEqual(['0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9']);
    return [];
  } }]));
  const clientFor = (network: string) => ({ getChainId: async () => network === 'ethereum' ? 1 : network === 'plasma' ? 9745 : 42161, getBlockNumber: async () => 100n } as unknown as ChainClient);
  const result = await searchMarkets([{ id: 'loan', network: 'ethereum', supplied: susdai, borrowed: usdt }], clientFor, sources);
  expect(result.coverage).toHaveLength(11); expect(reached).toHaveLength(11);
  expect(reached).toContain('fluid:plasma'); expect(reached).toContain('morpho:arbitrum');
});
