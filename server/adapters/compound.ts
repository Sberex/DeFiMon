import { decodeFunctionResult, encodeFunctionData, formatUnits, parseAbi, type Address } from 'viem';
import type { ChainClient } from '../rpc.js';
import type { Asset, Position, ProtocolResult } from '../../src/types.js';
import { liquidationPrices, riskLevel } from '../risk.js';
// Official deployments: compound-finance/comet/deployments/mainnet/{usdc,weth}/roots.json.
const markets = [
  { address: '0xc3d688B66703497DAA19211EEdff47f25384cdc3' as Address, label: 'USDC market' },
  { address: '0xA17581A9E3356d9A858b789D68B4d866e593aE94' as Address, label: 'WETH market' },
];
const abi = parseAbi([
  'function accrueAccount(address account)',
  'function balanceOf(address account) view returns (uint256)',
  'function borrowBalanceOf(address account) view returns (uint256)',
  'function collateralBalanceOf(address account, address asset) view returns (uint128)',
  'function baseToken() view returns (address)',
  'function baseTokenPriceFeed() view returns (address)',
  'function numAssets() view returns (uint8)',
  'function getPrice(address priceFeed) view returns (uint256)',
  'function getAssetInfo(uint8 i) view returns ((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))',
]);
const erc20 = parseAbi(['function decimals() view returns (uint8)', 'function symbol() view returns (string)']);
const multiAbi = parseAbi(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)']);
const multicall = '0xcA11bde05977b3631167028862bE2a173976CA11';
const n = (value: bigint, decimals: number) => Number(formatUnits(value, decimals));
async function readMarket(client: ChainClient, wallet: Address, blockNumber: bigint, market: typeof markets[number]): Promise<Position | null> {
  const address = market.address;
  // One eth_call simulates accrual before reading both balances; no transaction or wallet signature.
  const calls = (['accrueAccount', 'balanceOf', 'borrowBalanceOf'] as const).map(functionName => ({ target: address, allowFailure: false, callData: encodeFunctionData({ abi, functionName, args: [wallet] }) }));
  const result = await client.call({ to: multicall, data: encodeFunctionData({ abi: multiAbi, functionName: 'aggregate3', args: [calls] }), blockNumber });
  if (!result.data) throw new Error('Missing simulated balances');
  const decoded = decodeFunctionResult({ abi: multiAbi, functionName: 'aggregate3', data: result.data });
  const supply = decodeFunctionResult({ abi, functionName: 'balanceOf', data: decoded[1].returnData });
  const borrow = decodeFunctionResult({ abi, functionName: 'borrowBalanceOf', data: decoded[2].returnData });
  const [base, feed, count] = await Promise.all([
    client.readContract({ address, abi, functionName: 'baseToken', blockNumber }),
    client.readContract({ address, abi, functionName: 'baseTokenPriceFeed', blockNumber }),
    client.readContract({ address, abi, functionName: 'numAssets', blockNumber }),
  ]);
  const [symbol, decimals, price] = await Promise.all([
    client.readContract({ address: base, abi: erc20, functionName: 'symbol', blockNumber }),
    client.readContract({ address: base, abi: erc20, functionName: 'decimals', blockNumber }),
    client.readContract({ address, abi, functionName: 'getPrice', args: [feed], blockNumber }),
  ]);
  if (price === 0n) throw new Error('Zero oracle price');
  const baseAsset: Asset = { symbol, address: base, supplied: n(supply, decimals), borrowed: n(borrow, decimals), priceUsd: n(price, 8), collateral: false, liquidationThreshold: null, liquidationPriceUsd: null };
  const collateral = await Promise.all(Array.from({ length: count }, async (_, i) => {
    const info = await client.readContract({ address, abi, functionName: 'getAssetInfo', args: [i], blockNumber });
    const balance = await client.readContract({ address, abi, functionName: 'collateralBalanceOf', args: [wallet, info.asset], blockNumber });
    if (balance === 0n) return null;
    const [assetSymbol, assetPrice] = await Promise.all([
      client.readContract({ address: info.asset, abi: erc20, functionName: 'symbol', blockNumber }),
      client.readContract({ address, abi, functionName: 'getPrice', args: [info.priceFeed], blockNumber }),
    ]);
    if (assetPrice === 0n) throw new Error('Zero oracle price');
    return { symbol: assetSymbol, address: info.asset, supplied: Number(balance) / Number(info.scale), borrowed: 0, priceUsd: n(assetPrice, 8), collateral: true, liquidationThreshold: n(info.liquidateCollateralFactor, 18), liquidationPriceUsd: null } satisfies Asset;
  }));
  const assets = [baseAsset, ...collateral.filter((a): a is NonNullable<typeof a> => a !== null)].filter(a => a.supplied > 0 || a.borrowed > 0);
  if (!assets.length) return null;
  const suppliedUsd = assets.reduce((sum, a) => sum + a.supplied * a.priceUsd, 0);
  const debtUsd = baseAsset.borrowed * baseAsset.priceUsd;
  const weighted = assets.reduce((sum, a) => sum + a.supplied * a.priceUsd * (a.liquidationThreshold ?? 0), 0);
  const health = debtUsd > 0 ? weighted / debtUsd : null;
  return { id: address, label: market.label, suppliedUsd, debtUsd, healthFactor: health, risk: riskLevel(debtUsd, health), assets: liquidationPrices(assets, debtUsd, weighted), notes: ['Borrowing interest is simulated to the selected block without sending a transaction.', 'Liquidation prices use Compound’s liquidation collateral factors, not its borrowing limits. Each estimate holds other prices fixed.'] };
}
export async function readCompound(client: ChainClient, wallet: Address, blockNumber: bigint): Promise<ProtocolResult> {
  const positions = await Promise.all(markets.map(m => readMarket(client, wallet, blockNumber, m)));
  return { id: 'compound', name: 'Compound', status: 'ok', coverage: 'Compound v3 USDC and WETH markets only. Excludes v2 and other v3 markets.', positions: positions.filter((p): p is Position => p !== null) };
}
