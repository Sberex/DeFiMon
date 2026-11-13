import { parseAbi, type Address } from 'viem';
import type { NetworkId } from '../src/types.js';
import { networks } from './networks.js';
import type { ChainClient } from './rpc.js';
const providerAbi = parseAbi(['function getPriceOracle() view returns (address)']);
const oracleAbi = parseAbi(['function getAssetPrice(address) view returns (uint256)', 'function BASE_CURRENCY_UNIT() view returns (uint256)']);
const registryAbi = parseAbi(['function decimals(address,address) view returns (uint8)', 'function latestRoundData(address,address) view returns (uint80,int256,uint256,uint256,uint80)']);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Current display prices only. External lookups send token addresses, never the wallet or provider URL. */
export async function walletPrices(client: ChainClient, network: NetworkId, blockNumber: bigint, tokens: { address: Address; decimals: number }[], fetcher: typeof fetch = fetch): Promise<Map<string, number>> {
  const config = networks[network];
  const prices = new Map<string, number>();
  const unique = [...new Map(tokens.map(t => [t.address.toLowerCase(), t])).values()];
  try {
    const oracle = await client.readContract({ address: config.aaveProvider, abi: providerAbi, functionName: 'getPriceOracle', blockNumber });
    const unit = await client.readContract({ address: oracle, abi: oracleAbi, functionName: 'BASE_CURRENCY_UNIT', blockNumber });
    if (unit <= 0n) throw new Error('Invalid price unit');
    const results = await client.multicall({ contracts: unique.map(token => ({ address: oracle, abi: oracleAbi, functionName: 'getAssetPrice' as const, args: [token.address] as const })), blockNumber, allowFailure: true });
    results.forEach((result, i) => {
      if (result.status !== 'success') return;
      const price = Number(result.result) / Number(unit);
      if (positive(price)) prices.set(unique[i].address.toLowerCase(), price);
    });
  } catch { /* Other price sources remain independent of this provider's oracle. */ }
  const registry = config.chainlinkRegistry;
  const registryMissing = unique.filter(t => !prices.has(t.address.toLowerCase()));
  if (registry && registryMissing.length) {
    let timestamp: bigint | undefined;
    try { timestamp = (await client.getBlock({ blockNumber })).timestamp; } catch { /* A fresh round cannot be verified. */ }
    if (timestamp !== undefined) {
      for (let start = 0; start < registryMissing.length; start += 4) await Promise.all(registryMissing.slice(start, start + 4).map(async token => {
        try {
          const base = token.address.toLowerCase() === config.wrappedNative.toLowerCase() ? '0xEeeeeEeeeEeEeeEeEeEeEeeEEEeeeeEeeeeeeeEEeE' : token.address;
          const quote = '0x0000000000000000000000000000000000000348';
          const [round, decimals] = await Promise.all([
            client.readContract({ address: registry, abi: registryAbi, functionName: 'latestRoundData', args: [base, quote], blockNumber }),
            client.readContract({ address: registry, abi: registryAbi, functionName: 'decimals', args: [base, quote], blockNumber }),
          ]);
          const price = Number(round[1]) / 10 ** decimals;
          if (round[3] > 0n && round[3] <= timestamp! && timestamp! - round[3] <= 86400n && round[4] >= round[0] && positive(price)) prices.set(token.address.toLowerCase(), price);
        } catch { /* A missing feed is unknown, never a presumed stablecoin peg. */ }
      }));
    }
  }
  const missing = unique.filter(t => !prices.has(t.address.toLowerCase()));
  // Public DefiLlama Coins API, bounded batches. An unavailable service cannot hide balances.
  for (let start = 0; start < missing.length; start += 40) {
    const batch = missing.slice(start, start + 40);
    const keys = batch.map(t => `${network}:${t.address.toLowerCase()}`);
    try {
      const response = await fetcher(`https://coins.llama.fi/prices/current/${keys.join(',')}`, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (!response.ok) continue;
      const text = await response.text(); if (text.length > 2_000_000) continue;
      const coins = JSON.parse(text)?.coins;
      const now = Date.now() / 1000;
      batch.forEach((token, i) => {
        const coin = coins?.[keys[i]];
        if (!coin || !positive(coin.price) || !positive(coin.timestamp) || now - coin.timestamp > 3600 || coin.timestamp > now + 300 || !positive(coin.confidence) || coin.confidence < 0.9 || coin.decimals !== token.decimals) return;
        prices.set(token.address.toLowerCase(), coin.price);
      });
    } catch { /* Network policy, timeout, rate limits, or invalid responses leave prices unknown. */ }
  }
  return prices;
}
