import { expect, it, vi } from 'vitest';
import { networks } from '../server/networks';
import { makeClient } from '../server/rpc';
import { configuredWalletTokens } from '../server/token-registry';
import { readWallet } from '../server/wallet';
import { walletPrices } from '../server/wallet-prices';
import {
  aaveV4Deployment,
  AAVE_V4_SPOKES,
} from '../server/deployments/aave-v4';
import { readV4Markets } from '../server/market-v4';
import { expandTargets } from '../server/market-readers';
import {
  correspondingTokens,
  normalizeMarketToken,
} from '../server/market-tokens';
import { parsePositionAlertInput, defaultAlertRules } from '../src/alert-rules';
import { createLiquidityAlertReader } from '../server/liquidity-alert-reader';
import type { ChainClient } from '../server/rpc';
const usdc = '0x3600000000000000000000000000000000000000',
  wallet = '0x1111111111111111111111111111111111111111';
it('uses Arc mainnet chain ID, native USDC and its own verified lending contracts', () => {
  expect(makeClient('arc').chain.id).toBe(5042);
  expect(makeClient('arc').chain.nativeCurrency).toMatchObject({
    symbol: 'USDC',
    decimals: 18,
  });
  expect(networks.arc.protocolIds).toEqual(['aave-v4', 'morpho']);
  expect(networks.arc.morphoBlue).not.toBe(networks.ethereum.morphoBlue);
  expect(aaveV4Deployment('arc').spokes).toHaveLength(3);
  expect(aaveV4Deployment('arc').tokenizations).toHaveLength(4);
  expect(configuredWalletTokens('arc').some((t) => t.address === usdc)).toBe(
    true,
  );
  expect(
    correspondingTokens(
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      'ethereum',
      'arc',
    ),
  ).toEqual([usdc]);
  expect(
    normalizeMarketToken('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', 'arc'),
  ).toBe(usdc);
});
it('counts native USDC once at 18-decimal precision and excludes its 6-decimal mirror and Aave v4 receipts', async () => {
  const receipt = aaveV4Deployment('arc').tokenizations[0].address;
  const calls: any[] = [];
  const client = {
    getBalance: async () => 1234567891234567890n,
    multicall: async ({ contracts, blockNumber }: any) => {
      expect(blockNumber).toBe(123n);
      expect(contracts.map((c: any) => c.address)).not.toContain(usdc);
      return contracts.map(() => ({ status: 'success', result: 1000000n }));
    },
    readContract: async (q: any) => {
      calls.push(q);
      if (q.functionName === 'symbol') return 'aUSDC';
      if (q.functionName === 'decimals') return 6;
      throw Error('No undeployed reader should run');
    },
  } as unknown as ChainClient;
  const prices = vi.fn(async (_c: any, n: any, _b: any, tokens: any) => {
    expect(n).toBe('arc');
    expect(tokens).toEqual([{ address: usdc, decimals: 6 }]);
    return new Map([[usdc, 0.999]]);
  });
  const result = await readWallet(
    client,
    wallet,
    123n,
    'arc',
    [],
    [],
    [
      { address: usdc, symbol: 'USDC' },
      { address: receipt, symbol: 'Receipt' },
    ],
    prices,
  );
  const native = result.tokens.find((t) => t.address === 'native')!;
  expect(native).toMatchObject({ symbol: 'USDC', category: 'Stablecoin' });
  expect(native.balance).toBeCloseTo(1.23456789123456789, 14);
  expect(result.pricedValueUsd).toBeCloseTo(native.balance! * 0.999, 14);
  expect(result.tokens.some((t) => t.address === usdc)).toBe(false);
  expect(
    result.tokens.find((t) => t.address === receipt)?.excludedReason,
  ).toContain('receipt');
  expect(
    calls.every(
      (q) =>
        !['getPool', 'getPoolDataProvider', 'getAllFTokens'].includes(
          q.functionName,
        ),
    ),
  ).toBe(true);
  expect(result.interestDiscoveryComplete).toBe(true);
});
it('prices Arc USDC from a fresh market quote without an assumed dollar peg or undeployed Aave v3 oracle', async () => {
  const readContract = vi.fn();
  const client = { readContract } as unknown as ChainClient;
  const fetcher = vi.fn(
    async (url: any) =>
      new Response(
        JSON.stringify(
          String(url).includes('coingecko:usd-coin')
            ? {
                coins: {
                  'coingecko:usd-coin': {
                    price: 0.9987,
                    confidence: 0.999,
                    timestamp: Date.now() / 1000,
                  },
                },
              }
            : { coins: {} },
        ),
      ),
  );
  const result = await walletPrices(
    client,
    'arc',
    1n,
    [{ address: usdc, decimals: 6 }],
    fetcher as typeof fetch,
  );
  expect(result.get(usdc)).toBe(0.9987);
  expect(readContract).not.toHaveBeenCalled();
  const missing = await walletPrices(
    client,
    'arc',
    1n,
    [{ address: usdc, decimals: 6 }],
    vi.fn(
      async () => new Response(JSON.stringify({ coins: {} })),
    ) as typeof fetch,
  );
  expect(missing.has(usdc)).toBe(false);
});
it('searches only Arc Aave v4 Spokes, never Ethereum deployments on the Arc RPC', async () => {
  const addresses: string[] = [];
  const client = {
    readContract: async ({ address, functionName }: any) => {
      addresses.push(address);
      if (functionName === 'getReserveCount') return 0n;
      throw Error('Unexpected call');
    },
  } as unknown as ChainClient;
  const targets = expandTargets(
    [
      {
        id: 'pair',
        network: 'arc',
        supplied: '0x0dc6b79f3c3854e4d74514fd4d29be6c96beee39',
        borrowed: usdc,
      },
    ],
    'arc',
  );
  expect(await readV4Markets(client, 'arc', 123n, targets, () => {})).toEqual(
    [],
  );
  expect(addresses).toEqual(
    aaveV4Deployment('arc').spokes.map((s) => s.address),
  );
  expect(
    addresses.some((a) => AAVE_V4_SPOKES.some((s) => s.address === a)),
  ).toBe(false);
});
it('saves Arc alert scopes and explicitly rejects unsupported protocols without RPC calls', async () => {
  expect(
    parsePositionAlertInput({
      network: 'arc',
      protocol: 'aave-v4',
      positionId: 'aave-v4-test',
      rules: defaultAlertRules(),
    }).network,
  ).toBe('arc');
  const clients = vi.fn();
  const read = createLiquidityAlertReader(clients);
  const result = await read({
    network: 'arc',
    protocol: 'fluid',
    positionId: 'fluid-nft-1',
    address: wallet,
    ruleUpdatedAt: '2026-11-27T00:00:00.000Z',
  });
  expect(result.status).toBe('unsupported');
  expect(clients).not.toHaveBeenCalled();
});

it('pins compact and spaced Morpho queries to Arc instead of leaving Ethereum filters behind', async () => {
  const { createMorphoQuery } = await import('../server/morpho-api');
  const bodies: any[] = [];
  const fetcher = vi.fn(async (_url: any, init: any) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ data: { markets: { items: [] } } }));
  });
  const query = createMorphoQuery(fetcher as typeof fetch, 'arc', new Set());
  await query(
    'query { markets(where:{chainId_in:[1]}) { items{id} } userByAddress(chainId:1) {address} }',
    {},
  );
  await query('query { markets(where:{chainId_in: [1]}) { items{id} } }', {});
  expect(bodies.every((b) => b.query.includes('chainId_in: [5042]'))).toBe(
    true,
  );
  expect(bodies[0].query).toContain('chainId: 5042)');
});
