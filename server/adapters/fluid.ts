import { formatUnits, parseAbi, type Address, type ContractFunctionReturnType } from 'viem';
import type { Asset, Position, ProtocolResult, NetworkId } from '../../src/types.js';
import type { ChainClient } from '../rpc.js';
import { applyFluidRates, fluidLendingRate } from '../fluid-rates.js';
import { networks } from '../networks.js';
import { riskLevel } from '../risk.js';
import { dexResolverAbi, lendingResolverAbi, vaultResolverAbi } from '../abis/fluid.js';

// Official mainnet deployments; pinned ABI provenance is in abis/fluid.ts.
export const FLUID_VAULT_RESOLVER = '0x6943Ed9E53e3713Bf24a92016984254311772F1A';
export const FLUID_DEX_RESOLVER = '0x11D80CfF056Cef4F9E6d23da8672fE9873e5cC07';
export const FLUID_LENDING_RESOLVER = '0x48D32f49aFeAEC7AE66ad7B9264f446fc11a1569';
export const FLUID_COVERAGE = 'Ethereum T1–T4 vaults and fToken lending deposits held directly by this address. Excludes standalone DEX/smart-lending deposits and linked accounts.';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const erc20Abi = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function asset() view returns (address)', 'function convertToAssets(uint256) view returns (uint256)']);
const aaveProviderAbi = parseAbi(['function getPriceOracle() view returns (address)']);
const aaveOracleAbi = parseAbi(['function getAssetPrice(address) view returns (uint256)', 'function BASE_CURRENCY_UNIT() view returns (uint256)']);
const registryAbi = parseAbi(['function decimals(address base, address quote) view returns (uint8)', 'function latestRoundData(address base, address quote) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)']);
type ResolvedPosition = ContractFunctionReturnType<typeof vaultResolverAbi, 'view', 'positionByNftId'>;
type DexState = ContractFunctionReturnType<typeof dexResolverAbi, 'nonpayable', 'getDexState'>;
type Token = { address: Address; symbol: string; decimals: number; priceUsd: number | null };
const amount = (raw: bigint, decimals: number) => Number(formatUnits(raw, decimals));

/** Bound per-wallet RPC concurrency without dropping positions. */
async function mapLimited<T, R>(items: readonly T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) { const i = next++; result[i] = await read(items[i]); }
  }));
  return result;
}
function value(assets: Asset[], side: 'supplied' | 'borrowed'): number | null {
  if (assets.some(a => a[side] > 0 && a.priceUsd === null)) return null;
  return assets.reduce((sum, a) => sum + a[side] * (a.priceUsd ?? 0), 0);
}
function unknownPosition(id: string, label: string): Position {
  return { id, label, suppliedUsd: null, debtUsd: null, healthFactor: null, risk: 'unknown', assets: [], notes: ['This position could not be read. Its balances and risk are unknown; it is excluded from dollar totals.'] };
}

/** Health uses Fluid's liquidation oracle in raw debt units per raw collateral unit, scaled 1e27.
 * Resolver balances already include current exchange prices and any past liquidation; do not apply interest twice.
 */
export function fluidHealth(supply: bigint, borrow: bigint, price: bigint, threshold: number): number | null {
  if (borrow === 0n || price <= 0n || threshold <= 0 || threshold > 10000) return null;
  return Number(supply) * Number(price) / 1e27 * (threshold / 10000) / Number(borrow);
}

export async function readFluid(client: ChainClient, wallet: Address, blockNumber: bigint, network: NetworkId = 'ethereum'): Promise<ProtocolResult> {
  const deployment = networks[network];
  const wrappedNative = deployment.wrappedNative;
  const tokens = new Map<string, Promise<Token>>();
  const pools = new Map<string, Promise<DexState>>();
  const warnings = new Set<string>();
  let oraclePromise: Promise<{ address: Address; unit: bigint }> | undefined;
  let timestampPromise: Promise<bigint> | undefined;
  async function priceUsd(token: Address): Promise<number | null> {
    const base = token.toLowerCase() === NATIVE ? wrappedNative : token;
    try {
      oraclePromise ??= (async () => {
        const address = await client.readContract({ address: deployment.aaveProvider, abi: aaveProviderAbi, functionName: 'getPriceOracle', blockNumber });
        const unit = await client.readContract({ address, abi: aaveOracleAbi, functionName: 'BASE_CURRENCY_UNIT', blockNumber });
        return { address, unit };
      })();
      const oracle = await oraclePromise;
      const raw = await client.readContract({ address: oracle.address, abi: aaveOracleAbi, functionName: 'getAssetPrice', args: [base], blockNumber });
      if (raw > 0n && oracle.unit > 0n) return Number(raw) / Number(oracle.unit);
    } catch { /* Unsupported assets can still have a Chainlink USD feed. */ }
    try {
      const registry = deployment.chainlinkRegistry;
      if (!registry) return null; // Never use an Ethereum feed registry on another chain.
      const quote = '0x0000000000000000000000000000000000000348'; // Chainlink USD denomination.
      const feedBase = base.toLowerCase() === wrappedNative.toLowerCase() ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' : base;
      const [round, decimals] = await Promise.all([
        client.readContract({ address: registry, abi: registryAbi, functionName: 'latestRoundData', args: [feedBase, quote], blockNumber }),
        client.readContract({ address: registry, abi: registryAbi, functionName: 'decimals', args: [feedBase, quote], blockNumber }),
      ]);
      timestampPromise ??= client.getBlock({ blockNumber }).then(b => b.timestamp);
      const now = await timestampPromise;
      if (round[1] > 0n && round[3] > 0n && round[3] <= now && now - round[3] <= 86400n && round[4] >= round[0]) return amount(round[1], decimals);
    } catch { /* Missing valuation is explicit; never assume a token is worth $1. */ }
    return null;
  }
  function getToken(address: Address): Promise<Token> {
    const key = address.toLowerCase();
    if (!tokens.has(key)) tokens.set(key, (async () => {
      const [symbol, decimals, price] = await Promise.all([
        key === NATIVE ? Promise.resolve(deployment.nativeSymbol) : client.readContract({ address, abi: erc20Abi, functionName: 'symbol', blockNumber }),
        key === NATIVE ? Promise.resolve(18) : client.readContract({ address, abi: erc20Abi, functionName: 'decimals', blockNumber }),
        priceUsd(address),
      ]);
      if (decimals > 36) throw new Error('Unsupported token precision');
      return { address, symbol, decimals, priceUsd: price };
    })());
    return tokens.get(key)!;
  }
  function getPool(address: Address): Promise<DexState> {
    const key = address.toLowerCase();
    if (!pools.has(key)) pools.set(key, client.simulateContract({ address: deployment.fluid.dex, abi: dexResolverAbi, functionName: 'getDexState', args: [address], blockNumber }).then(r => r.result));
    return pools.get(key)!;
  }
  async function sideAssets(raw: bigint, smart: boolean, pool: Address, pair: { token0: Address; token1: Address }, side: 'supplied' | 'borrowed'): Promise<Asset[]> {
    if (raw === 0n) return [];
    let raws = [raw];
    if (smart) {
      const state = await getPool(pool);
      const perShare = side === 'supplied' ? [state.token0PerSupplyShare, state.token1PerSupplyShare] : [state.token0PerBorrowShare, state.token1PerBorrowShare];
      // The resolver catches internal failures and can return zero reserves. Zero is not a successful conversion.
      if (perShare.every(r => r === 0n)) throw new Error('Pool reserves unavailable');
      raws = perShare.map(r => raw * r / 10n ** 18n);
    }
    return Promise.all(raws.map(async (balance, i) => {
      const token = await getToken(i === 0 ? pair.token0 : pair.token1);
      return { symbol: token.symbol, address: token.address, supplied: side === 'supplied' ? amount(balance, token.decimals) : 0, borrowed: side === 'borrowed' ? amount(balance, token.decimals) : 0, priceUsd: token.priceUsd, collateral: side === 'supplied', liquidationThreshold: null, liquidationPriceUsd: null } satisfies Asset;
    }));
  }
  async function vaultPosition(id: bigint): Promise<Position | null> {
    try {
      const [position, vault]: ResolvedPosition = await client.readContract({ address: deployment.fluid.vault, abi: vaultResolverAbi, functionName: 'positionByNftId', args: [id], blockNumber });
      if (position.owner.toLowerCase() !== wallet.toLowerCase()) throw new Error('Position owner mismatch');
      if (position.supply === 0n && position.borrow === 0n) return null; // Closed NFTs are not live positions.
      const c = vault.constantVariables;
      if (![10000n, 20000n, 30000n, 40000n].includes(c.vaultType) || vault.isSmartCol !== [20000n, 40000n].includes(c.vaultType) || vault.isSmartDebt !== [30000n, 40000n].includes(c.vaultType)) throw new Error('Unknown vault type');
      const [supply, debt] = await Promise.all([
        sideAssets(position.supply, vault.isSmartCol, c.supply, c.supplyToken, 'supplied'),
        sideAssets(position.borrow, vault.isSmartDebt, c.borrow, c.borrowToken, 'borrowed'),
      ]);
      await applyFluidRates(client, deployment.fluid.dex, blockNumber, vault, supply, debt);
      const assets: Asset[] = [];
      for (const asset of [...supply, ...debt]) {
        const existing = assets.find(a => a.address.toLowerCase() === asset.address.toLowerCase());
        if (existing) { existing.supplied += asset.supplied; existing.borrowed += asset.borrowed; existing.collateral ||= asset.collateral; if (asset.borrowed > 0) existing.borrowRate = asset.borrowRate; if (asset.supplied > 0) existing.supplyRate = asset.supplyRate; }
        else assets.push({ ...asset });
      }
      const threshold = vault.configs.liquidationThreshold;
      const oracle = vault.configs.oraclePriceLiquidate;
      const health = fluidHealth(position.supply, position.borrow, oracle, threshold);
      const notes = [`Balances include accrued interest and any completed liquidations at the displayed ${deployment.name} block.`, 'Health factor is an estimate from Fluid’s liquidation oracle and liquidation threshold, not the borrowing limit. Fluid liquidates in discrete price ticks, so execution can differ slightly.'];
      let liquidationQuote: Position['liquidationQuote'];
      if (position.borrow > 0n && position.supply > 0n && oracle > 0n && threshold > 0 && threshold <= 10000) {
        const supplyToken = vault.isSmartCol ? null : await getToken(c.supplyToken.token0);
        const debtToken = vault.isSmartDebt ? null : await getToken(c.borrowToken.token0);
        const scale = 10 ** ((supplyToken?.decimals ?? 18) - (debtToken?.decimals ?? 18));
        const current = Number(oracle) / 1e27 * scale;
        const boundary = Number(position.borrow) / Number(position.supply) / (threshold / 10000) * scale;
        liquidationQuote = { current, threshold: boundary, unit: `${debtToken?.symbol ?? 'debt pool share'} per ${supplyToken?.symbol ?? 'collateral pool share'}` };
        if (!vault.isSmartCol && !vault.isSmartDebt && supplyToken && debtToken) {
          const a = assets.find(a => a.address.toLowerCase() === supplyToken.address.toLowerCase())!;
          a.liquidationThreshold = threshold / 10000;
          // Plasma has no configured independent feed for some Fluid collateral
          // (for example sUSDai). For T1 only, translate Fluid's token ratio using
          // the independently priced debt asset. Never assume a stablecoin peg,
          // apply a pool-share ratio to an underlying token, or overwrite a feed.
          if (network === 'plasma' && a.priceUsd === null && debtToken.priceUsd !== null && supplyToken.address.toLowerCase() !== debtToken.address.toLowerCase()) {
            const estimate = current * debtToken.priceUsd;
            if (Number.isFinite(estimate) && estimate > 0) {
              a.priceUsd = estimate;
              a.priceSource = 'fluid-oracle';
              notes.push('The collateral USD price is estimated from Fluid’s liquidation oracle ratio multiplied by the debt token’s independently sourced USD price. Supplied and net values include this protocol-based estimate; it is not a market-sale quote.');
              warnings.add('Some collateral dollar values are estimated from Fluid’s liquidation oracle and a debt-token USD price. Supplied and net values include these estimates.');
            }
          }
          if (supplyToken.address.toLowerCase() !== debtToken.address.toLowerCase() && debtToken.priceUsd !== null) a.liquidationPriceUsd = boundary * debtToken.priceUsd;
          notes.push('The dollar liquidation price holds the debt token’s USD price and both balances fixed. Fluid’s collateral/debt oracle ratio determines liquidation; independent USD prices are for valuation only.');
        } else notes.push('Smart collateral/debt changes with the pool composition. A single underlying token’s dollar liquidation price is not reliable, so the actual oracle-ratio boundary is shown instead. Pool share quotes use 10^18 raw share units.');
      }
      if (position.isLiquidated) notes.push('This NFT has previously been liquidated. The balances shown are the remaining position, not its pre-liquidation balances.');
      const suppliedUsd = value(assets, 'supplied');
      const debtUsd = value(assets, 'borrowed');
      if (suppliedUsd === null || debtUsd === null) { warnings.add('Some positions have no verified USD price. Their balances and oracle-based risk are shown, but dollar totals are incomplete.'); notes.push('An independent USD price is unavailable for one or more assets. A dash is unknown, not zero.'); }
      if (position.borrow > 0n && health === null) { warnings.add('Some borrowing positions have unavailable liquidation data.'); notes.push('Fluid’s liquidation oracle or threshold is unavailable. Risk and liquidation prices are unknown.'); }
      return { id: `fluid-nft-${id}`, label: `Vault ${c.vaultId} · ${supply.map(a => a.symbol).join('/')} / ${debt.map(a => a.symbol).join('/') || 'no debt'} · NFT ${id}`, suppliedUsd, debtUsd, healthFactor: health, risk: riskLevel(position.borrow > 0n ? 1 : 0, health), assets, notes, liquidationQuote };
    } catch {
      warnings.add('Some Fluid vault positions could not be read. Their balances and risk are unknown.');
      return unknownPosition(`fluid-nft-${id}`, `Fluid vault · NFT ${id}`);
    }
  }
  async function lendingPosition(fToken: Address): Promise<Position | null> {
    try {
      const shares = await client.readContract({ address: fToken, abi: erc20Abi, functionName: 'balanceOf', args: [wallet], blockNumber });
      if (shares === 0n) return null;
      const [underlying, raw] = await Promise.all([
        client.readContract({ address: fToken, abi: erc20Abi, functionName: 'asset', blockNumber }),
        client.readContract({ address: fToken, abi: erc20Abi, functionName: 'convertToAssets', args: [shares], blockNumber }),
      ]);
      const token = await getToken(underlying);
      const supplied = amount(raw, token.decimals);
      const supplyRate = await fluidLendingRate(client, deployment.fluid.lending, fToken, blockNumber);
      if (raw === 0n) throw new Error('Unexpected zero assets');
      if (token.priceUsd === null) warnings.add('Some lending deposits have no verified USD price. Their dollar values are unknown.');
      return { id: `fluid-lending-${fToken}`, label: `${token.symbol} lending deposit`, suppliedUsd: token.priceUsd === null ? null : supplied * token.priceUsd, debtUsd: 0, healthFactor: null, risk: 'no-debt', assets: [{ supplyRate, symbol: token.symbol, address: token.address, supplied, borrowed: 0, priceUsd: token.priceUsd, collateral: false, liquidationThreshold: null, liquidationPriceUsd: null }], notes: ['fToken shares are converted to current underlying assets, including accrued interest. Shares are not added a second time.', 'This is a lending-only deposit. It has no borrowing position or collateral liquidation price.'] };
    } catch {
      warnings.add('Some Fluid lending deposits could not be checked. Their balances are unknown.');
      return unknownPosition(`fluid-lending-${fToken}`, `Fluid lending · ${fToken.slice(0, 8)}…`);
    }
  }
  // Discover both product families independently: a failure must not hide successful reads in the other.
  const [vaultDiscovery, lendingDiscovery] = await Promise.allSettled([
    client.readContract({ address: deployment.fluid.vault, abi: vaultResolverAbi, functionName: 'positionsNftIdOfUser', args: [wallet], blockNumber }),
    client.readContract({ address: deployment.fluid.lending, abi: lendingResolverAbi, functionName: 'getAllFTokens', blockNumber }),
  ]);
  if (vaultDiscovery.status === 'rejected' && lendingDiscovery.status === 'rejected') throw new Error('Fluid discovery failed');
  if (vaultDiscovery.status === 'rejected') warnings.add('Fluid vault discovery failed. Vault balances and risk have not been checked.');
  if (lendingDiscovery.status === 'rejected') warnings.add('Fluid lending discovery failed. Lending balances have not been checked.');
  const [vaults, lending] = await Promise.all([
    vaultDiscovery.status === 'fulfilled' ? mapLimited([...new Set(vaultDiscovery.value)], vaultPosition) : [],
    lendingDiscovery.status === 'fulfilled' ? mapLimited([...new Set(lendingDiscovery.value)], lendingPosition) : [],
  ]);
  return { id: 'fluid', name: 'Fluid', status: warnings.size ? 'partial' : 'ok', coverage: FLUID_COVERAGE.replace('Ethereum', deployment.name), message: warnings.size ? [...warnings].join(' ') : undefined, positions: [...vaults, ...lending].filter((p): p is Position => p !== null) };
}
