import { parseAbi } from 'viem';
// Interfaces and math: morpho-org/sdks@56f1ed62827a7aab39d979c0143d1fbf970c37ca,
// blue-sdk-viem/contracts/interfaces/IMorpho.sol, IMetaMorpho.sol, vault-v2/interfaces/IVaultV2.sol.
export const morphoCoreAbi = parseAbi([
 'function idToMarketParams(bytes32 id) view returns ((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv))',
 'function accrueInterest((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) params)',
 'function market(bytes32 id) view returns ((uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee))',
 'function position(bytes32 id, address user) view returns ((uint256 supplyShares, uint128 borrowShares, uint128 collateral))',
]);
export const morphoOracleAbi = parseAbi(['function price() view returns (uint256)']);
export const morphoIrmAbi = parseAbi(['function borrowRateView((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) params,(uint128 totalSupplyAssets,uint128 totalSupplyShares,uint128 totalBorrowAssets,uint128 totalBorrowShares,uint128 lastUpdate,uint128 fee) market) view returns (uint256)']);
export const morphoVaultAbi = parseAbi([
 'function asset() view returns (address)', 'function MORPHO() view returns (address)',
 'function balanceOf(address user) view returns (uint256)', 'function convertToAssets(uint256 shares) view returns (uint256)',
 'function accrueInterest()', 'function totalSupply() view returns (uint256)',
 'function _totalAssets() view returns (uint128)', 'function virtualShares() view returns (uint256)',
 'function decimals() view returns (uint8)', 'function symbol() view returns (string)',
]);
export const morphoFactoryAbi = parseAbi(['function isMetaMorpho(address vault) view returns (bool)', 'function isVaultV2(address vault) view returns (bool)']);
export const morphoMulticallAbi = parseAbi(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)']);
