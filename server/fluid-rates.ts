import { decodeFunctionResult, encodeFunctionData, encodeFunctionResult, parseAbi, type Address } from 'viem';
import type { Asset, InterestRate } from '../src/types.js';
import type { ChainClient } from './rpc.js';
import { rate, unavailableRate } from './rates.js';
import { fluidDexRatesAbi, fluidLegacyLendingRatesAbi } from './abis/fluid-rates.js';
const modernLendingAbi = parseAbi(['function getFTokenRewards(address fToken) view returns (address model,uint256 relativeModelRate,int256 staticModelRate,bool isStaticRate,uint256 liquidityRate,uint256 totalRate,bool rewardsActive)']);
export async function fluidLendingRate(client: ChainClient, resolver: Address, fToken: Address, blockNumber: bigint): Promise<InterestRate> {
  try {
    const data = await client.readContract({ address: resolver, abi: modernLendingAbi, functionName: 'getFTokenRewards', args: [fToken], blockNumber });
    if (typeof data[5] !== 'bigint' || typeof data[6] !== 'boolean') throw new Error('Unrecognized lending-rate response');
    return rate(Number(data[5]) / 10000, 'Current Fluid holder APR, including the active underlying-token streaming/static rate adjustment. Excludes external reward tokens.');
  } catch { /* Older deployed resolvers expose different units and tuple layouts. */ }
  try {
    const response = await client.call({ to: resolver, data: encodeFunctionData({ abi: fluidLegacyLendingRatesAbi, functionName: 'getFTokenDetails', args: [fToken] }), blockNumber });
    if (!response.data) throw new Error('Missing lending rate');
    const details = decodeFunctionResult({ abi: fluidLegacyLendingRatesAbi, functionName: 'getFTokenDetails', data: response.data });
    // Refuse to interpret an upgraded layout using old field positions or units.
    if (encodeFunctionResult({ abi: fluidLegacyLendingRatesAbi, functionName: 'getFTokenDetails', result: details }).toLowerCase() !== response.data.toLowerCase()) throw new Error('Different resolver layout');
    return rate(Number(details.supplyRate) / 10000 + Number(details.rewardsRate) / 1e14, 'Current Fluid lending APR including the underlying-token streaming bonus. Legacy bonus units are converted separately from liquidity-rate units.');
  } catch { return unavailableRate(); }
}

export async function applyFluidRates(client: ChainClient, dexResolver: Address, blockNumber: bigint, vault: {
  vault: Address; isSmartCol: boolean; isSmartDebt: boolean;
  constantVariables: { supply: Address; borrow: Address };
  exchangePricesAndRates: { supplyRateVault: bigint; borrowRateVault: bigint };
}, supply: Asset[], debt: Asset[]) {
  await Promise.all(([['supplied', supply], ['borrowed', debt]] as const).map(async ([side, assets]) => {
    const smart = side === 'supplied' ? vault.isSmartCol : vault.isSmartDebt;
    const field = side === 'supplied' ? 'supplyRate' : 'borrowRate';
    try {
      const raw = vault.exchangePricesAndRates[side === 'supplied' ? 'supplyRateVault' : 'borrowRateVault'];
      if (typeof raw !== 'bigint') throw new Error('Missing vault rate');
      const adjustment = Number(raw) / 10000;
      if (!smart) {
        assets.forEach(asset => { asset[field] = rate(adjustment, 'Current Fluid vault APR after the vault’s rate magnifier/fee adjustment.'); });
      } else if (assets.length) {
        const data = side === 'supplied'
          ? await client.readContract({ address: dexResolver, abi: fluidDexRatesAbi, functionName: 'getUserSupplyData', args: [vault.constantVariables.supply, vault.vault], blockNumber })
          : await client.readContract({ address: dexResolver, abi: fluidDexRatesAbi, functionName: 'getUserBorrowData', args: [vault.constantVariables.borrow, vault.vault], blockNumber });
        assets.forEach((asset, i) => {
          const token = i === 0 ? data.liquidityTokenData0 : data.liquidityTokenData1;
          const user = side === 'supplied'
            ? ('liquidityUserSupplyDataToken0' in data ? (i === 0 ? data.liquidityUserSupplyDataToken0 : data.liquidityUserSupplyDataToken1) : null)
            : ('liquidityUserBorrowDataToken0' in data ? (i === 0 ? data.liquidityUserBorrowDataToken0 : data.liquidityUserBorrowDataToken1) : null);
          const liquidityRate = side === 'supplied' ? token.supplyRate : token.borrowRate;
          if (!user || typeof liquidityRate !== 'bigint') throw new Error('Missing smart-pool rate');
          const base = user.modeWithInterest ? Number(liquidityRate) / 10000 : 0;
          asset[field] = rate(base + adjustment, 'Current per-token interest component plus the vault’s signed fee/reward adjustment. Excludes pool trading income, which cannot be determined from an instant snapshot.', true);
        });
      }
    } catch { assets.forEach(asset => { asset[field] = unavailableRate(); }); }
  }));
}
