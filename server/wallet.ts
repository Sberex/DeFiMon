import { formatUnits, getAddress, parseAbi, type Address } from 'viem';
import type { NetworkId, ProtocolResult, WalletBalances, WalletToken } from '../src/types.js';
import type { ChainClient } from './rpc.js';
import { networks } from './networks.js';
import { walletTokenCatalog } from './deployments/wallet-tokens.js';
import { AAVE_V4_TOKENIZATION_SPOKES } from './deployments/aave-v4.js';
import { walletPrices } from './wallet-prices.js';
const tokenAbi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function POOL() view returns (address)']);
const providerAbi = parseAbi(['function getPoolDataProvider() view returns (address)', 'function getPool() view returns (address)']);
const dataAbi = parseAbi(['function getAllATokens() view returns ((string symbol,address tokenAddress)[])']);
const lendingAbi = parseAbi(['function getAllFTokens() view returns (address[])']);
const coverage = 'Native currency and the supported token list, plus added token contracts. This is not automatic discovery of every token. Lending receipt tokens already represented by protocol readers are excluded from wallet totals.';
export function unavailableWallet(network: NetworkId): WalletBalances {
  return { chain: networks[network].name, status: 'error', tokens: [], pricedValueUsd: null, unpricedCount: 0, coverage, message: 'Wallet token balances could not be checked on this network. Their values are unknown.' };
}

export async function readWallet(client: ChainClient, wallet: Address, blockNumber: bigint, network: NetworkId, protocols: ProtocolResult[], extraTokens: string[] = [], catalog = walletTokenCatalog[network], priceReader = walletPrices): Promise<WalletBalances> {
  const config = networks[network];
  const addresses = [...new Map([...catalog, ...extraTokens.map(address => ({ address: getAddress(address.toLowerCase()), symbol: 'Added token' }))].map(t => [t.address.toLowerCase(), t])).values()];
  const [native, balances, aTokens, fTokens, aavePool] = await Promise.allSettled([
    client.getBalance({ address: wallet, blockNumber }),
    client.multicall({ contracts: addresses.map(t => ({ address: t.address, abi: tokenAbi, functionName: 'balanceOf' as const, args: [wallet] as const })), blockNumber, allowFailure: true, batchSize: 8192 }),
    (async () => {
      const data = await client.readContract({ address: config.aaveProvider, abi: providerAbi, functionName: 'getPoolDataProvider', blockNumber });
      return client.readContract({ address: data, abi: dataAbi, functionName: 'getAllATokens', blockNumber });
    })(),
    client.readContract({ address: config.fluid.lending, abi: lendingAbi, functionName: 'getAllFTokens', blockNumber }),
    client.readContract({ address: config.aaveProvider, abi: providerAbi, functionName: 'getPool', blockNumber }),
  ]);
  const excluded = new Set<string>();
  if (aTokens.status === 'fulfilled') aTokens.value.forEach(t => excluded.add(t.tokenAddress.toLowerCase()));
  if (fTokens.status === 'fulfilled') fTokens.value.forEach(t => excluded.add(t.toLowerCase()));
  if (network === 'ethereum') {
    AAVE_V4_TOKENIZATION_SPOKES.forEach(t => excluded.add(t.address.toLowerCase()));
  }
  config.compoundMarkets.forEach(m => excluded.add(m.address.toLowerCase()));
  protocols.filter(p => p.id === 'morpho').flatMap(p => p.positions).forEach(p => {
      const match = p.id.match(/^morpho-vault-(0x[0-9a-fA-F]{40})$/); if (match) excluded.add(match[1].toLowerCase());
    });
  const receiptsVerified = aTokens.status === 'fulfilled' && fTokens.status === 'fulfilled' && aavePool.status === 'fulfilled';
  const rows: (WalletToken & { decimals: number; priceAddress: Address })[] = [];
  const warnings = new Set<string>();
  let omitted = 0;
  let failed = native.status === 'rejected' ? 1 : 0;
  const nativeBalance = native.status === 'fulfilled' ? Number(formatUnits(native.value, 18)) : null;
  rows.push({ address: 'native', symbol: config.nativeSymbol, decimals: 18, priceAddress: config.wrappedNative, balance: nativeBalance, priceUsd: null, valueUsd: nativeBalance === 0 ? 0 : null });
  if (balances.status !== 'fulfilled' || balances.value.length !== addresses.length) {
    failed += addresses.length; omitted += addresses.length; warnings.add('Token balance discovery failed. Additional wallet assets have not been checked.');
  } else {
    const held = balances.value.flatMap((result, i) => {
      if (result.status !== 'success') { failed++; omitted++; return []; }
      return result.result > 0n ? [{ ...addresses[i], raw: result.result }] : [];
    });
    for (let start = 0; start < held.length; start += 4) await Promise.all(held.slice(start, start + 4).map(async token => {
      try {
        const [symbol, decimals] = await Promise.all([
          client.readContract({ address: token.address, abi: tokenAbi, functionName: 'symbol', blockNumber }),
          client.readContract({ address: token.address, abi: tokenAbi, functionName: 'decimals', blockNumber }),
        ]);
        if (decimals > 36 || typeof symbol !== 'string' || symbol.length > 128) throw new Error('Invalid metadata');
        let excludedReason = excluded.has(token.address.toLowerCase()) ? 'Lending receipt token: its underlying value belongs in the protocol section.' : !receiptsVerified ? 'Excluded from totals because the lending receipt-token check is unavailable.' : undefined;
        if (!excludedReason && aavePool.status === 'fulfilled') {
          try {
            // Both aTokens and variable/stable debt accounting tokens identify
            // their Aave pool. Debt balances must never be counted as assets.
            const pool = await client.readContract({ address: token.address, abi: tokenAbi, functionName: 'POOL', blockNumber });
            if (pool.toLowerCase() === aavePool.value.toLowerCase()) excludedReason = 'Aave receipt or debt accounting token: excluded from wallet assets.';
          } catch { /* Ordinary ERC20 tokens do not expose an Aave pool. */ }
        }
        rows.push({ address: token.address, symbol, decimals, priceAddress: token.address, balance: Number(formatUnits(token.raw, decimals)), priceUsd: null, valueUsd: null, excludedReason });
      } catch {
        failed++;
        rows.push({ address: token.address, symbol: token.symbol, decimals: 18, priceAddress: token.address, balance: null, priceUsd: null, valueUsd: null });
      }
    }));
  }
  if (!receiptsVerified) warnings.add('Receipt-token classification is incomplete. ERC-20 values are excluded from the net total to avoid counting lending deposits twice.');
  const toPrice = rows.filter(t => !t.excludedReason && t.balance !== null && t.balance > 0).map(t => ({ address: t.priceAddress, decimals: t.decimals }));
  const prices = toPrice.length ? await priceReader(client, network, blockNumber, toPrice).catch(() => new Map<string, number>()) : new Map<string, number>();
  rows.forEach(token => {
    token.priceUsd = prices.get(token.priceAddress.toLowerCase()) ?? null;
    if (!token.excludedReason && token.balance !== null && token.priceUsd !== null) { const value = token.balance * token.priceUsd; token.valueUsd = Number.isFinite(value) ? value : null; }
  });
  if (failed) warnings.add(`${failed} token balance or metadata reads failed. Those amounts are unknown and excluded from totals.`);
  const unpricedCount = rows.filter(t => !t.excludedReason && t.valueUsd === null).length;
  if (unpricedCount) warnings.add('Some wallet token prices or balances are unavailable. Net value includes only priced amounts.');
  const priced = rows.filter(t => !t.excludedReason && t.valueUsd !== null);
  const tokens = rows.sort((a, b) => a.address === 'native' ? -1 : b.address === 'native' ? 1 : a.symbol.localeCompare(b.symbol)).map(({ decimals: _decimals, priceAddress: _priceAddress, ...token }) => token);
  return { chain: config.name, status: warnings.size ? 'partial' : 'ok', tokens, pricedValueUsd: priced.length ? priced.reduce((sum, token) => sum + token.valueUsd!, 0) : null, unpricedCount: unpricedCount + omitted, coverage, message: warnings.size ? [...warnings].join(' ') : undefined };
}
