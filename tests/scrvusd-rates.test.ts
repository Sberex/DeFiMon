import { expect, it } from 'vitest';
import {
  configuredTokenRegistry,
  configuredTokenCategory,
  configuredWalletTokens,
} from '../server/token-registry';
import {
  createSavingsRateService,
  savingsGroup,
} from '../server/savings-rates';
import {
  applyIntrinsicRates,
  intrinsicTokenRate,
} from '../server/intrinsic-rates';
import { applyWalletInterest } from '../server/wallet-interest';
import {
  positionMonthlyInterest,
  totalMonthlyInterest,
} from '../src/monthly-interest';
import { walletTokenInterest } from '../src/wallet-interest';
import type { ChainClient } from '../server/rpc';
import type { ProtocolResult, WalletBalances } from '../src/types';
const token = '0x0655977feb2f289a4ab78af67bab0d17aab84367';
const underlying = '0xf939e0a03fb07f59a73314e73794be0e57ac1b4e';
const end = 1_000_000n,
  start = end - 216_000n,
  now = 2_000_000_000n;
function fixture(wrongHistoricalAsset = false) {
  const reads: { address: string; block: bigint; fn: string }[] = [];
  const client = {
    getChainId: async () => 1,
    getBlockNumber: async () => end,
    getBlock: async ({ blockNumber }: any) => ({
      number: blockNumber,
      timestamp: now - (end - blockNumber) * 12n,
    }),
    readContract: async ({ address, functionName, blockNumber, args }: any) => {
      reads.push({
        address: address.toLowerCase(),
        block: blockNumber,
        fn: functionName,
      });
      if (functionName === 'asset')
        return wrongHistoricalAsset && blockNumber <= start
          ? token
          : underlying;
      if (functionName === 'decimals') return 18;
      if (functionName === 'convertToAssets') {
        expect(address.toLowerCase()).toBe(token);
        expect(args).toEqual([10n ** 18n]);
        return blockNumber <= start ? 108n * 10n ** 16n : 110n * 10n ** 16n;
      }
      throw Error('Unexpected RPC read');
    },
  } as unknown as ChainClient;
  return {
    service: createSavingsRateService({ clientFor: () => client }),
    reads,
  };
}
it('discovers scrvUSD by Ethereum address and applies configured redemption growth to collateral and wallet income once', async () => {
  expect(configuredTokenCategory('ethereum', token)).toBe('Savings stablecoin');
  expect(
    configuredWalletTokens('ethereum').filter((t) => t.address === token),
  ).toHaveLength(1);
  expect(savingsGroup('ethereum', token.toUpperCase())).toBe('scrvUSD');
  expect(savingsGroup('arbitrum', token)).toBeUndefined();
  expect(configuredTokenRegistry.scrvUSD.intrinsicOracles?.[0]).toMatchObject({
    network: 'ethereum',
    kind: 'erc4626',
    address: token,
    token,
    underlying,
  });
  const { service, reads } = fixture(),
    rate = await service.quote('scrvUSD', { network: 'ethereum' });
  const apr = (((1.1 - 1.08) / 1.08) * 365) / 30;
  expect(rate.apr).toBeCloseTo(apr, 12);
  expect(rate.source).toMatchObject({
    oracle: token,
    kind: 'erc4626',
    startRate: 1.08,
    endRate: 1.1,
    startBlockNumber: String(start),
    blockNumber: String(end),
  });
  expect(
    reads
      .filter((r) => r.fn === 'convertToAssets')
      .map((r) => r.block)
      .sort(),
  ).toEqual([end, start].sort());
  const protocols: ProtocolResult[] = [
    {
      id: 'curve-llamalend',
      name: 'Curve LlamaLend',
      status: 'ok',
      coverage: 'test',
      positions: [
        {
          id: 'test',
          label: 'scrvUSD collateral',
          risk: 'no-debt',
          healthFactor: null,
          suppliedUsd: 110,
          debtUsd: 0,
          notes: [],
          assets: [
            {
              address: token,
              symbol: 'renamed ticker',
              supplied: 100,
              borrowed: 0,
              priceUsd: 1.1,
              collateral: true,
              liquidationThreshold: null,
              liquidationPriceUsd: null,
              supplyRate: { apr: 0, note: 'Collateral' },
            },
          ],
        },
      ],
    },
  ];
  const enriched = await applyIntrinsicRates(
    protocols,
    'ethereum',
    undefined,
    service.quote,
  );
  expect(positionMonthlyInterest(enriched[0].positions[0]).nplUsd).toBeCloseTo(
    (110 * apr) / 12,
  );
  const wallet: WalletBalances = {
    chain: 'Ethereum',
    status: 'ok',
    coverage: 'test',
    pricedValueUsd: 22,
    unpricedCount: 0,
    tokens: [
      {
        address: token,
        symbol: 'scrvUSD',
        category: 'Savings stablecoin',
        balance: 20,
        priceUsd: 1.1,
        valueUsd: 22,
      },
    ],
  };
  const w = await applyWalletInterest(
    wallet,
    'ethereum',
    [],
    (network, address) =>
      intrinsicTokenRate(network, address, {}, undefined, service.quote),
  );
  expect(w.tokens[0].interestBearing).toBe(true);
  expect(walletTokenInterest(w.tokens[0]).earnedUsd).toBeCloseTo(
    (22 * apr) / 12,
  );
  expect(totalMonthlyInterest(enriched, [w]).nplUsd).toBeCloseTo(
    (132 * apr) / 12,
  );
});
it('refuses scrvUSD yield when the historical redemption asset does not match configured crvUSD', async () => {
  const { service } = fixture(true);
  const rate = await service.quote('scrvUSD', { network: 'ethereum' });
  expect(rate.apr).toBeNull();
  expect(rate.source.kind).toBe('unavailable');
});
