import { describe, expect, it } from 'vitest';
import { readFluid, fluidHealth, FLUID_VAULT_RESOLVER } from '../server/adapters/fluid';
import { networks } from '../server/networks';
import type { ChainClient } from '../server/rpc';
const wallet = '0x1111111111111111111111111111111111111111';
const ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const USDC = '0x2222222222222222222222222222222222222222';
const USDT = '0x3333333333333333333333333333333333333333';
const FUSDC = '0x4444444444444444444444444444444444444444';
const ZERO = '0x0000000000000000000000000000000000000000';
const POOL = '0x5555555555555555555555555555555555555555';
const E18 = 10n ** 18n;
const E6 = 10n ** 6n;
const position = (id: bigint, type = 10000n) => {
  const smartCol = type === 20000n || type === 40000n;
  const smartDebt = type === 30000n || type === 40000n;
  return [
    { nftId: id, owner: wallet, isLiquidated: false, isSupplyPosition: false, supply: smartCol ? 4n * E18 : 10n * E18, borrow: smartDebt ? (smartCol ? E18 : 2n * E18) : (smartCol ? 12000n : 15000n) * E6, beforeSupply: 100n * E18, beforeBorrow: 100000n * E6 },
    { vault: POOL, isSmartCol: smartCol, isSmartDebt: smartDebt, constantVariables: { vaultType: type, vaultId: 11n, supply: POOL, borrow: POOL, supplyToken: { token0: ETH, token1: smartCol ? USDC : ZERO }, borrowToken: { token0: USDC, token1: smartDebt ? USDT : ZERO } }, exchangePricesAndRates: { supplyRateVault: 300n, borrowRateVault: 500n }, configs: { collateralFactor: 7000, liquidationThreshold: smartCol ? 8000 : 8500, oraclePriceLiquidate: smartDebt ? (smartCol ? 6n * 10n ** 26n : 3n * 10n ** 26n) : (smartCol ? 6n : 3n) * E18 } },
  ] as const;
};
function mock(options: { types?: bigint[]; ids?: bigint[]; lending?: boolean; missingEthPrice?: boolean; missingDebtPrice?: boolean; failNft?: bigint; failDiscovery?: 'vault' | 'lending' | 'both'; zeroReserves?: boolean; zeroOracle?: boolean; liquidated?: boolean; closed?: boolean; sameToken?: boolean; chainlink?: boolean; staleRound?: boolean } = {}) {
  const blocks: bigint[] = [];
  const calls: string[] = [];
  const contracts: { address: string; functionName: string; args: any[] }[] = [];
  let poolReads = 0;
  const client = {
    simulateContract: async ({ blockNumber, address }: { blockNumber: bigint; address: string }) => {
      blocks.push(blockNumber); poolReads++; contracts.push({ address, functionName: 'getDexState', args: [] });
      return { result: { token0PerSupplyShare: options.zeroReserves ? 0n : E18, token1PerSupplyShare: options.zeroReserves ? 0n : 3000n * E6, token0PerBorrowShare: options.zeroReserves ? 0n : 5000n * E6, token1PerBorrowShare: options.zeroReserves ? 0n : 5000n * E6 } };
    },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => { blocks.push(blockNumber); return { timestamp: 200000n }; },
    readContract: async ({ functionName, args, blockNumber, address }: { functionName: string; args: any[]; blockNumber: bigint; address: string }) => {
      blocks.push(blockNumber); calls.push(functionName); contracts.push({ address, functionName, args });
      switch (functionName) {
        case 'positionsNftIdOfUser':
          if (options.failDiscovery === 'vault' || options.failDiscovery === 'both') throw new Error('secret RPC URL');
          return options.ids ?? (options.types ?? [10000n]).map((_, i) => BigInt(i + 1));
        case 'positionByNftId': {
          if (args[0] === options.failNft) throw new Error('secret RPC URL');
          const [p, v] = position(args[0], options.types?.[Number(args[0]) - 1]);
          return [{ ...p, isLiquidated: options.liquidated ?? false, ...(options.closed ? { supply: 0n, borrow: 0n } : {}) }, { ...v, configs: { ...v.configs, ...(options.zeroOracle ? { oraclePriceLiquidate: 0n } : {}) }, constantVariables: { ...v.constantVariables, ...(options.sameToken ? { borrowToken: { token0: ETH, token1: ZERO } } : {}) } }];
        }
        case 'getAllFTokens':
          if (options.failDiscovery === 'lending' || options.failDiscovery === 'both') throw new Error('secret RPC URL');
          return options.lending ? [FUSDC] : [];
        case 'getPriceOracle': return POOL;
        case 'BASE_CURRENCY_UNIT': return 100000000n;
        case 'getAssetPrice': {
          const xpl = args[0].toLowerCase() === networks.plasma.wrappedNative.toLowerCase();
          if (xpl) return options.missingEthPrice ? 0n : 50000000n;
          const eth = args[0].toLowerCase() === '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' || args[0].toLowerCase() === networks.arbitrum.wrappedNative.toLowerCase();
          return eth ? (options.missingEthPrice ? 0n : 3000n * 100000000n) : (options.missingDebtPrice ? 0n : 100000000n);
        }
        case 'latestRoundData': if (options.chainlink) return [10n, 100000000n, 199000n, options.staleRound ? 1000n : 199900n, 10n]; else throw new Error('No feed');
        case 'decimals': return args?.length ? 8 : address === ETH ? 18 : 6;
        case 'symbol': return address === USDC ? 'USDC' : 'USDT';
        case 'balanceOf': return 2n * E18;
        case 'asset': return USDC;
        case 'convertToAssets': return 100n * E6;
        default: throw new Error(functionName);
      }
    },
  } as unknown as ChainClient;
  return { client, blocks, calls, contracts, get poolReads() { return poolReads; } };
}
describe('Fluid vaults', () => {
  it('uses current balances, token decimals, liquidation oracle, and LT instead of borrowing limit', async () => {
    const m = mock(); const result = await readFluid(m.client, wallet, 123n); const p = result.positions[0];
    expect(result.status).toBe('ok');
    expect(p.suppliedUsd).toBe(30000); expect(p.debtUsd).toBe(15000);
    expect(p.assets[0].symbol).toBe('ETH'); expect(p.assets[0].supplied).toBe(10);
    expect(p.healthFactor).toBeCloseTo(1.7); expect(p.risk).toBe('lower');
    expect(p.assets[0].supplyRate?.apr).toBe(0.03); expect(p.assets.find(a => a.borrowed > 0)?.borrowRate?.apr).toBe(0.05);
    expect(p.assets[0].liquidationPriceUsd).toBeCloseTo(1764.705882);
    expect(p.liquidationQuote?.current).toBeCloseTo(3000);
    expect(p.liquidationQuote?.threshold).toBeCloseTo(1764.705882);
    expect(m.blocks.every(block => block === 123n)).toBe(true);
  });
  it('expands T2/T3/T4 shares, merges shared assets, and shows native ratio boundaries', async () => {
    const m = mock({ types: [20000n, 30000n, 40000n] });
    const result = await readFluid(m.client, wallet, 123n);
    expect(result.status).toBe('ok');
    expect(result.positions.map(p => p.healthFactor)).toEqual([1.6, 1.275, 1.92]);
    const [t2, t3, t4] = result.positions;
    expect(t2.suppliedUsd).toBe(24000); expect(t2.debtUsd).toBe(12000);
    expect(t2.assets).toHaveLength(2);
    expect(t2.assets.find(a => a.symbol === 'USDC')).toMatchObject({ supplied: 12000, borrowed: 12000 });
    expect(t3.debtUsd).toBe(20000); expect(t4.debtUsd).toBe(10000);
    expect(t2.assets.every(a => a.liquidationPriceUsd === null)).toBe(true);
    expect(t2.liquidationQuote?.threshold).toBeCloseTo(3750);
    expect(t3.liquidationQuote?.unit).toBe('debt pool share per ETH');
    expect(t4.liquidationQuote?.current).toBeCloseTo(.6);
    expect(t4.liquidationQuote?.threshold).toBeCloseTo(.3125);
    expect(m.poolReads).toBe(1); // Shared pool is read once at the pinned block.
  });
  it('keeps other positions when one NFT cannot be read and does not leak provider errors', async () => {
    const { client } = mock({ types: [10000n, 10000n], failNft: 1n });
    const result = await readFluid(client, wallet, 123n);
    expect(result.status).toBe('partial'); expect(result.positions).toHaveLength(2);
    expect(result.positions[0]).toMatchObject({ suppliedUsd: null, debtUsd: null, risk: 'unknown' });
    expect(result.positions[1].suppliedUsd).toBe(30000);
    expect(JSON.stringify(result)).not.toContain('secret RPC URL');
  });
  it('does not turn a zero-reserve resolver failure into zero-valued smart collateral', async () => {
    const { client } = mock({ types: [20000n], zeroReserves: true });
    const result = await readFluid(client, wallet, 123n);
    expect(result.status).toBe('partial'); expect(result.positions[0].suppliedUsd).toBeNull();
    expect(result.positions[0].risk).toBe('unknown');
  });
  it('retains oracle health even when USD valuation is unavailable', async () => {
    const { client } = mock({ missingEthPrice: true }); const result = await readFluid(client, wallet, 123n);
    expect(result.status).toBe('partial'); expect(result.positions[0].suppliedUsd).toBeNull();
    expect(result.positions[0].assets[0].priceUsd).toBeNull();
    expect(result.positions[0].healthFactor).toBeCloseTo(1.7);
    expect(result.positions[0].assets[0].liquidationPriceUsd).toBeCloseTo(1764.705882);
  });
  it('does not assume stable debt is worth $1 when its USD feed is missing', async () => {
    const { client } = mock({ missingDebtPrice: true }); const result = await readFluid(client, wallet, 123n);
    expect(result.positions[0].debtUsd).toBeNull();
    expect(result.positions[0].assets[0].liquidationPriceUsd).toBeNull();
    expect(result.positions[0].liquidationQuote?.threshold).toBeCloseTo(1764.705882);
  });
  it('uses a verified Chainlink fallback for assets unavailable in Aave', async () => {
    const { client } = mock({ missingDebtPrice: true, chainlink: true }); const result = await readFluid(client, wallet, 123n);
    expect(result.status).toBe('ok'); expect(result.positions[0].debtUsd).toBe(15000);
  });
  it('rejects stale Chainlink fallback prices instead of assuming stablecoin parity', async () => {
    const { client } = mock({ missingDebtPrice: true, chainlink: true, staleRound: true });
    const result = await readFluid(client, wallet, 123n);
    expect(result.status).toBe('partial'); expect(result.positions[0].debtUsd).toBeNull();
    expect(result.positions[0].healthFactor).toBeCloseTo(1.7);
  });
  it('distinguishes unavailable liquidation data from no borrowing', async () => {
    const { client } = mock({ zeroOracle: true }); const result = await readFluid(client, wallet, 123n);
    expect(result.status).toBe('partial'); expect(result.positions[0].risk).toBe('unknown');
    expect(result.positions[0].healthFactor).toBeNull(); expect(result.positions[0].liquidationQuote).toBeUndefined();
  });
  it('uses residual balances after liquidation and omits empty/closed NFTs', async () => {
    const liquidated = await readFluid(mock({ liquidated: true }).client, wallet, 123n);
    expect(liquidated.positions[0].suppliedUsd).toBe(30000);
    expect(liquidated.positions[0].notes.join(' ')).toContain('previously been liquidated');
    expect((await readFluid(mock({ closed: true }).client, wallet, 123n)).positions).toHaveLength(0);
  });
  it('does not invent a dollar liquidation boundary for collateral and debt in the same token', async () => {
    const result = await readFluid(mock({ sameToken: true }).client, wallet, 123n);
    expect(result.positions[0].assets[0].liquidationPriceUsd).toBeNull();
  });
});
describe('Fluid lending and discovery', () => {
  it('converts fToken shares into underlying without double counting or inventing debt', async () => {
    const result = await readFluid(mock({ ids: [], lending: true }).client, wallet, 123n);
    expect(result.status).toBe('ok'); expect(result.positions).toHaveLength(1);
    expect(result.positions[0]).toMatchObject({ suppliedUsd: 100, debtUsd: 0, healthFactor: null, risk: 'no-debt' });
    expect(result.positions[0].assets[0]).toMatchObject({ supplied: 100, borrowed: 0, collateral: false });
  });
  it('keeps successful lending results when vault discovery fails', async () => {
    const result = await readFluid(mock({ failDiscovery: 'vault', lending: true }).client, wallet, 123n);
    expect(result.status).toBe('partial'); expect(result.message).toContain('vault discovery failed');
    expect(result.positions[0].suppliedUsd).toBe(100);
  });
  it('reports failure instead of an empty wallet if both discovery calls fail', async () => {
    await expect(readFluid(mock({ failDiscovery: 'both' }).client, wallet, 123n)).rejects.toThrow('Fluid discovery failed');
  });
  it('returns no positions only after successful discovery of an empty wallet', async () => {
    const result = await readFluid(mock({ ids: [] }).client, wallet, 123n);
    expect(result.status).toBe('ok'); expect(result.positions).toEqual([]);
  });
});
it('handles no debt and invalid oracle inputs without claiming known risk', () => {
  expect(fluidHealth(E18, 0n, E18, 8500)).toBeNull();
  expect(fluidHealth(E18, E6, 0n, 8500)).toBeNull();
  expect(fluidHealth(E18, E6, E18, 0)).toBeNull();
  expect(fluidHealth(E18, E6, E18, 10001)).toBeNull();
  expect(FLUID_VAULT_RESOLVER).toMatch(/^0x[a-fA-F0-9]{40}$/);
});

describe('Fluid on Plasma', () => {
  it('uses Plasma resolvers, XPL wrapping, and Plasma USD prices for vaults and lending', async () => {
    const m = mock({ lending: true, types: [10000n, 20000n] });
    const result = await readFluid(m.client, wallet, 9745n, 'plasma');
    expect(result.status).toBe('ok'); expect(result.coverage).toContain('Plasma');
    expect(result.positions[0].assets[0]).toMatchObject({ symbol: 'XPL', supplied: 10, priceUsd: 0.5 });
    expect(result.positions[0].suppliedUsd).toBe(5);
    expect(result.positions[0].healthFactor).toBeCloseTo(1.7); // Risk uses Fluid's ratio, not the independent USD value.
    expect(result.positions.at(-1)?.suppliedUsd).toBe(100);
    for (const [fn, address] of [['positionsNftIdOfUser', networks.plasma.fluid.vault], ['getDexState', networks.plasma.fluid.dex], ['getAllFTokens', networks.plasma.fluid.lending], ['getPriceOracle', networks.plasma.aaveProvider]]) {
      expect(m.contracts.filter(c => c.functionName === fn).every(c => c.address === address)).toBe(true);
      expect(m.contracts.some(c => c.functionName === fn)).toBe(true);
    }
    expect(m.contracts.some(c => c.functionName === 'getAssetPrice' && c.args[0] === networks.plasma.wrappedNative)).toBe(true);
    expect(m.blocks.every(b => b === 9745n)).toBe(true);
    expect(result.positions[0].notes.join(' ')).toContain('Plasma block');
  });
  it('keeps balances and risk with unknown prices and never calls the Ethereum Chainlink registry', async () => {
    const m = mock({ missingEthPrice: true, missingDebtPrice: true, chainlink: true });
    const result = await readFluid(m.client, wallet, 9745n, 'plasma');
    expect(result.status).toBe('partial'); expect(result.positions[0].suppliedUsd).toBeNull();
    expect(result.positions[0].debtUsd).toBeNull(); expect(result.positions[0].healthFactor).toBeCloseTo(1.7);
    expect(result.positions[0].assets[0].liquidationPriceUsd).toBeNull();
    expect(m.calls).not.toContain('latestRoundData');
    expect(m.contracts.some(c => c.address === networks.ethereum.chainlinkRegistry)).toBe(false);
    expect(m.contracts.some(c => c.address === networks.ethereum.aaveProvider)).toBe(false);
  });
});

it('values Plasma sUSDai collateral from the Fluid ratio and a non-$1 USDT0 price, restoring supplied and net values', async () => {
  const sUsdai = '0x0B2b2B2076d95dda7817e785989fE353fe955ef9';
  const usdt0 = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb';
  const base = mock();
  const client = { ...base.client, readContract: async (args: any) => {
    expect(args.blockNumber).toBe(123n);
    if (args.functionName === 'positionByNftId') {
      const [p, v] = position(3015n);
      return [{ ...p, nftId: 3015n, supply: 108366n * E18, borrow: 107213n * E6 }, { ...v, configs: { ...v.configs, liquidationThreshold: 9000, oraclePriceLiquidate: 11255n * 10n ** 11n }, constantVariables: { ...v.constantVariables, vaultId: 36n, supplyToken: { token0: sUsdai, token1: ZERO }, borrowToken: { token0: usdt0, token1: ZERO } } }];
    }
    if (args.functionName === 'symbol') return args.address === sUsdai ? 'sUSDai' : 'USDT0';
    if (args.functionName === 'decimals') return args.address === sUsdai ? 18 : 6;
    if (args.functionName === 'getAssetPrice') return args.args[0] === sUsdai ? 0n : 99900000n;
    return base.client.readContract(args);
  } } as unknown as ChainClient;
  const result = await readFluid(client, wallet, 123n, 'plasma');
  const p = result.positions[0];
  expect(p.label).toContain('Vault 36 · sUSDai / USDT0');
  expect(p.assets[0]).toMatchObject({ symbol: 'sUSDai', supplied: 108366, priceSource: 'fluid-oracle' });
  expect(p.assets[0].priceUsd).toBeCloseTo(1.1255 * 0.999, 10);
  expect(p.suppliedUsd).toBeCloseTo(108366 * 1.1255 * 0.999, 6);
  expect(p.debtUsd).toBeCloseTo(107213 * 0.999, 6);
  expect(p.suppliedUsd! - p.debtUsd!).toBeCloseTo((108366 * 1.1255 - 107213) * 0.999, 6);
  expect(p.healthFactor).toBeCloseTo(108366 * 1.1255 * 0.9 / 107213, 10);
  expect(p.assets[0].liquidationPriceUsd).toBeCloseTo(107213 / 108366 / 0.9 * 0.999, 10);
  expect(result.message).toContain('estimated from Fluid');
});

it('does not derive collateral prices from smart-pool ratios, a zero oracle, or a missing debt price', async () => {
  for (const options of [
    { missingEthPrice: true, zeroOracle: true },
    { missingEthPrice: true, missingDebtPrice: true },
    { missingEthPrice: true, types: [20000n] },
    { missingEthPrice: true, types: [30000n] },
  ]) {
    const result = await readFluid(mock(options).client, wallet, 123n, 'plasma');
    expect(result.positions[0].suppliedUsd).toBeNull();
    expect(result.positions[0].assets.some(a => a.priceSource === 'fluid-oracle')).toBe(false);
  }
  const result = await readFluid(mock().client, wallet, 123n, 'plasma');
  expect(result.positions[0].assets[0].priceUsd).toBe(0.5);
  expect(result.positions[0].assets[0].priceSource).toBeUndefined();
});

it('reads Fluid vaults, lending, and current rates through Arbitrum contracts and prices ETH as Arbitrum WETH', async () => {
  const m = mock({ lending: true, types: [10000n, 20000n] });
  const result = await readFluid(m.client, wallet, 42161n, 'arbitrum');
  expect(result.coverage).toContain('Arbitrum');
  expect(result.positions[0].assets[0]).toMatchObject({ symbol: 'ETH', supplied: 10, priceUsd: 3000 });
  expect(result.positions[0].assets[0].supplyRate?.apr).toBe(0.03);
  expect(result.positions[0].healthFactor).toBeCloseTo(1.7);
  expect(result.positions.at(-1)?.suppliedUsd).toBe(100);
  expect(m.contracts.find(c => c.functionName === 'positionsNftIdOfUser')?.address).toBe(networks.arbitrum.fluid.vault);
  expect(m.contracts.find(c => c.functionName === 'getDexState')?.address).toBe(networks.arbitrum.fluid.dex);
  expect(m.contracts.find(c => c.functionName === 'getPriceOracle')?.address).toBe(networks.arbitrum.aaveProvider);
  expect(m.contracts.some(c => c.functionName === 'getAssetPrice' && c.args[0] === networks.arbitrum.wrappedNative)).toBe(true);
  expect(m.contracts.some(c => c.address === networks.ethereum.aaveProvider)).toBe(false);
  expect(m.blocks.every(block => block === 42161n)).toBe(true);
});

it('exposes vault LLTV for all collateral legs including no-debt and smart pools', async () => {
  const simple = mock({ closed: false, lending: true });
  const p = (await readFluid(simple.client, wallet, 123n)).positions;
  expect(p[0].assets.filter(a => a.collateral).every(a => a.liquidationThreshold === .85)).toBe(true);
  expect(p.find(p => p.id.startsWith('fluid-lending'))!.assets[0].liquidationThreshold).toBeNull();
  const smart = mock({ types: [20000n] });
  const vault = (await readFluid(smart.client, wallet, 123n)).positions[0];
  expect(vault.liquidationModel).toBe('oracle-ratio');
  expect(vault.assets.filter(a => a.collateral).every(a => a.liquidationThreshold === .8)).toBe(true);
});
