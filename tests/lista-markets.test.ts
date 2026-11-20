import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ catalog: vi.fn(), quote: vi.fn(), vault: vi.fn() }));
vi.mock('../server/lista', async importOriginal => ({ ...await importOriginal<typeof import('../server/lista')>(), listaCatalog: mocks.catalog }));
vi.mock('../server/morpho-rates', () => ({ createMorphoRates: () => ({ marketQuote: mocks.quote, vault: mocks.vault }) }));
import { readListaMarkets } from '../server/market-lista';
import { expandTargets } from '../server/market-readers';
import { listaDeployments } from '../server/deployments/lista';
import type { ChainClient } from '../server/rpc';
const id = `0x${'1'.repeat(64)}` as const, loan = '0x2222222222222222222222222222222222222222', collateral = '0x3333333333333333333333333333333333333333', vault = '0x4444444444444444444444444444444444444444', zero = '0x0000000000000000000000000000000000000000';
const params = { loanToken: loan, collateralToken: collateral, irm: zero, oracle: zero, lltv: 800000000000000000n };
beforeEach(() => {
  mocks.catalog.mockReset().mockResolvedValue({ markets: [id], vaults: [{ address: vault, name: 'Lista USDC Earn', asset: loan }] });
  mocks.quote.mockReset().mockResolvedValue({ params, state: { totalSupplyAssets: 1000000n * 10n ** 6n, totalBorrowAssets: 250000n * 10n ** 6n }, apr: .02, borrowApr: .08 });
  mocks.vault.mockReset().mockResolvedValue({ apr: .05, note: 'Allocation weighted APR after fees' });
});
function fixture(options: { paused?: boolean; whitelist?: boolean; broker?: boolean; badOracle?: boolean; wrongFactory?: boolean; failParams?: boolean } = {}) {
  const d = listaDeployments.ethereum!;
  const client = {
    multicall: async ({ contracts, blockNumber }: any) => { expect(blockNumber).toBe(123n); expect(contracts[0].address).toBe(d.core); return [{ status: options.failParams ? 'failure' : 'success', result: params }]; },
    readContract: async ({ address, functionName, blockNumber }: any) => {
      expect(blockNumber).toBe(123n);
      switch (functionName) {
        case 'paused': expect(address).toBe(d.core); return !!options.paused;
        case 'getPrice': expect(address).toBe(d.core); return options.badOracle ? 0n : 10n ** 36n;
        case 'brokers': return options.broker ? vault : zero;
        case 'getWhiteList': return options.whitelist ? [vault] : [];
        case 'maxDeposit': return 10n ** 30n;
        case 'isMoolahVault': expect(address).toBe(d.factory); return !options.wrongFactory;
        case 'MOOLAH': return d.core;
        case 'asset': return loan;
        case 'decimals': return 6;
        case 'symbol': return 'USDC';
      }
      throw new Error('Unexpected fixture method');
    },
  } as unknown as ChainClient;
  const targets = expandTargets([{ id: 'loan', network: 'ethereum', supplied: collateral, borrowed: loan }, { id: 'deposit', network: 'ethereum', supplied: loan }], 'ethereum');
  return { client, targets };
}
it('compares borrowing pairs and same-asset vault/deposit APR with available loan liquidity', async () => {
  const f = fixture(), warnings: string[] = [];
  const result = await readListaMarkets(f.client, 'ethereum', 123n, f.targets, m => warnings.push(m));
  expect(result).toHaveLength(3); expect(warnings).toEqual([]);
  expect(result.find(r => r.targetId === 'loan')).toMatchObject({ protocol: 'Lista DAO', network: 'ethereum', borrowApr: .08, supplyApr: 0, lltv: .8, liquidity: { amount: 750000, symbol: 'USDC', token: loan } });
  expect(result.find(r => r.market === vault)).toMatchObject({ targetId: 'deposit', supplyApr: .05, borrowApr: null, url: `https://lista.org/lending/vault/ethereum/${vault}` });
});
it.each([{ paused: true }, { whitelist: true }, { broker: true }, { badOracle: true }])('excludes inaccessible or invalid borrowing alternatives: %j', async options => {
  const f = fixture(options), result = await readListaMarkets(f.client, 'ethereum', 123n, f.targets, () => {});
  expect(result.filter(r => r.targetId === 'loan')).toEqual([]);
});
it('rejects unregistered vaults and records partial search coverage without fabricating an APR', async () => {
  const f = fixture({ wrongFactory: true }), warnings: string[] = [];
  const result = await readListaMarkets(f.client, 'ethereum', 123n, f.targets, m => warnings.push(m));
  expect(result.some(r => r.market === vault)).toBe(false); expect(warnings.length).toBeGreaterThan(0);
  mocks.vault.mockResolvedValueOnce({ apr: null });
  const next = fixture(); const incomplete = await readListaMarkets(next.client, 'ethereum', 123n, next.targets, m => warnings.push(m));
  expect(incomplete.some(r => r.market === vault)).toBe(false);
});
