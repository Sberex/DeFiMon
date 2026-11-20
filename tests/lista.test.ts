import { expect, it } from 'vitest';
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, keccak256, parseAbiParameters, type Address } from 'viem';
import type { MorphoDiscovery } from '../server/morpho-discovery';
import { readLista } from '../server/adapters/lista';
import { createListaCatalog, listaDiscovery } from '../server/lista';
import { listaDeployments } from '../server/deployments/lista';
import { morphoCoreAbi as core, morphoMulticallAbi as multi, morphoIrmAbi as irm } from '../server/abis/morpho';
import { positionMonthlyInterest, annualizedNplApr } from '../src/monthly-interest';
import { badDebtReasons } from '../src/risk-assessment';
import { recommendationPositions } from '../src/recommendations';
import { positionLinks } from '../src/position-links';
import type { ChainClient } from '../server/rpc';
const wallet = '0x1111111111111111111111111111111111111111', loan = '0x2222222222222222222222222222222222222222', col = '0x3333333333333333333333333333333333333333', oracle = '0x4444444444444444444444444444444444444444', model = '0x5555555555555555555555555555555555555555', vault = '0x6666666666666666666666666666666666666666';
const E6 = 10n ** 6n, E18 = 10n ** 18n;
function fixture(network: 'bsc' | 'ethereum', options: { deposit?: boolean; vault?: boolean; failOracle?: boolean; wrongFactory?: boolean; failRate?: boolean; legacy?: boolean } = {}) {
  const deployment = listaDeployments[network]!;
  const underlying = options.legacy ? '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as const : loan;
  const vaultAddress = options.legacy ? '0x9651ae50a5763c6f9b883f9d50e8116281cfcab2' as const : vault;
  const params = { loanToken: underlying, collateralToken: col, oracle, irm: model, lltv: 800000000000000000n } as const;
  const id = keccak256(encodeAbiParameters(parseAbiParameters('address,address,address,address,uint256'), [underlying, col, oracle, model, params.lltv]));
  const state = { totalSupplyAssets: 10000n * E6, totalSupplyShares: 10000n * E6 * E6, totalBorrowAssets: 5000n * E6, totalBorrowShares: 5000n * E6 * E6, lastUpdate: 123n, fee: E18 / 10n };
  const token = (address: Address) => ({ address, symbol: address === underlying ? 'USDC' : 'WBNB', decimals: address === underlying ? 6 : 18, priceUsd: address === underlying ? 1 : 600 });
  const discovery = async (): Promise<MorphoDiscovery> => ({ markets: options.vault ? [] : [{ id, loan: token(underlying), collateral: token(col) }], vaults: options.vault ? [{ address: vaultAddress, name: 'Lista USDC Earn', asset: token(underlying), factory: deployment.factory, version: 1 as const }] : [], successfulFamilies: 2, holdingsComplete: true, warnings: [] });
  const client = {
    readContract: async ({ address, functionName, args, blockNumber }: any) => {
      expect(blockNumber).toBe(123n);
      switch (functionName) {
        case 'idToMarketParams': expect(address).toBe(deployment.core); return params;
        case 'getPrice': expect(address).toBe(deployment.core); expect(args[0]).toEqual(params); if (options.failOracle) throw new Error('private-rpc-details'); return 600n * 10n ** 24n;
        case 'isMoolahVault': expect(address).toBe(deployment.factory); return options.legacy ? false : !options.wrongFactory;
        case 'MOOLAH': return deployment.core;
        case 'MORPHO': case 'isMetaMorpho': case 'price': throw new Error('Wrong protocol interface');
        case 'asset': return underlying;
        case 'balanceOf': return 500n * E18;
        case 'convertToAssets': return 500n * E6;
        case 'totalAssets': return 1000n * E6;
        case 'withdrawQueueLength': return 1n;
        case 'withdrawQueue': return id;
        case 'fee': return E18 / 10n;
        case 'position': return { supplyShares: 1000n * E6 * E6, borrowShares: 0n, collateral: 0n };
        case 'symbol': return address === underlying ? 'USDC' : 'WBNB';
        case 'decimals': return address === underlying ? 6 : 18;
      }
      throw new Error(`Unexpected fixture method: ${functionName}`);
    },
    call: async ({ data, blockNumber }: any) => {
      expect(blockNumber).toBe(123n);
      const calls = decodeFunctionData({ abi: multi, data }).args![0];
      const returnData = calls.map(c => {
        if (c.target.toLowerCase() === model.toLowerCase()) {
          if (options.failRate) throw new Error('private-rpc-details');
          return { success: true, returnData: encodeFunctionResult({ abi: irm, functionName: 'borrowRateView', result: 10n ** 17n / 31536000n }) };
        }
        expect(c.target.toLowerCase()).toBe(deployment.core.toLowerCase());
        const decoded = decodeFunctionData({ abi: core, data: c.callData });
        const result = decoded.functionName === 'accrueInterest' ? '0x' as const : decoded.functionName === 'market' ? encodeFunctionResult({ abi: core, functionName: 'market', result: state }) : encodeFunctionResult({ abi: core, functionName: 'position', result: { supplyShares: options.deposit ? 100n * E6 * E6 : 0n, borrowShares: options.deposit ? 0n : 200n * E6 * E6, collateral: options.deposit ? 0n : E18 } });
        return { success: true, returnData: result };
      });
      return { data: encodeFunctionResult({ abi: multi, functionName: 'aggregate3', result: returnData }) };
    },
  } as unknown as ChainClient;
  return { client, discovery, id };
}
it.each(['bsc', 'ethereum'] as const)('uses Lista native collateral valuation, current interest and market links on %s', async network => {
  const f = fixture(network), result = await readLista(f.client, wallet, 123n, network, f.discovery), p = result.positions[0];
  expect(result).toMatchObject({ id: 'lista', name: 'Lista DAO', status: 'ok' });
  expect(p.id).toBe(`lista-market-${f.id}`); expect(p.healthFactor).toBeCloseTo(2.4);
  expect(p.suppliedUsd).toBe(600); expect(p.debtUsd).toBe(200);
  expect(p.assets[0].borrowRate?.apr).toBeCloseTo(.1); expect(p.assets[1].supplyRate?.apr).toBe(0);
  expect(positionMonthlyInterest(p).nplUsd).toBeCloseTo(-200 * .1 / 12);
  expect(positionLinks('lista', network === 'bsc' ? 'Binance Smart Chain' : 'Ethereum', p)[0].url).toContain(`/market/${network}/${f.id}`);
});
it('converts Lista Earn shares once and applies fee-adjusted allocation APR to monthly earnings', async () => {
  const f = fixture('bsc', { vault: true }), result = await readLista(f.client, wallet, 123n, 'bsc', f.discovery), p = result.positions[0];
  expect(p).toMatchObject({ depositOnly: true, suppliedUsd: 500, debtUsd: 0, receiptTokens: [vault] });
  expect(p.assets[0].supplyRate?.apr).toBeCloseTo(.1 * .5 * .9 * .9);
  expect(positionMonthlyInterest(p).nplUsd).toBeCloseTo(500 * .0405 / 12);
  expect(annualizedNplApr(positionMonthlyInterest(p).nplUsd, p.suppliedUsd)).toBeCloseTo(.0405);
  expect(recommendationPositions([result])[0]).toMatchObject({ vault: true, deposit: true });
});
it('renders direct Lista lending as a loan-token deposit without inventing wallet collateral or debt', async () => {
  const f = fixture('ethereum', { deposit: true }), result = await readLista(f.client, wallet, 123n, 'ethereum', f.discovery), p = result.positions[0];
  expect(p).toMatchObject({ depositOnly: true, suppliedUsd: 100, debtUsd: 0 });
  expect(p.assets).toHaveLength(1); expect(p.assets[0].symbol).toBe('USDC');
  expect(positionMonthlyInterest(p).nplUsd).toBeCloseTo(100 * .045 / 12);
});
it('preserves unknown rates and rejects unregistered vaults without leaking provider details', async () => {
  const f = fixture('bsc', { failRate: true }), p = (await readLista(f.client, wallet, 123n, 'bsc', f.discovery)).positions[0];
  expect(p.debtUsd).toBe(200); expect(p.assets[0].borrowRate?.apr).toBeNull(); expect(positionMonthlyInterest(p).nplUsd).toBeNull();
  const bad = fixture('ethereum', { vault: true, wrongFactory: true }), r = await readLista(bad.client, wallet, 123n, 'ethereum', bad.discovery);
  expect(r.status).toBe('partial'); expect(r.positions[0].suppliedUsd).toBeNull(); expect(JSON.stringify(r)).not.toContain('private-rpc-details');
});
it('uses Lista oracle failures for risk assessment without reporting a healthy priced loan', async () => {
  const f = fixture('bsc', { failOracle: true }), r = await readLista(f.client, wallet, 123n, 'bsc', f.discovery);
  expect(r.positions[0].healthFactor).toBeNull(); expect(badDebtReasons('lista', r.positions[0])).toEqual(['WBNB collateral oracle could not return a price.']);
});
const marketId = (i: number) => `0x${String(i).padStart(64, '0')}`;
it('paginates and caches the official catalog by chain without trusting API APYs or balances', async () => {
  const calls: string[] = [];
  const load = createListaCatalog((async input => {
    const url = new URL(String(input)); calls.push(url.toString()); const markets = url.pathname.endsWith('/markets'), page = Number(url.searchParams.get('page'));
    return new Response(JSON.stringify({ code: '000000000', data: { total: markets ? 51 : 1, list: markets ? Array.from({ length: page === 1 ? 50 : 1 }, (_, i) => ({ id: marketId((page - 1) * 50 + i + 1), chain: 'bsc', rate: '9999' })) : [{ address: vault, name: 'Lista vault', asset: loan, chain: 'bsc' }] } }));
  }) as typeof fetch);
  const result = await load('bsc'); expect(result.markets).toHaveLength(51); expect(result.vaults).toHaveLength(1); await load('bsc'); expect(calls).toHaveLength(3); expect(calls.every(c => c.includes('chain=bsc') && !c.includes(wallet))).toBe(true);
});
it.each(['wrong-chain', 'duplicate', 'incomplete', 'http-error'])('rejects %s catalog results and retries failures instead of caching a false empty account', async mode => {
  let calls = 0;
  const load = createListaCatalog((async () => { calls++; return mode === 'http-error' ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ code: '000000000', data: { total: 2, list: mode === 'incomplete' ? [] : [{ id: marketId(1), address: vault, asset: loan, name: 'vault', chain: mode === 'wrong-chain' ? 'ethereum' : 'bsc' }, { id: marketId(1), address: vault, asset: loan, name: 'vault', chain: 'bsc' }] } })); }) as typeof fetch);
  await expect(load('bsc')).rejects.toThrow(); const first = calls; await expect(load('bsc')).rejects.toThrow(); expect(calls).toBeGreaterThan(first);
});
it('keeps an unreadable Lista balance unknown and records incomplete holdings discovery', async () => {
  const client = { multicall: async () => [{ status: 'failure', error: new Error('private-rpc-details') }] } as unknown as ChainClient;
  const d = await listaDiscovery(client, wallet, 123n, 'bsc', async () => ({ markets: [marketId(1) as `0x${string}`], vaults: [] }));
  expect(d.holdingsComplete).toBe(false); expect(d.warnings.length).toBeGreaterThan(0); expect(JSON.stringify(d)).not.toContain('private-rpc-details');
});

it('recognizes only the exact pinned legacy vault network and underlying asset', async () => {
  const { isLegacyListaVault } = await import('../server/deployments/lista');
  const address = '0x9651ae50a5763c6f9b883f9d50e8116281cfcab2', underlying = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  expect(isLegacyListaVault('ethereum', address, underlying)).toBe(true);
  expect(isLegacyListaVault('bsc', address, underlying)).toBe(false);
  expect(isLegacyListaVault('ethereum', address, loan)).toBe(false);
});

it('values pinned pre-factory Ethereum savings vaults with the same share and fee math', async () => {
  const f = fixture('ethereum', { vault: true, legacy: true });
  const r = await readLista(f.client, wallet, 123n, 'ethereum', f.discovery);
  expect(r.status).toBe('ok'); expect(r.positions[0].suppliedUsd).toBe(500);
  expect(r.positions[0].assets[0].supplyRate?.apr).toBeCloseTo(.0405);
});
it('keeps broker-managed debt incomplete instead of reporting only the core principal', async () => {
  const id = marketId(1) as `0x${string}`;
  const client = { multicall: async () => [{ status: 'success', result: { supplyShares: 0n, borrowShares: 1n, collateral: 1n } }], readContract: async ({ functionName }: any) => functionName === 'brokers' ? vault : { loanToken: loan, collateralToken: col } } as unknown as ChainClient;
  const result = await listaDiscovery(client, wallet, 123n, 'bsc', async () => ({ markets: [id], vaults: [] }));
  expect(result.holdingsComplete).toBe(false); expect(result.markets).toEqual([]);
  expect(result.warnings.join(' ')).toContain('broker interest');
});
