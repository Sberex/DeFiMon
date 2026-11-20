import { expect, it } from 'vitest';
import { configuredWalletTokens } from '../server/token-registry';
import { readWallet } from '../server/wallet';
import { networks } from '../server/networks';
import { expandTargets } from '../server/market-readers';
import { searchMarkets } from '../server/market-search';
import { correspondingTokens, normalizeMarketToken } from '../server/market-tokens';
import { positionLinks } from '../src/position-links';
import { example } from '../src/example';
import type { ChainClient } from '../server/rpc';
const wallet = '0x1111111111111111111111111111111111111111';
const usdt = '0x55d398326f99059ff775485246999027b3197955';
it('reads BNB and configured BEP-20 balances using BSC token decimals and verified USD prices', async () => {
  const seen: string[] = [];
  const client = {
    getBalance: async () => 2n * 10n ** 18n,
    multicall: async ({ contracts, blockNumber }: any) => {
      expect(blockNumber).toBe(123n);
      seen.push(...contracts.map((c: any) => c.address.toLowerCase()));
      return contracts.map((c: any) => ({ status: 'success', result: c.address.toLowerCase() === usdt ? 5n * 10n ** 18n : 0n }));
    },
    readContract: async ({ functionName, address, blockNumber }: any) => {
      expect(blockNumber).toBe(123n);
      if (functionName === 'getPoolDataProvider' || functionName === 'getPool') { expect(address).toBe(networks.bsc.aaveProvider); return wallet; }
      if (functionName === 'getAllATokens' || functionName === 'getAllFTokens') return [];
      if (functionName === 'decimals') return 18;
      if (functionName === 'symbol') return 'USDT';
      throw new Error('Ordinary ERC20 does not identify an Aave pool');
    },
  } as unknown as ChainClient;
  const result = await readWallet(client, wallet, 123n, 'bsc', [], [], undefined, async () => new Map([[networks.bsc.wrappedNative.toLowerCase(), 600], [usdt, .99]]));
  expect(result.chain).toBe('Binance Smart Chain');
  expect(result.tokens.find(t => t.address === 'native')).toMatchObject({ symbol: 'BNB', balance: 2, valueUsd: 1200 });
  expect(result.tokens.find(t => t.address.toLowerCase() === usdt)).toMatchObject({ symbol: 'USDT', category: 'Stablecoin', balance: 5, valueUsd: 4.95 });
  expect(result.pricedValueUsd).toBeCloseTo(1204.95);
  expect(configuredWalletTokens('bsc').length).toBeGreaterThan(700);
  expect(configuredWalletTokens('bsc').every(t => seen.includes(t.address))).toBe(true);
  expect(new Set(seen).size).toBe(seen.length);
});
it('searches the three BSC lending protocols for an explicitly matched cross-network pair', async () => {
  const ethUsdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', ethUsdt = '0xdac17f958d2ee523a2206206994597c13d831ec7';
  const supplied = correspondingTokens(ethUsdc, 'ethereum', 'bsc')[0];
  expect(supplied).toBe('0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d');
  expect(correspondingTokens(ethUsdt, 'ethereum', 'bsc')).toEqual([usdt]);
  const reached: string[] = [];
  const sources = Object.fromEntries(['aave-v3', 'aave-v4', 'morpho', 'compound', 'fluid', 'euler', 'spark'].map(id => [id, { name: id, read: async (_client: ChainClient, network: string, block: bigint, targets: ReturnType<typeof expandTargets>) => {
    if (network === 'bsc') { reached.push(id); expect(block).toBe(123n); expect(targets[0].supplies).toEqual([supplied]); expect(targets[0].borrows).toEqual([usdt]); }
    return [];
  } }]));
  const result = await searchMarkets([{ id: 'loan', network: 'ethereum', supplied: ethUsdc, borrowed: ethUsdt }], network => ({ getChainId: async () => networks[network].id, getBlockNumber: async () => 123n } as unknown as ChainClient), sources);
  expect(reached.sort()).toEqual(['aave-v3', 'euler', 'fluid']);
  expect(result.coverage.filter(c => c.network === 'bsc')).toHaveLength(3);
  expect(result.coverage.filter(c => c.network === 'bsc').every(c => c.status === 'ok')).toBe(true);
});
it('uses BSC contracts and explorer links instead of Ethereum defaults', () => {
  expect(networks.bsc.morphoBlue).not.toBe(networks.ethereum.morphoBlue);
  expect(normalizeMarketToken('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', 'bsc')).toBe(networks.bsc.wrappedNative.toLowerCase());
  const position = { ...example.protocols[0].positions[0], marketAddress: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB' };
  expect(positionLinks('aave-v3', 'Binance Smart Chain', position)[0].url).toBe(`https://bscscan.com/address/${position.marketAddress}`);
});
