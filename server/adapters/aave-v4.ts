import { formatUnits, type Address, type ContractFunctionReturnType } from 'viem';
import type { Asset, Position, ProtocolResult } from '../../src/types.js';
import type { ChainClient } from '../rpc.js';
import { readV4HubRates, v4BorrowRate } from '../aave-v4-rates.js';
import { unavailableRate, weightedRate } from '../rates.js';
import { liquidationPrices, riskLevel } from '../risk.js';
import { aaveV4SpokeAbi as spokeAbi, aaveV4OracleAbi as oracleAbi, aaveV4TokenAbi as tokenAbi } from '../abis/aave-v4.js';
import { AAVE_V4_SPOKES, AAVE_V4_TOKENIZATION_SPOKES } from '../deployments/aave-v4.js';

type Market = { readonly address: Address; readonly label: string };
type Deployment = { readonly spokes: readonly Market[]; readonly tokenizations: readonly Market[] };
type UserReserve = ContractFunctionReturnType<typeof spokeAbi, 'view', 'getUserPosition'>;
export const AAVE_V4_COVERAGE = 'Ethereum: 14 lending markets and 37 tokenized-deposit contracts from the pinned official Aave address book. Direct positions only; excludes linked accounts and treasury infrastructure.';
const deployed: Deployment = { spokes: AAVE_V4_SPOKES, tokenizations: AAVE_V4_TOKENIZATION_SPOKES };
const units = (value: bigint, decimals: number) => Number(formatUnits(value, decimals));

async function mapLimited<T, R>(items: readonly T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await read(items[i]); }
  }));
  return results;
}
function unknownMarket(market: Market, tokenized = false): Position {
  return { id: `aave-v4-${market.address}`, label: `${market.label}${tokenized ? ' tokenized deposit' : ' market'} · unavailable`, suppliedUsd: null, debtUsd: null, healthFactor: null, risk: 'unknown', assets: [], notes: ['This market could not be checked. Its balances and risk are unknown; do not interpret them as zero.'] };
}
/** One token can occur in multiple hub reserves. Combine its price exposure, including only enabled collateral. */
export function mergeV4Assets(assets: Asset[]): Asset[] {
  const merged = new Map<string, { asset: Asset; weightedCollateral: number }>();
  for (const a of assets) {
    const key = a.address.toLowerCase();
    const weighted = a.collateral ? a.supplied * (a.liquidationThreshold ?? 0) : 0;
    const existing = merged.get(key);
    if (!existing) merged.set(key, { asset: { ...a }, weightedCollateral: weighted });
    else {
      // Different oracle valuations for one token cannot be collapsed into one price scenario safely.
      if (existing.asset.priceUsd !== a.priceUsd) throw new Error('Inconsistent reserve prices for the same underlying');
      existing.asset.supplyRate = weightedRate(existing.asset.supplyRate, existing.asset.supplied, a.supplyRate, a.supplied);
      existing.asset.borrowRate = weightedRate(existing.asset.borrowRate, existing.asset.borrowed, a.borrowRate, a.borrowed);
      existing.asset.v4Reserves = [...(existing.asset.v4Reserves ?? []), ...(a.v4Reserves ?? [])];
      existing.asset.supplied += a.supplied;
      existing.asset.borrowed += a.borrowed;
      existing.asset.collateral ||= a.collateral;
      existing.weightedCollateral += weighted;
    }
  }
  return [...merged.values()].map(({ asset, weightedCollateral }) => ({ ...asset, liquidationThreshold: asset.collateral && asset.supplied > 0 ? weightedCollateral / asset.supplied : null, lltvNote: asset.collateral ? 'Effective liquidation factor weighted by supplied balances across this token’s reserves; excludes disabled collateral.' : undefined }));
}

export async function readAaveV4(client: ChainClient, wallet: Address, blockNumber: bigint, deployment: Deployment = deployed): Promise<ProtocolResult> {
  const warnings = new Set<string>();
  let verifiedChecks = 0;
  const rateCache = new Map<string, ReturnType<typeof readV4HubRates>>();
  function hubRates(hub: Address, assetId: bigint, underlying: Address) {
    const key = `${hub.toLowerCase()}:${assetId}`;
    if (!rateCache.has(key)) rateCache.set(key, readV4HubRates(client, hub, assetId, underlying, blockNumber));
    return rateCache.get(key)!;
  }
  const oracleCache = new Map<string, Promise<Address>>();
  const tokenCache = new Map<string, Promise<{ symbol: string; decimals: number }>>();
  function getOracle(market: Market): Promise<Address> {
    if (!oracleCache.has(market.address)) oracleCache.set(market.address, (async () => {
      const oracle = await client.readContract({ address: market.address, abi: spokeAbi, functionName: 'ORACLE', blockNumber });
      const decimals = await client.readContract({ address: oracle, abi: oracleAbi, functionName: 'decimals', blockNumber });
      // V4 SpokeUtils defines Value = USD * 1e26, requiring 8-decimal USD oracles.
      if (decimals !== 8) throw new Error('Unsupported oracle precision');
      return oracle;
    })());
    return oracleCache.get(market.address)!;
  }
  function getToken(address: Address) {
    const key = address.toLowerCase();
    if (!tokenCache.has(key)) tokenCache.set(key, (async () => {
      const [symbol, decimals] = await Promise.all([
        client.readContract({ address, abi: tokenAbi, functionName: 'symbol', blockNumber }),
        client.readContract({ address, abi: tokenAbi, functionName: 'decimals', blockNumber }),
      ]);
      if (decimals > 18) throw new Error('Unsupported V4 token precision');
      return { symbol, decimals };
    })());
    return tokenCache.get(key)!;
  }
  async function readMarket(market: Market): Promise<Position | null> {
    try {
      const count = await client.readContract({ address: market.address, abi: spokeAbi, functionName: 'getReserveCount', blockNumber });
      if (count > 1000n) throw new Error('Unexpected reserve count');
      const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
      const stored = await mapLimited(ids, async id => ({ id, user: await client.readContract({ address: market.address, abi: spokeAbi, functionName: 'getUserPosition', args: [id, wallet], blockNumber }) }));
      const active = stored.filter(({ user }) => user.suppliedShares > 0n || user.drawnShares > 0n || user.premiumShares > 0n || user.premiumOffsetRay !== 0n);
      if (!active.length) { verifiedChecks++; return null; }
      const accountRead = client.readContract({ address: market.address, abi: spokeAbi, functionName: 'getUserAccountData', args: [wallet], blockNumber });
      // Attach a rejection handler immediately while the independent reserve reads complete.
      const accountResult = accountRead.then(value => ({ ok: true as const, value }), () => ({ ok: false as const }));
      const oracleVerified = getOracle(market).then(() => true, () => false);
      const assets = mergeV4Assets((await mapLimited(active, async ({ id, user }: { id: bigint; user: UserReserve }): Promise<Asset | null> => {
        const [reserve, supplied, borrowed, status] = await Promise.all([
          client.readContract({ address: market.address, abi: spokeAbi, functionName: 'getReserve', args: [id], blockNumber }),
          client.readContract({ address: market.address, abi: spokeAbi, functionName: 'getUserSuppliedAssets', args: [id, wallet], blockNumber }),
          client.readContract({ address: market.address, abi: spokeAbi, functionName: 'getUserTotalDebt', args: [id, wallet], blockNumber }),
          client.readContract({ address: market.address, abi: spokeAbi, functionName: 'getUserReserveStatus', args: [id, wallet], blockNumber }),
        ]);
        if (supplied === 0n && borrowed === 0n) return null;
        const token = await getToken(reserve.underlying);
        if (token.decimals !== reserve.decimals) throw new Error('Reserve token decimals mismatch');
        // Crucial: use the user's stored config key, not the reserve's latest key.
        const config = status[0] && supplied > 0n ? await client.readContract({ address: market.address, abi: spokeAbi, functionName: 'getDynamicReserveConfig', args: [id, user.dynamicConfigKey], blockNumber }) : null;
        let priceUsd: number | null = null;
        try {
          const oracle = await getOracle(market);
          const price = await client.readContract({ address: oracle, abi: oracleAbi, functionName: 'getReservePrice', args: [id], blockNumber });
          if (price > 0n) priceUsd = units(price, 8);
        } catch { /* Keep balances when a valuation feed is unavailable. */ }
        const interest = await hubRates(reserve.hub, BigInt(reserve.assetId), reserve.underlying);
        return { v4Reserves: [{ hub: reserve.hub, assetId: String(reserve.assetId), supplied: units(supplied, reserve.decimals), borrowed: units(borrowed, reserve.decimals) }], supplyRate: interest?.supplyRate ?? unavailableRate(), borrowRate: v4BorrowRate(interest, user, borrowed), address: reserve.underlying, symbol: token.symbol, supplied: units(supplied, reserve.decimals), borrowed: units(borrowed, reserve.decimals), priceUsd, collateral: status[0] && (config?.collateralFactor ?? 0) > 0, liquidationThreshold: config ? config.collateralFactor / 10000 : null, liquidationPriceUsd: null };
      })).filter((a): a is Asset => a !== null));
      const [account, usdUnitsVerified] = await Promise.all([accountResult, oracleVerified]);
      if (!assets.length && account.ok && account.value.totalDebtValueRay === 0n) { verifiedChecks++; return null; }
      const suppliedUsd = assets.some(a => a.supplied > 0 && a.priceUsd === null) ? null : assets.reduce((sum, a) => sum + a.supplied * (a.priceUsd ?? 0), 0);
      // getUserTotalDebt includes drawn and premium debt; the native account value preserves full ray precision.
      const debtUsd = account.ok && usdUnitsVerified ? units(account.value.totalDebtValueRay, 53) : assets.some(a => a.borrowed > 0 && a.priceUsd === null) ? null : assets.reduce((sum, a) => sum + a.borrowed * (a.priceUsd ?? 0), 0);
      const hasDebt = account.ok ? account.value.totalDebtValueRay > 0n : assets.some(a => a.borrowed > 0);
      const health = hasDebt && account.ok ? units(account.value.healthFactor, 18) : null;
      const weightedCollateralUsd = account.ok && usdUnitsVerified ? units(account.value.totalCollateralValue, 26) * units(account.value.avgCollateralFactor, 18) : null;
      const notes = [
        'This market has its own collateral and debt. Assets in another Aave v4 market do not protect this borrowing position.',
        'Balances include accrued interest. Debt includes both ordinary borrowing and the additional risk-premium charge.',
        'Health is read directly from Aave v4. Liquidation prices use the wallet’s stored collateral settings and assume other prices and balances stay fixed.',
        'Amounts are combined when the same token appears in more than one reserve. Disabled collateral is excluded from the effective collateral factor.',
      ];
      if (!account.ok && hasDebt) { warnings.add('Some Aave v4 market risk data is unavailable.'); notes.push('Native account data could not be read; borrowing risk and liquidation prices are unknown.'); }
      if (suppliedUsd === null || debtUsd === null || assets.some(a => a.priceUsd === null)) { warnings.add('Some Aave v4 assets have unavailable USD prices; their dollar values are unknown.'); notes.push('A dash is unknown, not zero. Positions with unknown dollar values are excluded from the combined dollar totals.'); }
      const estimated = account.ok && weightedCollateralUsd !== null && debtUsd !== null ? liquidationPrices(assets, debtUsd, weightedCollateralUsd) : assets;
      verifiedChecks++;
      return { marketAddress: market.address, liquidationModel: account.ok && weightedCollateralUsd !== null ? 'linear' : 'unavailable', id: `aave-v4-${market.address}`, label: `Aave v4 · ${market.label}`, suppliedUsd, debtUsd, healthFactor: health, risk: riskLevel(hasDebt ? 1 : 0, health), assets: estimated, notes };
    } catch {
      warnings.add('Some Aave v4 lending markets could not be checked. Their positions, balances, and risk are unknown.');
      return unknownMarket(market);
    }
  }
  async function tokenizedPrice(hub: Address, assetId: bigint, underlying: Address): Promise<number | null> {
    // The tokenization contract has no oracle. Resolve an actual reserve for this same hub/asset pair.
    for (const market of deployment.spokes) {
      try {
        const id = await client.readContract({ address: market.address, abi: spokeAbi, functionName: 'getReserveId', args: [hub, assetId], blockNumber });
        const reserve = await client.readContract({ address: market.address, abi: spokeAbi, functionName: 'getReserve', args: [id], blockNumber });
        if (reserve.underlying.toLowerCase() !== underlying.toLowerCase()) continue;
        const oracle = await getOracle(market);
        const price = await client.readContract({ address: oracle, abi: oracleAbi, functionName: 'getReservePrice', args: [id], blockNumber });
        if (price > 0n) return units(price, 8);
      } catch { /* This market may not list the hub/asset, or its feed may be unavailable. */ }
    }
    return null;
  }
  async function readTokenization(market: Market): Promise<Position | null> {
    try {
      const shares = await client.readContract({ address: market.address, abi: tokenAbi, functionName: 'balanceOf', args: [wallet], blockNumber });
      if (shares === 0n) { verifiedChecks++; return null; }
      const [underlying, supplied, hub, assetId] = await Promise.all([
        client.readContract({ address: market.address, abi: tokenAbi, functionName: 'asset', blockNumber }),
        client.readContract({ address: market.address, abi: tokenAbi, functionName: 'convertToAssets', args: [shares], blockNumber }),
        client.readContract({ address: market.address, abi: tokenAbi, functionName: 'hub', blockNumber }),
        client.readContract({ address: market.address, abi: tokenAbi, functionName: 'assetId', blockNumber }),
      ]);
      const token = await getToken(underlying);
      const priceUsd = await tokenizedPrice(hub, assetId, underlying);
      if (priceUsd === null) warnings.add('Some Aave v4 tokenized deposits have no verified USD price. Their token balances are still shown.');
      verifiedChecks++;
      const quantity = units(supplied, token.decimals);
      const interest = await hubRates(hub, assetId, underlying);
      return { id: `aave-v4-${market.address}`, label: `Aave v4 · ${market.label} tokenized deposit`, suppliedUsd: priceUsd === null ? null : quantity * priceUsd, debtUsd: 0, healthFactor: null, risk: 'no-debt', assets: [{ v4Reserves: [{ hub, assetId: String(assetId), supplied: quantity, borrowed: 0 }], supplyRate: interest?.supplyRate ?? unavailableRate(), address: underlying, symbol: token.symbol, supplied: quantity, borrowed: 0, priceUsd, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null }], notes: ['Tokenized deposit shares are converted once to current underlying assets. The underlying is not counted a second time.', 'This deposit-only contract has no borrowing position or collateral liquidation price.', 'USD valuation uses an Aave v4 reserve for the same hub and asset; it is not a withdrawal guarantee.'] };
    } catch {
      warnings.add('Some Aave v4 tokenized-deposit contracts could not be checked. Their balances are unknown.');
      return unknownMarket(market, true);
    }
  }
  const [markets, tokenizations] = await Promise.all([
    mapLimited(deployment.spokes, readMarket),
    mapLimited(deployment.tokenizations, readTokenization),
  ]);
  if (!verifiedChecks) throw new Error('Aave v4 deployment could not be read');
  return { id: 'aave-v4', name: 'Aave v4', status: warnings.size ? 'partial' : 'ok', coverage: AAVE_V4_COVERAGE, message: warnings.size ? [...warnings].join(' ') : undefined, positions: [...markets, ...tokenizations].filter((p): p is Position => p !== null) };
}
