import { parseAbi } from 'viem';
// Canonical interfaces: euler-xyz/euler-interfaces@0ea27dcf23c31249857180a0753638c040c4df1b.
export const eulerFactoryAbi = parseAbi([
 'function getProxyListLength() view returns (uint256)', 'function getProxyListSlice(uint256 start,uint256 end) view returns (address[])', 'function isProxy(address) view returns (bool)',
]);
export const eulerEvcAbi = parseAbi([
 'function getAccountOwner(address) view returns (address)', 'function getControllers(address) view returns (address[])', 'function getCollaterals(address) view returns (address[])',
]);
export const eulerVaultAbi = parseAbi([
 'function EVC() view returns (address)', 'function asset() view returns (address)', 'function name() view returns (string)',
 'function balanceOf(address) view returns (uint256)', 'function convertToAssets(uint256) view returns (uint256)', 'function debtOf(address) view returns (uint256)',
 'function cash() view returns (uint256)', 'function totalBorrows() view returns (uint256)', 'function interestRate() view returns (uint256)', 'function interestFee() view returns (uint16)',
 'function caps() view returns (uint16 supplyCap,uint16 borrowCap)', 'function hookConfig() view returns (address hookTarget,uint32 hookedOperations)',
 'function LTVList() view returns (address[])', 'function LTVBorrow(address) view returns (uint16)', 'function LTVLiquidation(address) view returns (uint16)',
 'function accountLiquidity(address,bool liquidation) view returns (uint256 collateralValue,uint256 liabilityValue)',
]);
export const eulerOracleAbi = parseAbi(['function getQuote(uint256 amount,address base,address quote) view returns (uint256)']);
export const eulerOracleConfigAbi = parseAbi(['function oracle() view returns (address)', 'function unitOfAccount() view returns (address)']);
