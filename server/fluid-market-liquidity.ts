import type { Address } from 'viem';
import type { NetworkId } from '../src/types.js';
import type { MarketLiquidity } from '../src/market-comparison.js';
import type { ChainClient } from './rpc.js';
import { networks } from './networks.js';
import { fluidLiquidityAbi } from './abis/fluid-market-liquidity.js';
import { liquidityQuote, minimum, remaining, tokenMetadata } from './market-liquidity.js';
import { normalizeMarketToken } from './market-tokens.js';
export interface FluidLiquidityInput { isSmartDebt: boolean; constantVariables: { borrow: Address; borrowToken: { token0: Address; token1: Address } }; limitsAndAvailability: { borrowable: bigint } }
export async function fluidMarketLiquidity(client: ChainClient, network: NetworkId, blockNumber: bigint, vault: FluidLiquidityInput): Promise<Map<string, MarketLiquidity>> {
  const result = new Map<string, MarketLiquidity>();
  try {
    const rawTokens = [vault.constantVariables.borrowToken.token0, ...(vault.isSmartDebt ? [vault.constantVariables.borrowToken.token1] : [])];
    const tokens = rawTokens.map(a => normalizeMarketToken(a, network) as Address);
    let amounts = [vault.limitsAndAvailability.borrowable];
    if (vault.isSmartDebt) {
      const { result: pool } = await client.simulateContract({ address: networks[network].fluid.dex, abi: fluidLiquidityAbi, functionName: 'getDexEntireData', args: [vault.constantVariables.borrow], blockNumber });
      if (pool.dex.toLowerCase() !== vault.constantVariables.borrow.toLowerCase() || normalizeMarketToken(pool.constantViews.token0, network) !== tokens[0] || normalizeMarketToken(pool.constantViews.token1, network) !== tokens[1]) throw new Error('Wrong pool');
      const perShare = [pool.dexState.token0PerBorrowShare, pool.dexState.token1PerBorrowShare];
      if (perShare.some(p => p <= 0n)) throw new Error('Pool share conversion unavailable');
      const limits = pool.limitsAndAvailability;
      const cashLimits = [minimum(limits.liquidityBorrowableToken0, limits.borrowableUntilUtilizationLimitToken0), minimum(limits.liquidityBorrowableToken1, limits.borrowableUntilUtilizationLimitToken1)];
      const shares = minimum(vault.limitsAndAvailability.borrowable, remaining(pool.configs.maxBorrowShares, pool.dexState.totalBorrowShares), ...cashLimits.map((amount, index) => amount * 10n ** 18n / perShare[index]));
      amounts = perShare.map(p => shares * p / 10n ** 18n);
    }
    await Promise.all(tokens.map(async (token, index) => {
      try {
        const metadata = await tokenMetadata(client, token, blockNumber);
        const symbol = rawTokens[index].toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ? networks[network].nativeSymbol : metadata.symbol;
        result.set(token, liquidityQuote(amounts[index], metadata.decimals, symbol, token, vault.isSmartDebt ? 'Estimated proportional debt-pool token amount, limited by vault shares, pool share cap, both tokens’ available liquidity and utilization headroom. The other pool token must be borrowed together; fees and execution can change the amount.' : 'Fluid resolver borrowable amount: available underlying liquidity limited by this vault’s current borrowing headroom.'));
      } catch { /* One missing token quote does not turn another into zero. */ }
    }));
  } catch { /* Preserve verified rate recommendations when availability is unreadable. */ }
  return result;
}
