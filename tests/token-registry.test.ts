import { expect, it } from 'vitest';
import { parseTokenRegistry, configuredTokenRegistry, configuredWalletTokens } from '../server/token-registry';
import { parseTokenMatches } from '../server/market-tokens';
import { createTokenDiscovery } from '../server/token-discovery';
import { readWallet } from '../server/wallet';
import type { ChainClient } from '../server/rpc';
const first = '0x1111111111111111111111111111111111111111';
const second = '0x2222222222222222222222222222222222222222';
it('accepts EVM chains outside the dashboard and keeps categories out of address matches', () => {
  const input = { TEST: { _category: 'Savings stablecoin', ethereum: first, base: second } };
  expect(parseTokenRegistry(input).TEST).toMatchObject({ category: 'Savings stablecoin', addresses: { ethereum: first, base: second } });
  expect(parseTokenMatches(input).TEST).toEqual({ ethereum: first, base: second });
  expect(parseTokenRegistry({ OLD: { ethereum: first } }).OLD.category).toBe('Other');
});
it('rejects ambiguous contract ownership, unknown chains, metadata typos and native placeholders', () => {
  for (const value of [
    { A: { _category: 'Savings', ethereum: first } }, { A: { _category: 'Stablecoin' } },
    { A: { moon: first } }, { A: { base: first }, B: { base: first.toUpperCase().replace('0X', '0x') } },
    { A: { ethereum: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' } }, { A: { ethereum: first, _cmc: 'not-a-chain' } },
  ]) expect(() => parseTokenRegistry(value)).toThrow();
});
it('retains confirmed stablecoin identities separately from yield assets and depegged USTC', () => {
  expect(configuredTokenRegistry.USDC.category).toBe('Stablecoin');
  expect(configuredTokenRegistry.sUSDai.category).toBe('Savings stablecoin');
  expect(configuredTokenRegistry.sUSDS.category).toBe('Savings stablecoin');
  expect(configuredTokenRegistry.USDY.category).toBe('Savings stablecoin');
  expect(configuredTokenRegistry.vBUSD.category).toBe('Savings stablecoin');
  expect(configuredTokenRegistry.GUSD.category).toBe('Savings stablecoin');
  expect(configuredTokenRegistry['GUSD#3306'].category).toBe('Stablecoin');
  expect(configuredTokenRegistry.USTC.category).toBe('Other');
  expect(configuredTokenRegistry.USDT.addresses.plasma).toBe('0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb');
});
it.each(['ethereum', 'arbitrum', 'plasma', 'base'] as const)('discovers configured balances on %s without custom token input or assumed stablecoin prices', async network => {
  const token = configuredTokenRegistry.sUSDai.addresses[network]!;
  const usdc = configuredTokenRegistry.USDC.addresses[network]!;
  const scanned: string[] = [], blocks: bigint[] = [];
  const client = {
    getBalance: async () => 0n,
    multicall: async ({ contracts, blockNumber }: any) => {
      blocks.push(blockNumber);
      return contracts.map((c: any) => { const a = c.address.toLowerCase(); scanned.push(a); return { status: 'success', result: a === token ? 2n * 10n ** 18n : a === usdc ? 5_000000n : 0n }; });
    },
    readContract: async ({ functionName, address, blockNumber }: any) => {
      blocks.push(blockNumber);
      if (functionName === 'getPoolDataProvider' || functionName === 'getPool') return first;
      if (functionName === 'getAllATokens' || functionName === 'getAllFTokens') return [];
      if (functionName === 'symbol') return address.toLowerCase() === token ? 'sUSDai' : 'USDC';
      if (functionName === 'isMoolahVault') return false;
      if (functionName === 'decimals') return address.toLowerCase() === token ? 18 : 6;
      throw new Error('Unsupported fixture method');
    },
  } as unknown as ChainClient;
  const priceReader = async () => new Map([[token, 1.21], [usdc, .98]]);
  const result = await readWallet(client, first, 123n, network, [], [], undefined, priceReader);
  expect(result.tokens.find(t => t.address.toLowerCase() === token)).toMatchObject({ symbol: 'sUSDai', category: 'Savings stablecoin', balance: 2, priceUsd: 1.21, valueUsd: 2.42 });
  expect(result.tokens.find(t => t.address.toLowerCase() === usdc)).toMatchObject({ category: 'Stablecoin', balance: 5, valueUsd: 4.9 });
  expect(result.pricedValueUsd).toBeCloseTo(7.32);
  expect(new Set(scanned).size).toBe(scanned.length);
  expect(scanned.filter(a => a === token)).toHaveLength(1);
  expect(configuredWalletTokens(network).every(t => scanned.includes(t.address))).toBe(true);
  expect(blocks.every(b => b === 123n)).toBe(true);
});

it('keeps stored non-dashboard chains out of recommendation reports without requesting external discovery', async () => {
  const manual = parseTokenMatches({ TEST: { _category: 'Stablecoin', ethereum: first, optimism: second } });
  const discovery = createTokenDiscovery({ manual, fetcher: (async () => { throw new Error('Unexpected external request'); }) as typeof fetch });
  const result = await discovery.resolve([{ id: 'deposit', network: 'ethereum', supplied: first }]);
  expect(result.reports[0]).toMatchObject({ status: 'manual', matches: { ethereum: first } });
  expect(Object.keys(result.reports[0].matches)).toEqual(['ethereum']);
  expect(result.matches.TEST.optimism).toBe(second);
});

it('validates inline intrinsic oracles as metadata and keeps them out of wallet and cross-chain token addresses', () => {
  const source = { network: 'ethereum', kind: 'chainlink', address: second, token: first, description: 'TEST/USD', decimals: 18, label: 'TEST oracle' };
  const input = { RENAMED: { _category: 'Savings stablecoin', ethereum: first, _intrinsicOracles: [source] } };
  expect(parseTokenRegistry(input).RENAMED.intrinsicOracles).toEqual([source]);
  expect(parseTokenRegistry(input).RENAMED.addresses).toEqual({ ethereum: first });
  expect(parseTokenMatches(input)).toEqual({ RENAMED: { ethereum: first } });
  for (const oracles of [[], [source, source], [{ ...source, address: 'bad' }], [{ ...source, token: second }], [{ ...source, network: 'moon' }], [{ ...source, kind: 'guess' }], [{ ...source, decimals: 37 }], [{ ...source, computed: true }], [{ ...source, kind: 'erc4626' }], [{ ...source, unexpected: true }]]) {
    expect(() => parseTokenRegistry({ RENAMED: { _category: 'Savings stablecoin', ethereum: first, _intrinsicOracles: oracles } })).toThrow('_intrinsicOracles');
  }
});

it('permits explicitly identified timestamp-free NAV adapters without relaxing ordinary oracle validation', () => {
  const source = { network: 'ethereum', kind: 'chainlink', address: second, token: first, description: 'Native NAV', decimals: 18, computed: true, tokenGetter: 'token', computedTimestamp: 'none', label: 'Canonical computed NAV' };
  expect(parseTokenRegistry({ NAV: { _category: 'Savings stablecoin', ethereum: first, _intrinsicOracles: [source] } }).NAV.intrinsicOracles?.[0]).toEqual(source);
  for (const invalid of [{ ...source, computed: false }, { ...source, tokenGetter: undefined }, { ...source, computedTimestamp: 'guess' }, { ...source, description: undefined }, { ...source, history: 'rounds' }]) {
    expect(() => parseTokenRegistry({ NAV: { _category: 'Savings stablecoin', ethereum: first, _intrinsicOracles: [invalid] } })).toThrow('_intrinsicOracles');
  }
});


it('validates Pharos Safety Score metadata without treating its URL as a contract match', () => {
  const url = 'https://pharos.watch/stablecoin/susdai-usd-ai/';
  const input = { RENAMED: { _category: 'Savings stablecoin', ethereum: first, 'Safety Score': url } };
  expect(parseTokenRegistry(input).RENAMED.safetyScore).toBe(url);
  expect(parseTokenRegistry(input).RENAMED.addresses).toEqual({ ethereum: first });
  expect(parseTokenMatches(input)).toEqual({ RENAMED: { ethereum: first } });
  for (const invalid of [1, {}, null, 'https://evil.example/stablecoin/test/', 'http://pharos.watch/stablecoin/test/', 'https://pharos.watch@evil.example/stablecoin/test/', 'https://pharos.watch/stablecoin/test/?redirect=bad']) {
    expect(() => parseTokenRegistry({ TOKEN: { ethereum: first, 'Safety Score': invalid } })).toThrow('Safety Score');
  }
});
