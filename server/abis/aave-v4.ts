import { parseAbi } from 'viem';
// Official interfaces at https://github.com/aave/aave-v4/tree/8be3e0d59efc23cd1d4664a88743340533dd5a0c/src/spoke/interfaces
// ReserveFlags is uint8. Account Value = USD * 1e26; totalDebtValueRay = USD * 1e53.
export const aaveV4SpokeAbi = parseAbi([
  'function ORACLE() view returns (address)',
  'function getReserveCount() view returns (uint256)',
  'function getReserveId(address hub, uint256 assetId) view returns (uint256)',
  'function getReserve(uint256 reserveId) view returns ((address underlying, address hub, uint16 assetId, uint8 decimals, uint24 collateralRisk, uint8 flags, uint32 dynamicConfigKey))',
  'function getUserPosition(uint256 reserveId, address user) view returns ((uint120 drawnShares, uint120 premiumShares, int200 premiumOffsetRay, uint120 suppliedShares, uint32 dynamicConfigKey))',
  'function getUserSuppliedAssets(uint256 reserveId, address user) view returns (uint256)',
  'function getUserTotalDebt(uint256 reserveId, address user) view returns (uint256)',
  'function getUserReserveStatus(uint256 reserveId, address user) view returns (bool, bool)',
  'function getDynamicReserveConfig(uint256 reserveId, uint32 dynamicConfigKey) view returns ((uint16 collateralFactor, uint32 maxLiquidationBonus, uint16 liquidationFee))',
  'function getUserAccountData(address user) view returns ((uint256 riskPremium, uint256 avgCollateralFactor, uint256 healthFactor, uint256 totalCollateralValue, uint256 totalDebtValueRay, uint256 activeCollateralCount, uint256 borrowCount))',
]);
export const aaveV4OracleAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function getReservePrice(uint256 reserveId) view returns (uint256)',
]);
export const aaveV4TokenAbi = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address user) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function asset() view returns (address)',
  'function hub() view returns (address)',
  'function assetId() view returns (uint256)',
]);
