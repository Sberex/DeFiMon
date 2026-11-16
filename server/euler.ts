import { getAddress, isAddress, type Address } from 'viem';
import type { NetworkId } from '../src/types.js';
import type { ChainClient } from './rpc.js';
import { eulerDeployments } from './deployments/euler.js';
import { eulerFactoryAbi, eulerVaultAbi } from './abis/euler.js';
import { tokenMetadata, minimum, remaining, liquidityQuote } from './market-liquidity.js';
import { rate, unavailableRate } from './rates.js';
// Euler EVK Constants.sol and periphery Lens/Utils.sol use 365.2425 days.
export const EULER_YEAR_SECONDS = 31_556_952;
export function eulerBorrowApy(perSecondRay: bigint): number | null {
  if (perSecondRay < 0n) return null;
  // log1p/expm1 avoid precision loss when the per-second rate is very small.
  const apy = Math.expm1(EULER_YEAR_SECONDS * Math.log1p(Number(perSecondRay) / 1e27));
  return Number.isFinite(apy) ? apy : null;
}
export const EULER_COVERAGE = 'Euler V2 EVK: direct wallet vault deposits and enabled collateral/loans in owned EVC subaccounts. Excludes legacy V1, Euler Earn aggregators, externally owned smart accounts and passive deposits in subaccounts with no enabled vaults.';
const ZERO = '0x0000000000000000000000000000000000000000';
export const eulerAddress = (value: string): Address => {
  if (!isAddress(value, { strict: false }) || value.toLowerCase() === ZERO) throw new Error('Invalid vault address');
  return getAddress(value.toLowerCase());
};
export function resolveEulerCap(raw: number): bigint | null {
  if (!Number.isInteger(raw) || raw < 0 || raw > 65535) throw new Error('Invalid cap');
  return raw === 0 ? null : 10n ** BigInt(raw & 63) * BigInt(raw >> 6) / 100n;
}
export async function eulerRegistry(client: ChainClient, network: NetworkId, blockNumber: bigint, warn: (message: string) => void) {
  const factory = eulerDeployments[network].eVaultFactory;
  const length = await client.readContract({ address: factory, abi: eulerFactoryAbi, functionName: 'getProxyListLength', blockNumber });
  const end = length > 4096n ? 4096n : length, vaults: Address[] = []; let complete = end === length;
  if (!complete) warn('Euler factory discovery reached its 4096-vault limit. Additional deposits and markets may be missing.');
  for (let start = 0n; start < end; start += 200n) {
    const stop = minimum(start + 200n, end);
    try {
      const rows = await client.readContract({ address: factory, abi: eulerFactoryAbi, functionName: 'getProxyListSlice', args: [start, stop], blockNumber });
      if (rows.length !== Number(stop - start)) throw new Error('Incomplete registry');
      for (const row of rows) vaults.push(eulerAddress(row));
    } catch { complete = false; warn('Some Euler registry pages could not be read. Their vaults remain unknown.'); }
  }
  const unique = [...new Map(vaults.map(v => [v.toLowerCase(), v])).values()];
  if (unique.length !== vaults.length) { complete = false; warn('Euler registry returned duplicate entries. Complete coverage could not be verified.'); }
  return { vaults: unique, complete };
}
export function createEulerReader(client: ChainClient, network: NetworkId, blockNumber: bigint) {
  const deployment = eulerDeployments[network];
  const tokens = new Map<string, ReturnType<typeof tokenMetadata>>();
  const basics = new Map<string, ReturnType<typeof basic>>(), rates = new Map<string, ReturnType<typeof readRates>>();
  async function basic(address: Address) {
    const [registered, evc, asset, name] = await Promise.all([
      client.readContract({ address: deployment.eVaultFactory, abi: eulerFactoryAbi, functionName: 'isProxy', args: [address], blockNumber }),
      client.readContract({ address, abi: eulerVaultAbi, functionName: 'EVC', blockNumber }),
      client.readContract({ address, abi: eulerVaultAbi, functionName: 'asset', blockNumber }),
      client.readContract({ address, abi: eulerVaultAbi, functionName: 'name', blockNumber }),
    ]);
    if (!registered || evc.toLowerCase() !== deployment.evc.toLowerCase() || typeof name !== 'string' || name.length > 256) throw new Error('Euler vault identity mismatch');
    const token = eulerAddress(asset);
    if (!tokens.has(token.toLowerCase())) tokens.set(token.toLowerCase(), tokenMetadata(client, token, blockNumber));
    const metadata = await tokens.get(token.toLowerCase())!;
    if (metadata.decimals > 36 || !metadata.symbol || metadata.symbol.length > 128) throw new Error('Invalid underlying');
    return { address, asset: token, name, ...metadata };
  }
  function vault(address: Address) {
    const key = address.toLowerCase();
    if (!basics.has(key)) basics.set(key, basic(address));
    return basics.get(key)!;
  }
  async function readRates(address: Address) {
    try {
      const [spy, cash, borrowed, fee] = await Promise.all([
        client.readContract({ address, abi: eulerVaultAbi, functionName: 'interestRate', blockNumber }),
        client.readContract({ address, abi: eulerVaultAbi, functionName: 'cash', blockNumber }),
        client.readContract({ address, abi: eulerVaultAbi, functionName: 'totalBorrows', blockNumber }),
        client.readContract({ address, abi: eulerVaultAbi, functionName: 'interestFee', blockNumber }),
      ]);
      if (fee > 10000) throw new Error('Invalid fee');
      const borrowApr = Number(spy) / 1e27 * EULER_YEAR_SECONDS;
      const borrowApy = eulerBorrowApy(spy);
      const supplyApr = cash + borrowed === 0n ? 0 : borrowApr * Number(borrowed) / Number(cash + borrowed) * (1 - fee / 10000);
      return { borrowApy, supplyRate: rate(supplyApr, 'Instant Euler EVK lending APR: current borrowing rate × utilization × (1 − interest fee). No compounding or external rewards.'), borrowRate: rate(borrowApr, 'Instant Euler EVK interest-model APR from the current on-chain per-second ray rate using Euler’s 365.2425-day year. No compounding or external rewards.'), cash, borrowed };
    } catch { return { borrowApy: null, supplyRate: unavailableRate(), borrowRate: unavailableRate(), cash: null, borrowed: null }; }
  }
  function interest(address: Address) {
    const key = address.toLowerCase(); if (!rates.has(key)) rates.set(key, readRates(address)); return rates.get(key)!;
  }
  async function liquidity(address: Address) {
    try {
      const [info, current, caps] = await Promise.all([vault(address), interest(address), client.readContract({ address, abi: eulerVaultAbi, functionName: 'caps', blockNumber })]);
      if (current.cash === null || current.borrowed === null) return null;
      const cap = resolveEulerCap(caps[1]);
      const available = cap === null ? current.cash : minimum(current.cash, remaining(cap, current.borrowed));
      return liquidityQuote(available, info.decimals, info.symbol, info.asset, 'Euler accounted vault cash limited by its remaining borrowing cap. Collateral limits, hooks and account access can restrict actual borrowing.');
    } catch { return null; }
  }
  return { vault, interest, liquidity };
}
