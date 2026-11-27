import { formatUnits, getAddress, type Address } from 'viem';
import type { Asset, NetworkId, Position, ProtocolResult } from '../../src/types.js';
import type { ChainClient } from '../rpc.js';
import { eulerEvcAbi, eulerVaultAbi, eulerOracleAbi, eulerOracleConfigAbi } from '../abis/euler.js';
import { createEulerReader, eulerAddress, eulerRegistry, EULER_COVERAGE } from '../euler.js';
import { eulerDeployments } from '../deployments/euler.js';
import { limited } from '../market-readers.js';
import { walletPrices } from '../wallet-prices.js';
import { weightedRate } from '../rates.js';
import { liquidationPrices, riskLevel } from '../risk.js';
import { readEulerCollateralOracles } from '../euler-risk.js';
export const eulerSubaccounts = (wallet: Address) => Array.from({ length: 256 }, (_, i) => getAddress(`0x${(BigInt(wallet) ^ BigInt(i)).toString(16).padStart(40, '0')}`));
const units = (raw: bigint, decimals: number) => Number(formatUnits(raw, decimals));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const unknown = (id: string, label: string, receiptTokens: string[] = []): Position => ({ id, label, receiptTokens, assets: [], suppliedUsd: null, debtUsd: null, healthFactor: null, risk: 'unknown', notes: ['This Euler position could not be read. Its balances and risk are unknown, not zero.'] });
export async function readEuler(client: ChainClient, wallet: Address, blockNumber: bigint, network: NetworkId = 'ethereum', pricesFor = walletPrices): Promise<ProtocolResult> {
  const warnings = new Set<string>(), warn = (message: string) => warnings.add(message);
  const deployment = eulerDeployments[network];
  if (!deployment) throw Error('Euler is not deployed on this network');
  const reader = createEulerReader(client, network, blockNumber);
  const registry = await eulerRegistry(client, network, blockNumber, warn); let complete = registry.complete;
  const scanWarn = (message: string) => { complete = false; warn(message); };
  const owner = await client.readContract({ address: deployment.evc, abi: eulerEvcAbi, functionName: 'getAccountOwner', args: [wallet], blockNumber });
  const accounts = same(owner, wallet) ? eulerSubaccounts(wallet) : [wallet];
  const accountChunks = Array.from({ length: Math.ceil(accounts.length / 32) }, (_, i) => accounts.slice(i * 32, (i + 1) * 32));
  const enabled = (await limited(accountChunks, async chunk => {
    const results = await client.multicall({ contracts: chunk.flatMap(account => ([
      { address: deployment.evc, abi: eulerEvcAbi, functionName: 'getControllers' as const, args: [account] as const },
      { address: deployment.evc, abi: eulerEvcAbi, functionName: 'getCollaterals' as const, args: [account] as const },
    ])), blockNumber, allowFailure: true, batchSize: 8192 });
    return chunk.flatMap((account, i) => {
      const controllers = results[i * 2], collaterals = results[i * 2 + 1];
      if (controllers?.status !== 'success' || collaterals?.status !== 'success' || !Array.isArray(controllers.result) || !Array.isArray(collaterals.result)) { complete = false; warn('Some Euler subaccounts could not be checked. Their balances are unknown.'); return []; }
      return [{ account, controllers: controllers.result.map(eulerAddress), collaterals: collaterals.result.map(eulerAddress) }];
    });
  }, scanWarn)).flat();
  if (enabled.length !== accounts.length) complete = false;
  const balances = new Map<string, bigint>();
  const chunks = Array.from({ length: Math.ceil(registry.vaults.length / 100) }, (_, i) => registry.vaults.slice(i * 100, (i + 1) * 100));
  const scans = await limited(chunks, async vaults => {
    const results = await client.multicall({ contracts: vaults.map(address => ({ address, abi: eulerVaultAbi, functionName: 'balanceOf' as const, args: [wallet] as const })), blockNumber, allowFailure: true, batchSize: 8192 });
    results.forEach((result, i) => {
      if (result.status === 'success' && typeof result.result === 'bigint') balances.set(vaults[i].toLowerCase(), result.result);
      else { complete = false; warn('Some Euler wallet vault balances could not be checked. Additional deposits may be missing.'); }
    });
    return results.length;
  }, scanWarn);
  if (scans.reduce((a, b) => a + b, 0) !== registry.vaults.length) complete = false;
  const primaryUsed = new Set<string>();
  interface Raw { account: Address; controller?: Address; label: string; receipts: Address[]; assets: Asset[]; health: number | null; collateralOracleChecks: NonNullable<Position['collateralOracleChecks']> }
  const rawPositions: Raw[] = [], unknownPositions: Position[] = [];
  async function readPosition(account: Address, controller: Address | undefined, receipts: Address[], label: string, collateralVaults: Address[]) {
    const id = `euler-${account}-${controller ?? receipts[0]}`;
    try {
      const rows = await Promise.all(receipts.map(async address => {
        const shares = same(account, wallet) && balances.has(address.toLowerCase()) ? balances.get(address.toLowerCase())! : await client.readContract({ address, abi: eulerVaultAbi, functionName: 'balanceOf', args: [account], blockNumber });
        const borrowed = controller && same(controller, address) ? await client.readContract({ address, abi: eulerVaultAbi, functionName: 'debtOf', args: [account], blockNumber }) : 0n;
        if (shares === 0n && borrowed === 0n) return null;
        const info = await reader.vault(address);
        const supplied = shares === 0n ? 0n : await client.readContract({ address, abi: eulerVaultAbi, functionName: 'convertToAssets', args: [shares], blockNumber });
        const current = await reader.interest(address);
        let threshold: number | null = 0;
        if (controller && collateralVaults.some(c => same(c, address))) {
          try { threshold = Number(await client.readContract({ address: controller, abi: eulerVaultAbi, functionName: 'LTVLiquidation', args: [address], blockNumber })) / 10000; if (threshold > 1) throw new Error('Invalid LTV'); }
          catch { threshold = null; warn('Some Euler collateral liquidation factors could not be read. Their price estimates are unavailable.'); }
        }
        return { info, asset: { address: info.asset, symbol: info.symbol, supplied: units(supplied, info.decimals), borrowed: units(borrowed, info.decimals), priceUsd: null, collateral: controller !== undefined && collateralVaults.some(c => same(c, address)) && supplied > 0n, liquidationThreshold: threshold, liquidationPriceUsd: null, supplyRate: current.supplyRate, borrowRate: current.borrowRate } satisfies Asset };
      }));
      const active = rows.filter((r): r is NonNullable<typeof r> => r !== null);
      if (!active.length) return;
      let health: number | null = null;
      if (controller && active.some(r => r.asset.borrowed > 0)) {
        try { const [collateral, debt] = await client.readContract({ address: controller, abi: eulerVaultAbi, functionName: 'accountLiquidity', args: [account, true], blockNumber }); if (debt > 0n) health = Number(collateral) / Number(debt); if (!Number.isFinite(health)) health = null; }
        catch { warn('Euler’s native liquidation health could not be read for some loans. Their risk is unknown.'); }
      }
      const controllerName = active.find(r => controller && same(r.info.address, controller))?.info.name;
      const displayLabel = controllerName ? `Euler · ${controllerName} · account ${account.slice(0, 8)}…${account.slice(-4)}` : !controller && active.length === 1 ? `Euler deposit · ${active[0].info.name} · ${receipts[0].slice(0, 10)}…` : label;
      const heldCollateral = controller ? active.filter(r => r.asset.collateral).map(r => r.info.address) : undefined;
      const collateralOracleChecks = await readEulerCollateralOracles(client, controller ?? receipts[0], heldCollateral, blockNumber, reader.vault);
      if (collateralOracleChecks.some(c => c.status !== 'ok')) warn('Some Euler collateral oracles could not return a positive price. Affected positions are listed in Risk Assessment.');
      rawPositions.push({ account, controller, receipts, label: displayLabel, health, assets: active.map(r => r.asset), collateralOracleChecks });
    } catch { complete = false; warn('Some Euler holdings could not be verified. Their balances remain unknown.'); unknownPositions.push(unknown(id, label, receipts)); }
  }
  await limited(enabled, async account => {
    if (account.controllers.length > 1) { complete = false; warn('An Euler subaccount has multiple controllers; its positions could not be safely combined.'); unknownPositions.push(unknown(`euler-${account.account}`, `Euler subaccount ${account.account}`)); return; }
    if (!account.controllers.length && !account.collaterals.length) return;
    const controller = account.controllers[0];
    const receipts = [...new Map([...account.controllers, ...account.collaterals].map(a => [a.toLowerCase(), a])).values()];
    if (same(account.account, wallet)) receipts.forEach(a => primaryUsed.add(a.toLowerCase()));
    await readPosition(account.account, controller, receipts, `Euler · ${controller ? 'Loan' : 'Collateral deposits'} · account ${account.account.slice(0, 8)}…${account.account.slice(-4)}`, account.collaterals);
  }, scanWarn);
  const passive = registry.vaults.filter(v => (balances.get(v.toLowerCase()) ?? 0n) > 0n && !primaryUsed.has(v.toLowerCase()));
  await limited(passive, address => readPosition(wallet, undefined, [address], `Euler vault deposit · ${address.slice(0, 10)}…`, []), scanWarn);
  const tokenInfos = [...new Map((await Promise.all(rawPositions.flatMap(p => p.receipts).map(address => reader.vault(address).catch(() => null)))).filter((r): r is NonNullable<typeof r> => !!r).map(r => [r.asset.toLowerCase(), { address: r.asset, decimals: r.decimals }])).values()];
  const prices = tokenInfos.length ? await pricesFor(client, network, blockNumber, tokenInfos).catch(() => new Map<string, number>()) : new Map<string, number>();
  const oraclePriced = new Set<string>();
  const usd = '0x0000000000000000000000000000000000000348' as Address;
  await limited(rawPositions, async raw => {
    const missing = raw.assets.filter(a => !prices.has(a.address.toLowerCase()));
    if (!missing.length) return;
    const controller = raw.controller ?? raw.receipts[0];
    try {
      const [oracle, unit] = await Promise.all([
        client.readContract({ address: controller, abi: eulerOracleConfigAbi, functionName: 'oracle', blockNumber }),
        client.readContract({ address: controller, abi: eulerOracleConfigAbi, functionName: 'unitOfAccount', blockNumber }),
      ]);
      if (!same(unit, usd) || /^0x0{40}$/i.test(oracle)) return;
      await Promise.all(missing.map(async asset => {
        try {
          const info = tokenInfos.find(t => same(t.address, asset.address)); if (!info) return;
          const quoted = await client.readContract({ address: oracle, abi: eulerOracleAbi, functionName: 'getQuote', args: [10n ** BigInt(info.decimals), info.address, usd], blockNumber });
          const price = units(quoted, 18);
          if (price > 0 && Number.isFinite(price)) { prices.set(asset.address.toLowerCase(), price); oraclePriced.add(asset.address.toLowerCase()); }
        } catch { /* A missing Euler route is unknown, not a stablecoin peg. */ }
      }));
    } catch { /* The vault may have no USD-denominated oracle. */ }
  }, message => warn(message));
  const positions = rawPositions.map(raw => {
    const merged = new Map<string, Asset>();
    for (const source of raw.assets) {
      const asset: Asset = { ...source, priceUsd: prices.get(source.address.toLowerCase()) ?? null, ...(oraclePriced.has(source.address.toLowerCase()) ? { priceSource: 'euler-oracle' as const } : {}) };
      const previous = merged.get(asset.address.toLowerCase());
      if (!previous) merged.set(asset.address.toLowerCase(), asset);
      else {
        const oldSupply = previous.supplied, oldDebt = previous.borrowed;
        previous.supplyRate = weightedRate(previous.supplyRate, oldSupply, asset.supplyRate, asset.supplied);
        previous.borrowRate = weightedRate(previous.borrowRate, oldDebt, asset.borrowRate, asset.borrowed);
        const sum = oldSupply + asset.supplied;
        previous.liquidationThreshold = previous.liquidationThreshold === null || asset.liquidationThreshold === null ? null : sum ? ((previous.liquidationThreshold ?? 0) * oldSupply + (asset.liquidationThreshold ?? 0) * asset.supplied) / sum : 0;
        previous.collateralSupplied = (previous.collateralSupplied ?? (previous.collateral ? oldSupply : 0)) + (asset.collateral ? asset.supplied : 0);
        previous.supplied += asset.supplied; previous.borrowed += asset.borrowed; previous.collateral ||= asset.collateral;
        previous.lltvNote = 'Effective liquidation factor weighted across this underlying token’s Euler receipt vaults and supplied balances.';
      }
    }
    const assets = [...merged.values()];
    const total = (side: 'supplied' | 'borrowed') => assets.some(a => a[side] > 0 && a.priceUsd === null) ? null : assets.reduce((s, a) => s + a[side] * (a.priceUsd ?? 0), 0);
    const suppliedUsd = total('supplied'), debtUsd = total('borrowed');
    if (suppliedUsd === null || debtUsd === null) warn('Some Euler USD prices are unavailable. Token balances and native health remain visible.');
    const weighted = assets.reduce((s, a) => s + a.supplied * (a.priceUsd ?? 0) * (a.liquidationThreshold ?? 0), 0);
    const model = suppliedUsd !== null && debtUsd !== null && assets.every(a => !a.collateral || a.liquidationThreshold !== null) && (debtUsd === 0 || (raw.health !== null && weighted > 0 && Math.abs(weighted / debtUsd - raw.health) / Math.max(raw.health, .0001) <= .05));
    return { collateralOracleChecks: raw.collateralOracleChecks, id: `euler-${raw.account}-${raw.controller ?? raw.receipts[0]}`, label: raw.label, marketAddress: raw.controller ?? raw.receipts[0], receiptTokens: raw.receipts, assets: model && debtUsd !== null ? liquidationPrices(assets, debtUsd, weighted) : assets, suppliedUsd, debtUsd, healthFactor: raw.health, risk: riskLevel(assets.some(a => a.borrowed > 0) ? 1 : 0, raw.health), liquidationModel: model ? 'linear' as const : 'unavailable' as const, notes: [
      `Euler EVK account ${raw.account}. Each vault share is converted once to its current underlying assets. Receipt-token wallet balances are excluded from wallet totals.`,
      'Native health uses Euler’s own liquidation oracle and current, potentially ramping liquidation LTV. USD totals use independently verified display prices; no stablecoin peg is assumed.',
      'Liquidation prices are estimates holding other USD prices and debt fixed. They are withheld if display-price collateral capacity differs materially from native oracle health, or a factor is missing.',
      ...raw.receipts.map(a => `Euler receipt vault: ${a}`),
    ] } satisfies Position;
  });
  if (!complete && !warnings.size) warn('Euler position discovery was incomplete. Additional balances remain unknown.');
  return { id: 'euler', name: 'Euler', coverage: EULER_COVERAGE, status: warnings.size ? 'partial' : 'ok', balanceDiscoveryComplete: complete, message: warnings.size ? [...warnings].join(' ') : undefined, positions: [...positions, ...unknownPositions] };
}
