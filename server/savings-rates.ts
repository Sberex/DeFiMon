import { readFileSync } from 'node:fs';
import { isAddress, parseAbi, type Address } from 'viem';
import type { IntrinsicRate, NetworkId, ProtocolResult } from '../src/types.js';
import { networkNames, networkOrder } from '../src/networks.js';
import { networks } from './networks.js';
import { configuredTokenRegistry, type TokenRegistry } from './token-registry.js';
import { makeClient, type ChainClient } from './rpc.js';
const DAY = 86400n, WINDOW = 30n * DAY;
const zero = /^0x0{40}$/i;
const chainlinkAbi = parseAbi(['function decimals() view returns(uint8)', 'function description() view returns(string)', 'function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)']);
const vaultAbi = parseAbi(['function asset() view returns(address)', 'function decimals() view returns(uint8)', 'function convertToAssets(uint256) view returns(uint256)']);
const providerAbi = parseAbi(['function getPriceOracle() view returns(address)', 'function getSourceOfAsset(address) view returns(address)']);
const morphoAbi = parseAbi(['function idToMarketParams(bytes32) view returns(address loanToken,address collateralToken,address oracle,address irm,uint256 lltv)', 'function BASE_FEED_1() view returns(address)', 'function BASE_FEED_2() view returns(address)', 'function BASE_VAULT() view returns(address)']);
export interface SavingsSource { network: NetworkId; kind: 'chainlink' | 'erc4626'; address: Address; token: Address; description?: string; decimals?: number; underlying?: Address; label: string }
type Snapshot = { client: ChainClient; end: { number: bigint; timestamp: bigint }; start: { number: bigint; timestamp: bigint } };
type Context = { network: NetworkId; protocol?: string; position?: string; address?: string };
const configuredSources = JSON.parse(readFileSync(new URL('../config/savings-oracles.json', import.meta.url), 'utf8')) as Record<string, SavingsSource>;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function savingsApr(start: bigint, end: bigint): number | null {
  if (start <= 0n || end <= 0n) return null;
  const result = Number(end - start) / Number(start) * 365 / 30;
  return Number.isFinite(result) ? result : null;
}
/** Find the last actual block at or before the exact 30-day boundary. */
export async function savingsSnapshot(client: ChainClient, network: NetworkId, now = Date.now): Promise<Snapshot> {
  if (await client.getChainId() !== networks[network].id) throw new Error('Wrong savings source network');
  const deadline = now() + 45000;
  const number = await client.getBlockNumber(), last = await client.getBlock({ blockNumber: number });
  const end = { number, timestamp: last.timestamp }, target = end.timestamp - WINDOW;
  if (target <= 0n) throw new Error('Insufficient oracle history');
  const cache = new Map<string, { number: bigint; timestamp: bigint }>([[String(number), end]]);
  const read = async (n: bigint) => {
    if (now() > deadline) throw new Error('Historical block search timed out');
    if (!cache.has(String(n))) { const b = await client.getBlock({ blockNumber: n }); cache.set(String(n), { number: n, timestamp: b.timestamp }); }
    return cache.get(String(n))!;
  };
  const estimate = network === 'ethereum' ? 12n : 2n;
  const guess = number > WINDOW / estimate ? number - WINDOW / estimate : 0n;
  let low = await read(guess), high = low, step = 128n;
  if (low.timestamp <= target) {
    for (let i = 0; i < 16; i++) { const n = low.number + step < number ? low.number + step : number; high = await read(n); if (high.timestamp > target) break; low = high; step *= 4n; }
  } else {
    for (let i = 0; i < 16; i++) { const n = high.number > step ? high.number - step : 0n; low = await read(n); if (low.timestamp <= target) break; high = low; step *= 4n; }
  }
  if (low.timestamp > target || high.timestamp <= target) throw new Error('Missing historical boundary');
  for (let i = 0; high.number - low.number > 1n && i < 40; i++) {
    const mid = await read((low.number + high.number) / 2n);
    if (mid.timestamp <= target) low = mid; else high = mid;
  }
  if (high.number - low.number !== 1n || target - low.timestamp > 3600n) throw new Error('Unverified historical boundary');
  return { client, start: low, end };
}
export function savingsFailureReason(error: unknown): string {
  // Inspect errors internally; never return provider URLs, keys or raw responses.
  const message = error instanceof Error ? String(error) : '';
  if (/archive|missing trie|historical state|state.*pruned/i.test(message)) return 'The rate-source provider cannot read the required historical state. Configure an archive RPC for the source network on the server.';
  if (/No verified savings rate source|No canonical token/.test(message)) return 'No verified on-chain savings-rate source is configured for this asset.';
  if (/Invalid oracle observation|changed unit|unit changed|Wrong savings vault underlying/.test(message)) return 'The oracle observations failed the freshness or asset-identity checks.';
  return 'The provider could not supply verified current and 30-day-old observations. An archive-capable provider may be required.';
}
function unavailable(group: string, network: NetworkId, address = '', reason = ''): IntrinsicRate {
  return { apr: null, estimated: true, note: `${group} is marked Savings stablecoin. Its current and 30-day-old on-chain rate could not both be verified. ${reason} Intrinsic earnings are unknown, not zero.`, source: { chain: networkNames[network], oracle: address, kind: 'unavailable', label: `${group} rate history unavailable` } };
}
export function createSavingsRateService(options: { clientFor?: (network: NetworkId) => ChainClient; registry?: TokenRegistry; sources?: Record<string, SavingsSource>; now?: () => number } = {}) {
  const clientFor = options.clientFor ?? ((network: NetworkId) => makeClient(network, process.env[`${network.toUpperCase()}_ARCHIVE_RPC_URL`])), registry = options.registry ?? configuredTokenRegistry, sources = options.sources ?? configuredSources, now = options.now ?? Date.now;
  const snapshots = new Map<NetworkId, { expires: number; promise: Promise<Snapshot> }>();
  const quotes = new Map<string, { expires: number; promise: Promise<IntrinsicRate> }>();
  async function snapshot(network: NetworkId) {
    const cached = snapshots.get(network); if (cached && cached.expires > now()) return cached.promise;
    const entry = { expires: now() + 300000, promise: savingsSnapshot(clientFor(network), network, now) };
    snapshots.set(network, entry);
    entry.promise.catch(() => { if (snapshots.get(network) === entry) snapshots.delete(network); });
    return entry.promise;
  }
  async function discover(group: string, context: Context): Promise<SavingsSource> {
    const token = registry[group];
    if (!token || token.category !== 'Savings stablecoin') throw new Error('Not a configured savings asset');
    if (sources[group]) {
      const source = sources[group];
      if (!networkOrder.includes(source.network) || !isAddress(source.address, { strict: false }) || zero.test(source.address) || !same(token.addresses[source.network] ?? '', source.token)) throw new Error('Savings source identity mismatch');
      if (source.kind !== 'chainlink' && source.kind !== 'erc4626') throw new Error('Unknown savings adapter');
      if (source.kind === 'erc4626' && !same(source.address, source.token)) throw new Error('Redemption source is not the canonical token');
      return source;
    }
    const network = token.addresses.ethereum ? 'ethereum' : context.network;
    const address = token.addresses[network] as Address | undefined;
    if (!address) throw new Error('No canonical token');
    const { client, end } = await snapshot(network);
    // A canonical ERC-4626 share rate is intrinsic yield, independent of a USD peg.
    try {
      const underlying = await client.readContract({ address, abi: vaultAbi, functionName: 'asset', blockNumber: end.number });
      if (Object.values(registry).some(t => t.category === 'Stablecoin' && same(t.addresses[network] ?? '', underlying))) {
        return { network, kind: 'erc4626', address, token: address, underlying, label: `${group} on-chain redemption rate` };
      }
    } catch { /* A different savings asset may have a feed instead of ERC-4626. */ }
    try {
      const oracle = await client.readContract({ address: networks[network].aaveProvider, abi: providerAbi, functionName: 'getPriceOracle', blockNumber: end.number });
      const feed = await client.readContract({ address: oracle, abi: providerAbi, functionName: 'getSourceOfAsset', args: [address], blockNumber: end.number });
      if (!zero.test(feed)) return { network, kind: 'chainlink', address: feed, token: address, label: `${group} asset oracle` };
    } catch { /* Aave need not list this asset. */ }
    // A single direct base feed in an actually held Morpho market is attributable
    // to its exact collateral. Composite feeds/vaults are not guessed or flattened.
    if (context.protocol === 'morpho' && context.position?.startsWith('morpho-market-')) {
      const id = context.position.slice('morpho-market-'.length) as `0x${string}`;
      if (/^0x[0-9a-f]{64}$/i.test(id) && networks[context.network].morphoBlue) {
        const s = await snapshot(context.network);
        const params = await s.client.readContract({ address: networks[context.network].morphoBlue!, abi: morphoAbi, functionName: 'idToMarketParams', args: [id], blockNumber: s.end.number });
        if (same(params[1], token.addresses[context.network] ?? '')) {
          const [feed, second, vault] = await Promise.all(['BASE_FEED_1', 'BASE_FEED_2', 'BASE_VAULT'].map(functionName => s.client.readContract({ address: params[2], abi: morphoAbi, functionName: functionName as 'BASE_FEED_1', blockNumber: s.end.number })));
          if (!zero.test(feed) && zero.test(second) && zero.test(vault)) return { network: context.network, kind: 'chainlink', address: feed, token: params[1], label: `${group} collateral oracle base feed` };
        }
      }
    }
    throw new Error('No verified savings rate source');
  }
  async function load(group: string, context: Context): Promise<IntrinsicRate> {
    let source: SavingsSource | undefined;
    try {
      source = await discover(group, context);
      const s = await snapshot(source.network);
      let start: bigint, end: bigint, decimals: number;
      if (source.kind === 'chainlink') {
        const read = async (blockNumber: bigint, timestamp: bigint) => {
          const [round, precision, description] = await Promise.all([
            s.client.readContract({ address: source!.address, abi: chainlinkAbi, functionName: 'latestRoundData', blockNumber }),
            s.client.readContract({ address: source!.address, abi: chainlinkAbi, functionName: 'decimals', blockNumber }),
            s.client.readContract({ address: source!.address, abi: chainlinkAbi, functionName: 'description', blockNumber }),
          ]);
          if (round[1] <= 0n || round[2] <= 0n || round[3] < round[2] || round[3] > timestamp || timestamp - round[3] > 3n * DAY || round[4] < round[0] || precision > 36 || !description || (source!.description && description !== source!.description) || (source!.decimals !== undefined && precision !== source!.decimals)) throw new Error('Invalid oracle observation');
          return { value: round[1], decimals: precision, description };
        };
        const [a, b] = await Promise.all([read(s.start.number, s.start.timestamp), read(s.end.number, s.end.timestamp)]);
        if (a.decimals !== b.decimals || a.description !== b.description) throw new Error('Oracle changed unit or identity');
        start = a.value; end = b.value; decimals = a.decimals;
      } else {
        const read = async (blockNumber: bigint) => {
          const [underlying, shares] = await Promise.all([
            s.client.readContract({ address: source!.address, abi: vaultAbi, functionName: 'asset', blockNumber }),
            s.client.readContract({ address: source!.address, abi: vaultAbi, functionName: 'decimals', blockNumber }),
          ]);
          if (!source!.underlying || !same(underlying, source!.underlying) || shares > 36) throw new Error('Wrong savings vault underlying');
          const [value, precision] = await Promise.all([
            s.client.readContract({ address: source!.address, abi: vaultAbi, functionName: 'convertToAssets', args: [10n ** BigInt(shares)], blockNumber }),
            s.client.readContract({ address: underlying, abi: vaultAbi, functionName: 'decimals', blockNumber }),
          ]);
          if (value <= 0n || precision > 36) throw new Error('Invalid share conversion');
          return { value, decimals: precision, shares };
        };
        const [a, b] = await Promise.all([read(s.start.number), read(s.end.number)]);
        if (a.decimals !== b.decimals || a.shares !== b.shares) throw new Error('Redemption unit changed');
        start = a.value; end = b.value; decimals = a.decimals;
      }
      const apr = savingsApr(start, end); if (apr === null) throw new Error('Invalid savings APR');
      return { apr, estimated: true, note: `Past-month ${group} intrinsic APR: (current on-chain rate − rate 30 days ago) × 365 ÷ (30 × rate 30 days ago). Simple annualization, not compounded APY. Uses ${source.label}; market prices, lending interest and incentives are separate. Past growth is not a promised future return.`, source: { chain: networkNames[source.network], oracle: source.address, kind: source.kind, label: source.label, blockNumber: String(s.end.number), startBlockNumber: String(s.start.number), startTimestamp: Number(s.start.timestamp), endTimestamp: Number(s.end.timestamp), startRate: Number(start) / 10 ** decimals, endRate: Number(end) / 10 ** decimals, windowDays: 30 } };
    } catch (error) { return unavailable(group, source?.network ?? context.network, source?.address, savingsFailureReason(error)); }
  }
  function quote(group: string, context: Context): Promise<IntrinsicRate> {
    const cached = quotes.get(group); if (cached && cached.expires > now()) return cached.promise;
    if (quotes.size >= 256) quotes.delete(quotes.keys().next().value!);
    const entry = { expires: now() + 300000, promise: Promise.resolve().then(() => load(group, context)) };
    quotes.set(group, entry);
    entry.promise = entry.promise.then(result => { entry.expires = now() + (result.apr === null ? 60000 : 300000); return result; });
    return entry.promise;
  }
  return { quote };
}
export const savingsRateService = createSavingsRateService();
export function savingsGroup(network: NetworkId, address: string, registry = configuredTokenRegistry) {
  return Object.entries(registry).find(([, token]) => token.category === 'Savings stablecoin' && same(token.addresses[network] ?? '', address))?.[0];
}
