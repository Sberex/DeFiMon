import { afterEach, expect, it, vi } from 'vitest';
import type { ChainClient } from '../server/rpc';
import { expandTargets } from '../server/market-readers';
import { readV4Markets } from '../server/market-v4';
import { readFluidMarkets } from '../server/market-fluid';
import { readMorphoMarkets } from '../server/market-morpho';
const supply = '0x1111111111111111111111111111111111111111', debt = '0x2222222222222222222222222222222222222222';
const other = '0x3333333333333333333333333333333333333333', vault = '0x4444444444444444444444444444444444444444';
const baseTarget = { id: 'pair', network: 'ethereum' as const, supplied: supply, borrowed: debt };
vi.mock('../server/aave-v4-rates', () => ({ readV4HubRates: async () => ({ baseApr: .04, supplyRate: { apr: .02, note: '' }, index: 1n }) }));
vi.mock('../server/fluid-rates', () => ({ fluidLendingRate: async () => ({ apr: .06 }), applyFluidRates: async (_client: unknown, _dex: unknown, _block: unknown, _vault: unknown, supplied: any[], borrowed: any[]) => { supplied.forEach((a, i) => a.supplyRate = { apr: .01 + i * .01 }); borrowed.forEach((a, i) => a.borrowRate = { apr: .03 + i * .01 }); } }));
vi.mock('../server/morpho-rates', () => ({ createMorphoRates: () => ({ marketQuote: async () => ({ params: { collateralToken: supply, loanToken: debt, lltv: 800000000000000000n }, state: { totalSupplyAssets: 100n, totalBorrowAssets: 50n }, apr: .02, borrowApr: .03 }), vault: async () => ({ apr: .07 }) }) }));
afterEach(() => vi.unstubAllGlobals());
it('Aave v4 includes single-collateral risk premium and rejects paused or non-borrowable reserves', async () => {
  let flags = 4;
  const client = { readContract: async ({ functionName, args }: any) => {
    if (functionName === 'getReserveCount') return 2n;
    if (functionName === 'getReserve') return { underlying: args[0] === 0n ? supply : debt, hub: vault, assetId: Number(args[0]), flags, collateralRisk: 1000, dynamicConfigKey: 0 };
    if (functionName === 'getDynamicReserveConfig') return { collateralFactor: 8000 };
    throw new Error('Unexpected read');
  } } as unknown as ChainClient;
  const target = expandTargets([baseTarget], 'ethereum');
  const result = await readV4Markets(client, 'ethereum', 100n, target, () => {});
  expect(result.length).toBeGreaterThan(0); expect(result[0].borrowApr).toBeCloseTo(.044);
  flags = 5; expect(await readV4Markets(client, 'ethereum', 100n, target, () => {})).toEqual([]);
  flags = 0; expect(await readV4Markets(client, 'ethereum', 100n, target, () => {})).toEqual([]);
});
it('Fluid smart vaults require the entire source basket and select the correct token component rate', async () => {
  const client = { readContract: async ({ functionName }: any) => {
    if (functionName === 'decimals') return 6;
    if (functionName === 'symbol') return 'USDT';
    if (functionName === 'getAllVaultsAddresses') return [vault];
    if (functionName === 'getVaultEntireData') return { vault, isSmartCol: true, isSmartDebt: false, constantVariables: { vaultId: 10n, supply: vault, borrow: vault, supplyToken: { token0: other, token1: supply }, borrowToken: { token0: debt } }, configs: { collateralFactor: 8000, liquidationThreshold: 8500 }, limitsAndAvailability: { borrowable: 700000000n }, exchangePricesAndRates: { supplyRateVault: 0n, borrowRateVault: 0n } };
    throw new Error('Unexpected read');
  } } as unknown as ChainClient;
  expect(await readFluidMarkets(client, 'ethereum', 100n, expandTargets([baseTarget], 'ethereum'), () => {})).toEqual([]);
  const result = await readFluidMarkets(client, 'ethereum', 100n, expandTargets([{ ...baseTarget, supplyBasket: [supply, other], borrowBasket: [debt] }], 'ethereum'), () => {});
  expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ url: 'https://fluid.io/1/borrowing/vaults/10', supplyApr: .02, borrowApr: .03, lltv: .85, liquidity: { amount: 700, symbol: 'USDT', token: debt } });
});
it('Morpho vault searches survive a failed direct-market query and reject wrong-asset metadata', async () => {
  vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => {
    const query = JSON.parse(String(options.body)).query;
    if (query.includes(' markets(')) return new Response('{}', { status: 503 });
    const field = query.includes('vaultV2s(') ? 'vaultV2s' : 'vaults';
    return new Response(JSON.stringify({ data: { [field]: { items: [{ address: vault, name: 'Higher yield', factory: { address: other }, asset: { address: supply } }, { address: other, name: 'Wrong token', factory: { address: other }, asset: { address: debt } }], pageInfo: { count: 2, countTotal: 2, skip: 0, limit: 100 } } } }));
  });
  const client = { readContract: async () => true } as unknown as ChainClient;
  const warnings: string[] = [];
  const result = await readMorphoMarkets(client, 'ethereum', 100n, expandTargets([{ id: 'deposit', network: 'ethereum', supplied: supply }], 'ethereum'), m => warnings.push(m));
  expect(result).toHaveLength(2); expect(result.every(c => c.supplyApr === .07 && c.borrowApr === null)).toBe(true);
  expect(warnings.some(w => w.includes('direct-market discovery'))).toBe(true);
});
it('Morpho reports accrued supply minus borrow as total liquidity and retains rates if liquidity metadata fails', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { markets: { items: [{ uniqueKey: `0x${'ab'.repeat(32)}` }], pageInfo: { count: 1, countTotal: 1, skip: 0, limit: 100 } } } })));
  let failed = false;
  const client = { readContract: async ({ functionName }: any) => {
    if (failed) throw new Error('secret-provider');
    if (functionName === 'decimals') return 6;
    if (functionName === 'symbol') return 'USDC';
    throw new Error('Unexpected read');
  } } as unknown as ChainClient;
  const target = expandTargets([baseTarget], 'ethereum');
  const rows = await readMorphoMarkets(client, 'ethereum', 100n, target, () => {});
  expect(rows).toHaveLength(1); expect(rows[0].liquidity).toMatchObject({ amount: .00005, symbol: 'USDC', token: debt });
  expect(rows[0].liquidity?.note).toContain('minus accrued borrowed');
  failed = true;
  const unknown = await readMorphoMarkets(client, 'ethereum', 100n, target, () => {});
  expect(unknown).toHaveLength(1); expect(unknown[0].borrowApr).toBe(.03); expect(unknown[0].liquidity).toBeNull();
});
it('skips same-two-token Fluid smart vault alternatives before reading rates or liquidity', async () => {
  const functions: string[] = [];
  const client = { readContract: async ({ functionName }: any) => {
    functions.push(functionName);
    if (functionName === 'getAllVaultsAddresses') return [vault];
    if (functionName === 'getVaultEntireData') return { vault, isSmartCol: true, isSmartDebt: true, constantVariables: { supplyToken: { token0: supply, token1: debt }, borrowToken: { token0: debt, token1: supply } } };
    throw new Error('Excluded vault must not trigger more calls');
  } } as unknown as ChainClient;
  const warnings: string[] = [];
  const result = await readFluidMarkets(client, 'ethereum', 100n, expandTargets([{ ...baseTarget, supplyBasket: [supply, debt], borrowBasket: [debt, supply] }], 'ethereum'), m => warnings.push(m));
  expect(result).toEqual([]); expect(warnings).toEqual([]);
  expect(functions).toEqual(['getAllVaultsAddresses', 'getVaultEntireData']);
});

it('wildcard Morpho discovery omits only the unrestricted API filter, retains exact native contracts and rejects failed oracles',async()=>{
 const queries:string[]=[];
 vi.stubGlobal('fetch',async(_url:string,options:RequestInit)=>{queries.push(JSON.parse(String(options.body)).query);return new Response(JSON.stringify({data:{markets:{items:[{uniqueKey:`0x${'ab'.repeat(32)}`}],pageInfo:{count:1,countTotal:1,skip:0,limit:100}}}}));});
 let price=1n;
 const client={readContract:async({functionName}:any)=>functionName==='price'?price:functionName==='decimals'?6:'USDC'} as unknown as ChainClient;
 const t={...expandTargets([baseTarget],'ethereum')[0],discovery:true,anySupply:true,supplies:[]};
 const rows=await readMorphoMarkets(client,'ethereum',100n,[t],()=>{});expect(rows[0].marketTokens).toEqual({supplied:supply,borrowed:debt});
 expect(queries[0]).not.toContain('collateralAssetAddress_in');expect(queries[0]).toContain('loanAssetAddress_in');
 price=0n;expect(await readMorphoMarkets(client,'ethereum',100n,[t],()=>{})).toEqual([]);
});
it('Fluid discovery exposes matching components plus the entire required pool basket',async()=>{
 const client={readContract:async({functionName}:any)=>{
  if(functionName==='decimals')return 6;if(functionName==='symbol')return 'USDT';if(functionName==='getAllVaultsAddresses')return [vault];
  if(functionName==='getVaultEntireData')return {vault,isSmartCol:true,isSmartDebt:false,constantVariables:{vaultId:10n,supply:vault,borrow:vault,supplyToken:{token0:other,token1:supply},borrowToken:{token0:debt}},configs:{collateralFactor:8000,liquidationThreshold:8500},limitsAndAvailability:{borrowable:700000000n},exchangePricesAndRates:{supplyRateVault:0n,borrowRateVault:0n}};
  throw Error('Unexpected read');
 }} as unknown as ChainClient;
 const t={...expandTargets([baseTarget],'ethereum')[0],discovery:true,anyBorrow:true,borrows:[]};
 const rows=await readFluidMarkets(client,'ethereum',100n,[t],()=>{});
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({marketTokens:{supplied:supply,borrowed:debt},requiredTokens:{supplied:[other,supply],borrowed:[debt]},url:'https://fluid.io/1/borrowing/vaults/10',supplyApr:.02,borrowApr:.03});
});
