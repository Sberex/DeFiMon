import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, formatUnits, keccak256, parseAbiParameters, type Address, type Hex } from 'viem';
import type { Asset, Position, ProtocolResult, NetworkId } from '../../src/types.js';
import type { ChainClient } from '../rpc.js';
import { MorphoDiscoveryUnavailable } from '../morpho-errors.js';
import { createMorphoRates } from '../morpho-rates.js';
import { rate, weightedRate } from '../rates.js';
import { networks } from '../networks.js';
import { riskLevel } from '../risk.js';
import { fetchMorphoDiscovery, type MorphoDiscovery, type MorphoMarketRef, type MorphoToken, type MorphoVaultRef } from '../morpho-discovery.js';
import { morphoCoreAbi as coreAbi, morphoFactoryAbi as factoryAbi, morphoMulticallAbi as multiAbi, morphoOracleAbi as oracleAbi, morphoVaultAbi as vaultAbi } from '../abis/morpho.js';
export const MORPHO_COVERAGE = 'Ethereum Morpho Blue direct markets and vault V1/V2 deposits. New positions may take time to appear in Morpho’s lookup service. Excludes legacy Optimizers and linked accounts.';
const MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11';
const ZERO = '0x0000000000000000000000000000000000000000';
const WAD = 10n ** 18n;
const ORACLE_SCALE = 10n ** 36n;
const units = (raw: bigint, decimals: number) => Number(formatUnits(raw, decimals));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function morphoSharesToAssets(shares: bigint, totalAssets: bigint, totalShares: bigint, roundUp = false): bigint {
  const numerator = shares * (totalAssets + 1n);
  const denominator = totalShares + 1_000_000n;
  return roundUp ? (numerator + denominator - 1n) / denominator : numerator / denominator;
}
export function morphoHealth(collateral: bigint, borrowAssets: bigint, price: bigint | null, lltv: bigint): number | null {
  if (borrowAssets === 0n || price === null) return null;
  // Match Morpho._isHealthy: two separate floor divisions, debt already rounded up.
  const maxBorrow = (collateral * price / ORACLE_SCALE) * lltv / WAD;
  return Number(maxBorrow) / Number(borrowAssets);
}
async function mapLimited<T, R>(items: readonly T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await read(items[i]); }
  }));
  return out;
}
function unknown(id: string, label: string): Position {
  return { id, label, suppliedUsd: null, debtUsd: null, healthFactor: null, risk: 'unknown', assets: [], notes: ['This position could not be verified. Its balances and risk are unknown, not zero.'] };
}
function total(assets: Asset[], side: 'supplied' | 'borrowed') {
  if (assets.some(a => a[side] > 0 && a.priceUsd === null)) return null;
  return assets.reduce((sum, a) => sum + a[side] * (a.priceUsd ?? 0), 0);
}
export async function readMorpho(client: ChainClient, wallet: Address, blockNumber: bigint, discover?: (wallet: Address) => Promise<MorphoDiscovery>, network: NetworkId = 'ethereum'): Promise<ProtocolResult> {
  const deployment = networks[network];
  if (!deployment.morphoBlue) throw new Error('Unsupported Morpho network');
  const morphoBlue = deployment.morphoBlue;
  const discovery = await (discover ? discover(wallet) : fetchMorphoDiscovery(wallet, fetch, network));
  if (!discovery.successfulFamilies) throw new MorphoDiscoveryUnavailable(discovery.failures ?? []);
  const warnings = new Set(discovery.warnings);
  const interest = createMorphoRates(client, blockNumber, morphoBlue);
  const metadata = new Map<string, Promise<{ symbol: string; decimals: number }>>();
  async function token(t: MorphoToken) {
    const key = t.address.toLowerCase();
    if (!metadata.has(key)) metadata.set(key, (async () => {
      const [symbol, decimals] = await Promise.all([
        client.readContract({ address: t.address, abi: vaultAbi, functionName: 'symbol', blockNumber }),
        client.readContract({ address: t.address, abi: vaultAbi, functionName: 'decimals', blockNumber }),
      ]);
      if (decimals > 36) throw new Error('Unsupported token precision');
      return { symbol, decimals };
    })());
    const actual = await metadata.get(key)!;
    if (actual.decimals !== t.decimals) throw new Error('Indexer and token decimals disagree');
    return { ...t, ...actual };
  }
  async function simulate(calls: { target: Address; callData: Hex }[]) {
    const result = await client.call({ to: MULTICALL, blockNumber, data: encodeFunctionData({ abi: multiAbi, functionName: 'aggregate3', args: [calls.map(c => ({ ...c, allowFailure: false }))] }) });
    if (!result.data) throw new Error('Missing Morpho simulation');
    const decoded = decodeFunctionResult({ abi: multiAbi, functionName: 'aggregate3', data: result.data });
    if (decoded.length !== calls.length || decoded.some(c => !c.success)) throw new Error('Incomplete Morpho simulation');
    return decoded.map(c => c.returnData);
  }
  async function readMarket(ref: MorphoMarketRef): Promise<Position | null> {
    try {
      const params = await client.readContract({ address: morphoBlue, abi: coreAbi, functionName: 'idToMarketParams', args: [ref.id], blockNumber });
      const id = keccak256(encodeAbiParameters(parseAbiParameters('address,address,address,address,uint256'), [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv]));
      if (!same(id, ref.id) || !same(params.loanToken, ref.loan.address) || (ref.collateral ? !same(params.collateralToken, ref.collateral.address) : !same(params.collateralToken, ZERO)) || params.lltv > WAD) throw new Error('Morpho market identity mismatch');
      const data = await simulate([
        { target: morphoBlue, callData: encodeFunctionData({ abi: coreAbi, functionName: 'accrueInterest', args: [params] }) },
        { target: morphoBlue, callData: encodeFunctionData({ abi: coreAbi, functionName: 'market', args: [ref.id] }) },
        { target: morphoBlue, callData: encodeFunctionData({ abi: coreAbi, functionName: 'position', args: [ref.id, wallet] }) },
      ]);
      const market = decodeFunctionResult({ abi: coreAbi, functionName: 'market', data: data[1] });
      const position = decodeFunctionResult({ abi: coreAbi, functionName: 'position', data: data[2] });
      if (!market.lastUpdate || position.supplyShares > market.totalSupplyShares || position.borrowShares > market.totalBorrowShares) throw new Error('Invalid Morpho state');
      if (position.supplyShares === 0n && position.borrowShares === 0n && position.collateral === 0n) return null;
      const supplyRaw = morphoSharesToAssets(position.supplyShares, market.totalSupplyAssets, market.totalSupplyShares);
      const borrowRaw = morphoSharesToAssets(position.borrowShares, market.totalBorrowAssets, market.totalBorrowShares, true);
      const loan = await token(ref.loan);
      const collateral = position.collateral > 0n && ref.collateral ? await token(ref.collateral) : null;
      let oraclePrice: bigint | null = null;
      if (borrowRaw > 0n) {
        try { oraclePrice = await client.readContract({ address: params.oracle, abi: oracleAbi, functionName: 'price', blockNumber }); }
        catch { warnings.add('Some Morpho liquidation oracle data is unavailable. Those borrowing risks are unknown.'); }
      }
      const health = morphoHealth(position.collateral, borrowRaw, oraclePrice, params.lltv);
      const currentRates = await interest.market(params, market);
      const loanAsset: Asset = { ...currentRates, symbol: loan.symbol, address: loan.address, supplied: units(supplyRaw, loan.decimals), borrowed: units(borrowRaw, loan.decimals), priceUsd: loan.priceUsd, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null };
      const assets = [loanAsset];
      let collateralAsset: Asset | undefined;
      if (collateral) {
        const quantity = units(position.collateral, collateral.decimals);
        if (same(collateral.address, loan.address)) {
          collateralAsset = loanAsset;
          loanAsset.supplyRate = weightedRate(loanAsset.supplyRate, loanAsset.supplied, rate(0, 'Morpho collateral itself earns no protocol lending interest.'), quantity);
          loanAsset.supplied += quantity;
          loanAsset.collateral = true;
          loanAsset.liquidationThreshold = loanAsset.supplied > 0 ? units(params.lltv, 18) * quantity / loanAsset.supplied : null;
        } else {
          collateralAsset = { supplyRate: rate(0, 'Morpho collateral is not lent out and earns no protocol interest. Intrinsic token yield is separate.'), symbol: collateral.symbol, address: collateral.address, supplied: quantity, borrowed: 0, priceUsd: collateral.priceUsd, collateral: true, liquidationThreshold: units(params.lltv, 18), liquidationPriceUsd: null };
          assets.push(collateralAsset);
        }
      }
      let liquidationQuote: Position['liquidationQuote'];
      if (borrowRaw > 0n && position.collateral > 0n && params.lltv > 0n && oraclePrice !== null && collateral) {
        const scaling = 10 ** (collateral.decimals - loan.decimals);
        const threshold = Number(borrowRaw) / Number(position.collateral) / units(params.lltv, 18) * scaling;
        liquidationQuote = { current: Number(oraclePrice) / 1e36 * scaling, threshold, unit: `${loan.symbol} per ${collateral.symbol}` };
        if (oraclePrice > 0n && collateralAsset && loan.priceUsd !== null && !same(collateral.address, loan.address)) collateralAsset.liquidationPriceUsd = threshold * loan.priceUsd;
      }
      const suppliedUsd = total(assets, 'supplied'); const debtUsd = total(assets, 'borrowed');
      if (suppliedUsd === null || debtUsd === null) warnings.add('Some Morpho USD prices are unavailable. Token balances and oracle-based risk remain visible; dollar totals are incomplete.');
      if (borrowRaw > 0n && oraclePrice === 0n) warnings.add('A Morpho liquidation oracle reports zero: the protocol values that collateral at zero for borrowing risk.');
      return { id: `morpho-market-${ref.id}`, label: `Morpho · ${collateral?.symbol ?? 'no collateral'} / ${loan.symbol} · ${ref.id.slice(0, 10)}…`, suppliedUsd, debtUsd, healthFactor: health, risk: riskLevel(borrowRaw > 0n ? 1 : 0, health), assets: assets.filter(a => a.supplied > 0 || a.borrowed > 0), liquidationQuote, notes: [
        'Each Morpho market has separate collateral and debt. Loan-token lending deposits do not protect a borrowing position, even in this same market.',
        `Interest is simulated to the displayed ${deployment.name} block without sending a transaction. Supply rounds down and debt rounds up using Morpho’s virtual assets and shares.`,
        'Health uses the market’s own liquidation oracle and loan-to-value limit. Dollar liquidation estimates assume the debt token price and both balances stay fixed; protocol rounding may shift the exact boundary.',
        'USD prices are indicative prices from Morpho’s lookup service and may update at a different time from the Ethereum balances. Oracle prices determine risk, not the indicative dollar prices.',
      ] };
    } catch {
      warnings.add('Some Morpho markets could not be read or verified. Their balances and risk are unknown.');
      return unknown(`morpho-market-${ref.id}`, `Morpho market · ${ref.id.slice(0, 10)}…`);
    }
  }
  async function readVault(ref: MorphoVaultRef): Promise<Position | null> {
    try {
      const registered = await client.readContract({ address: ref.factory, abi: factoryAbi, functionName: ref.version === 1 ? 'isMetaMorpho' : 'isVaultV2', args: [ref.address], blockNumber });
      if (!registered) throw new Error('Vault not recognized by its factory');
      const underlying = await client.readContract({ address: ref.address, abi: vaultAbi, functionName: 'asset', blockNumber });
      if (!same(underlying, ref.asset.address)) throw new Error('Vault underlying mismatch');
      let raw: bigint;
      if (ref.version === 1) {
        const core = await client.readContract({ address: ref.address, abi: vaultAbi, functionName: 'MORPHO', blockNumber });
        if (!same(core, morphoBlue)) throw new Error('Wrong Morpho deployment');
        const shares = await client.readContract({ address: ref.address, abi: vaultAbi, functionName: 'balanceOf', args: [wallet], blockNumber });
        if (shares === 0n) return null;
        raw = await client.readContract({ address: ref.address, abi: vaultAbi, functionName: 'convertToAssets', args: [shares], blockNumber });
      } else {
        // Read post-accrual shares, fees, and totals together. No dependent calls escape this eth_call.
        const calls = [
          encodeFunctionData({ abi: vaultAbi, functionName: 'accrueInterest' }),
          encodeFunctionData({ abi: vaultAbi, functionName: 'balanceOf', args: [wallet] }),
          encodeFunctionData({ abi: vaultAbi, functionName: 'totalSupply' }),
          encodeFunctionData({ abi: vaultAbi, functionName: '_totalAssets' }),
          encodeFunctionData({ abi: vaultAbi, functionName: 'virtualShares' }),
        ];
        const data = await simulate(calls.map(callData => ({ target: ref.address, callData })));
        const shares = decodeFunctionResult({ abi: vaultAbi, functionName: 'balanceOf', data: data[1] });
        if (shares === 0n) return null;
        const supply = decodeFunctionResult({ abi: vaultAbi, functionName: 'totalSupply', data: data[2] });
        const assets = decodeFunctionResult({ abi: vaultAbi, functionName: '_totalAssets', data: data[3] });
        const virtual = decodeFunctionResult({ abi: vaultAbi, functionName: 'virtualShares', data: data[4] });
        if (supply + virtual === 0n || shares > supply) throw new Error('Invalid vault accounting');
        raw = shares * (assets + 1n) / (supply + virtual);
      }
      const supplyRate = await interest.vault(ref.address, ref.version, ref.asset.address);
      const underlyingToken = await token(ref.asset); const supplied = units(raw, underlyingToken.decimals);
      const suppliedUsd = underlyingToken.priceUsd === null ? null : supplied * underlyingToken.priceUsd;
      if (suppliedUsd === null) warnings.add('Some Morpho vaults have unavailable USD prices. Their underlying token quantities are still shown.');
      return { id: `morpho-vault-${ref.address}`, label: `Morpho vault V${ref.version} · ${ref.name}`, suppliedUsd, debtUsd: 0, healthFactor: null, risk: 'no-debt', assets: [{ supplyRate, address: underlyingToken.address, symbol: underlyingToken.symbol, supplied, borrowed: 0, priceUsd: underlyingToken.priceUsd, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null }], notes: ['Vault shares are converted once to current underlying assets. The vault’s own loans are not added again as wallet deposits.', ref.version === 2 ? 'Vault V2 interest and fee-share minting are simulated in one read-only call before valuing this position.' : 'Vault V1 underlying value comes from its current ERC-4626 share conversion.', 'This is a deposit-only holding: there is no wallet borrowing balance or collateral liquidation price.'] };
    } catch {
      warnings.add('Some Morpho vault holdings could not be read or verified. Their balances are unknown.');
      return unknown(`morpho-vault-${ref.address}`, `Morpho vault · ${ref.name}`);
    }
  }
  const uniqueMarkets = [...new Map(discovery.markets.map(m => [m.id.toLowerCase(), m])).values()];
  const uniqueVaults = [...new Map(discovery.vaults.map(v => [v.address.toLowerCase(), v])).values()];
  if (uniqueMarkets.length !== discovery.markets.length || uniqueVaults.length !== discovery.vaults.length) warnings.add('Duplicate Morpho entries were counted once; complete lookup coverage could not be confirmed.');
  const [markets, vaults] = await Promise.all([mapLimited(uniqueMarkets, readMarket), mapLimited(uniqueVaults, readVault)]);
  return { id: 'morpho', name: 'Morpho', status: warnings.size ? 'partial' : 'ok', coverage: MORPHO_COVERAGE.replace('Ethereum', deployment.name), message: warnings.size ? [...warnings].join(' ') : undefined, positions: [...markets, ...vaults].filter((p): p is Position => p !== null) };
}
