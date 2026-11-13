import { expect, it } from 'vitest';
import type { ChainClient } from '../server/rpc';
import { walletPrices } from '../server/wallet-prices';
const token = { address: '0x2222222222222222222222222222222222222222' as const, decimals: 18 };
const noOracle = { readContract: async () => { throw new Error('private-api-key'); }, getBlock: async () => { throw new Error('not available'); } } as unknown as ChainClient;
it('accepts a fresh, confident USD price for the exact network and contract without sending a wallet', async () => {
  const fetcher = (async (url: any) => {
    expect(String(url)).toBe(`https://coins.llama.fi/prices/current/plasma:${token.address}`);
    return new Response(JSON.stringify({ coins: { [`plasma:${token.address}`]: { price: 0.98, timestamp: Math.floor(Date.now() / 1000), confidence: 0.99, decimals: 18 } } }));
  }) as typeof fetch;
  expect((await walletPrices(noOracle, 'plasma', 1n, [token], fetcher)).get(token.address)).toBe(0.98);
});
it('rejects stale, future, low-confidence, wrong-decimal, and invalid prices', async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const overrides of [{ timestamp: now - 7200 }, { timestamp: now + 600 }, { confidence: 0.1 }, { decimals: 6 }, { price: -1 }, { price: '1' }]) {
    const fetcher = (async () => new Response(JSON.stringify({ coins: { [`plasma:${token.address}`]: { price: 1, timestamp: now, confidence: 0.99, decimals: 18, ...overrides } } }))) as typeof fetch;
    expect((await walletPrices(noOracle, 'plasma', 1n, [token], fetcher)).size).toBe(0);
  }
});
it('retains unknown prices when the external service fails without exposing upstream errors', async () => {
  const fetcher = (async () => { throw new Error('private details'); }) as typeof fetch;
  expect((await walletPrices(noOracle, 'plasma', 1n, [token], fetcher)).size).toBe(0);
});

it('uses a non-peg on-chain oracle price and pins it to the selected block without needing an external service', async () => {
  const calls: bigint[] = [];
  let externalCalls = 0;
  const client = {
    readContract: async ({ functionName, blockNumber }: any) => { calls.push(blockNumber); return functionName === 'getPriceOracle' ? token.address : 100000000n; },
    multicall: async ({ blockNumber }: any) => { calls.push(blockNumber); return [{ status: 'success', result: 97800000n }]; },
  } as unknown as ChainClient;
  const fetcher = (async () => { externalCalls++; throw new Error('not needed'); }) as typeof fetch;
  expect((await walletPrices(client, 'ethereum', 123n, [token], fetcher)).get(token.address)).toBe(0.978);
  expect(calls.every(block => block === 123n)).toBe(true); expect(externalCalls).toBe(0);
});
