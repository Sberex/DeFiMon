import { afterEach, expect, it, vi } from 'vitest';
import { makeClient } from '../server/rpc';
afterEach(() => vi.unstubAllEnvs());
it('creates independent network clients with the correct chain and native currency', () => {
  vi.stubEnv('ETHEREUM_RPC_URL', 'https://ethereum.example');
  vi.stubEnv('PLASMA_RPC_URL', '');
  expect(makeClient().chain.id).toBe(1);
  const client = makeClient('plasma');
  expect(client.chain.id).toBe(9745); expect(client.chain.nativeCurrency.symbol).toBe('XPL');
  expect(client.transport.url).toBe('https://rpc.plasma.to');
  vi.stubEnv('PLASMA_RPC_URL', 'https://plasma.example');
  expect(makeClient('plasma').transport.url).toBe('https://plasma.example');
});
it('rejects insecure remote RPC URLs and never includes provider credentials in validation errors', () => {
  vi.stubEnv('PLASMA_RPC_URL', 'http://private.example/provider-secret');
  expect(() => makeClient('plasma')).toThrow('PLASMA_RPC_URL must use HTTPS.');
  vi.stubEnv('PLASMA_RPC_URL', 'http://127.0.0.1:8545');
  expect(makeClient('plasma').chain.id).toBe(9745);
});

it('uses Arbitrum One and its own default or configured provider without reusing Ethereum', () => {
  vi.stubEnv('ETHEREUM_RPC_URL', 'https://ethereum.example');
  vi.stubEnv('ARBITRUM_RPC_URL', '');
  const client = makeClient('arbitrum');
  expect(client.chain.id).toBe(42161); expect(client.chain.nativeCurrency.symbol).toBe('ETH');
  expect(client.transport.url).toBe('https://arb1.arbitrum.io/rpc');
  vi.stubEnv('ARBITRUM_RPC_URL', 'https://arbitrum.example');
  expect(makeClient('arbitrum').transport.url).toBe('https://arbitrum.example');
});
