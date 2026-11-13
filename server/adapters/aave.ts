import { formatUnits, parseAbi, type Address } from 'viem';
import type { ProtocolResult, Asset, NetworkId } from '../../src/types.js';
import type { ChainClient } from '../rpc.js';
import { rate, unavailableRate, rayApr } from '../rates.js';
import { networks } from '../networks.js';
import { liquidationPrices, riskLevel } from '../risk.js';
const providerAbi = parseAbi([
  'function getPool() view returns (address)',
  'function getPriceOracle() view returns (address)',
  'function getPoolDataProvider() view returns (address)',
]);
const poolAbi = parseAbi([
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function getUserEMode(address user) view returns (uint256)',
]);
const dataAbi = parseAbi([
  'function getReserveData(address asset) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40)',
  'function getAllReservesTokens() view returns ((string symbol, address tokenAddress)[])',
  'function getUserReserveData(address asset, address user) view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)',
  'function getReserveConfigurationData(address asset) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)',
]);
const oracleAbi = parseAbi(['function getAssetPrice(address asset) view returns (uint256)', 'function BASE_CURRENCY_UNIT() view returns (uint256)']);
const n = (value: bigint, decimals: number) => Number(formatUnits(value, decimals));
export async function readAave(client: ChainClient, wallet: Address, blockNumber: bigint, network: NetworkId = 'ethereum'): Promise<ProtocolResult> {
  const deployment = networks[network];
  const provider = deployment.aaveProvider;
  const readProvider = (functionName: 'getPool' | 'getPriceOracle' | 'getPoolDataProvider') => client.readContract({ address: provider, abi: providerAbi, functionName, blockNumber });
  const [pool, oracle, data] = await Promise.all([readProvider('getPool'), readProvider('getPriceOracle'), readProvider('getPoolDataProvider')]);
  const [account, emode, reserves, unit] = await Promise.all([
    client.readContract({ address: pool, abi: poolAbi, functionName: 'getUserAccountData', args: [wallet], blockNumber }),
    client.readContract({ address: pool, abi: poolAbi, functionName: 'getUserEMode', args: [wallet], blockNumber }),
    client.readContract({ address: data, abi: dataAbi, functionName: 'getAllReservesTokens', blockNumber }),
    client.readContract({ address: oracle, abi: oracleAbi, functionName: 'BASE_CURRENCY_UNIT', blockNumber }),
  ]);
  const assets: Asset[] = (await Promise.all(reserves.map(async reserve => {
    const balances = await client.readContract({ address: data, abi: dataAbi, functionName: 'getUserReserveData', args: [reserve.tokenAddress, wallet], blockNumber });
    if (balances[0] === 0n && balances[1] === 0n && balances[2] === 0n) return null;
    const [config, price] = await Promise.all([
      client.readContract({ address: data, abi: dataAbi, functionName: 'getReserveConfigurationData', args: [reserve.tokenAddress], blockNumber }),
      client.readContract({ address: oracle, abi: oracleAbi, functionName: 'getAssetPrice', args: [reserve.tokenAddress], blockNumber }),
    ]);
    if (price === 0n) throw new Error('Oracle returned a zero price');
    let borrowRate = unavailableRate();
    if (balances[1] + balances[2] > 0n) {
      try {
        const rates = await client.readContract({ address: data, abi: dataAbi, functionName: 'getReserveData', args: [reserve.tokenAddress], blockNumber });
        const annual = (Number(balances[1]) * rayApr(balances[5]) + Number(balances[2]) * rayApr(rates[6])) / Number(balances[1] + balances[2]);
        borrowRate = rate(annual, 'Current Aave borrowing APR; stable and variable debt are weighted by this wallet’s balances. Excludes reward-token incentives.');
      } catch { /* A missing rate must not discard balances or liquidation risk. */ }
    }
    return { supplyRate: rate(rayApr(balances[6]), 'Current Aave liquidity APR, without compounding or reward-token incentives.'), borrowRate, symbol: reserve.symbol, address: reserve.tokenAddress, supplied: n(balances[0], Number(config[0])), borrowed: n(balances[1] + balances[2], Number(config[0])), priceUsd: Number(price) / Number(unit), collateral: balances[8] && config[2] > 0n, liquidationThreshold: emode === 0n ? Number(config[2]) / 1e4 : null, liquidationPriceUsd: null } satisfies Asset;
  }))).filter((asset): asset is NonNullable<typeof asset> => asset !== null);
  const debtUsd = Number(account[1]) / Number(unit);
  const suppliedUsd = assets.reduce((sum, a) => sum + a.supplied * a.priceUsd!, 0);
  const health = debtUsd > 0 ? n(account[5], 18) : null;
  const weighted = Number(account[0]) / Number(unit) * Number(account[3]) / 1e4;
  return {
    id: 'aave-v3', name: 'Aave v3', status: 'ok', coverage: `${deployment.name} main market; excludes other Aave markets and vaults.`,
    positions: assets.length ? [{ id: 'aave-main', label: `${deployment.name} main market`, suppliedUsd, debtUsd, healthFactor: health, risk: riskLevel(debtUsd, health), assets: emode === 0n ? liquidationPrices(assets, debtUsd, weighted) : assets,
      notes: [ 'Prices come from Aave’s own oracle. Each liquidation price assumes other prices and balances stay fixed.', ...(emode !== 0n ? ['Efficiency mode is enabled. Health factor is read directly; per-asset liquidation price estimates are unavailable for this mode.'] : [])] }] : [],
  };
}
