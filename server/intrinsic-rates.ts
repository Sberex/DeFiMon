import { parseAbi, type Address } from 'viem';
import type { IntrinsicRate, NetworkId, ProtocolResult } from '../src/types.js';
import { makeClient, type ChainClient } from './rpc.js';
import { YEAR_SECONDS } from './rates.js';
// Fluid mainnet CappedRateChainlink_SUSDAI @404d73f points to this raw feed.
// Read the raw sUSDai/USDai rate, never the capped oracle's maximum allowed APR.
export const SUSDAI = '0x0b2b2b2076d95dda7817e785989fe353fe955ef9';
export const SUSDAI_FEED: Address = '0x0fBE44B96320EBD455FF9CCE0781fA9A83Ddee7a';
const DAY = 86400n;
const MASK = (1n << 64n) - 1n;
const abi = parseAbi([
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
  'function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)',
  'function phaseAggregators(uint16) view returns (address)',
]);
type Round = readonly [bigint, bigint, bigint, bigint, bigint];
const source = { chain: 'Ethereum' as const, oracle: SUSDAI_FEED };
const unavailable = (): IntrinsicRate => ({ apr: null, estimated: true, note: 'The past-month sUSDai intrinsic APR could not be verified from Ethereum oracle rounds. This is unknown, not zero. Lending rates and balances remain independent.', source });
function valid(round: Round, timestamp: bigint, expected?: bigint) {
  if ((expected !== undefined && round[0] !== expected) || round[1] <= 0n || round[2] <= 0n || round[3] < round[2] || round[3] > timestamp || round[4] < round[0]) throw new Error('Invalid oracle round');
  return round;
}
/** Uses the feed's existing round records at one current Ethereum block; no wallet history is stored. */
export async function readSusdaiIntrinsicRate(client: ChainClient, blockNumber: bigint): Promise<IntrinsicRate> {
  try {
    const deadline = Date.now() + 30000;
    const [chain, block, decimals, description, latest] = await Promise.all([
      client.getChainId(), client.getBlock({ blockNumber }),
      client.readContract({ address: SUSDAI_FEED, abi, functionName: 'decimals', blockNumber }),
      client.readContract({ address: SUSDAI_FEED, abi, functionName: 'description', blockNumber }),
      client.readContract({ address: SUSDAI_FEED, abi, functionName: 'latestRoundData', blockNumber }),
    ]);
    if (chain !== 1 || decimals !== 18 || description !== 'SUSDAI / USDAI Exchange Rate') throw new Error('Wrong feed identity');
    valid(latest, block.timestamp);
    if (block.timestamp - latest[3] > 3n * DAY) throw new Error('Stale oracle');
    const target = block.timestamp - 30n * DAY;
    let phase = latest[0] >> 64n;
    let high = latest[0] & MASK;
    let start: Round | undefined;
    const rounds = new Map<bigint, Round>([[latest[0], latest]]);
    const read = async (id: bigint) => {
      if (Date.now() > deadline) throw new Error('Oracle search timed out');
      if (!rounds.has(id)) rounds.set(id, valid(await client.readContract({ address: SUSDAI_FEED, abi, functionName: 'getRoundData', args: [id], blockNumber }), block.timestamp, id));
      return rounds.get(id)!;
    };
    // Bound phase transitions and requests. Unsupported round gaps remain unknown.
    for (let attempts = 0; attempts < 4 && phase > 0n; attempts++) {
      if (high < 1n || high > 10000000n) throw new Error('Unsupported round range');
      const maximum = high;
      const prefix = phase << 64n;
      const first = await read(prefix | 1n);
      if (first[3] <= target) {
        let low = 1n;
        for (let steps = 0; low < high && steps < 24; steps++) {
          const mid = (low + high + 1n) / 2n;
          const round = await read(prefix | mid);
          if (round[3] <= target) low = mid; else high = mid - 1n;
        }
        if (low !== high) throw new Error('Round search limit');
        start = await read(prefix | low);
        // Verify the selected boundary, including the following phase's first round.
        if (low < maximum) {
          if ((await read(prefix | (low + 1n)))[3] <= target) throw new Error('Invalid round order');
        }
        break;
      }
      phase--;
      if (phase === 0n) break;
      const aggregator = await client.readContract({ address: SUSDAI_FEED, abi, functionName: 'phaseAggregators', args: [Number(phase)], blockNumber });
      const previous = await client.readContract({ address: aggregator, abi, functionName: 'latestRoundData', blockNumber });
      high = previous[0] & MASK;
    }
    if (!start || target - start[3] > 3n * DAY) throw new Error('No recent month-old round');
    const elapsed = latest[3] - start[3];
    if (elapsed < 27n * DAY || elapsed > 33n * DAY) throw new Error('Unsupported observation period');
    const growth = Number(latest[1] - start[1]) / Number(start[1]);
    const apr = growth * YEAR_SECONDS / Number(elapsed);
    if (!Number.isFinite(apr)) throw new Error('Invalid annualized return');
    return {
      apr, estimated: true,
      note: `Past-month intrinsic APR estimate: (end sUSDai/USDai oracle rate ÷ start rate − 1) × 365 days ÷ elapsed days (${(Number(elapsed) / 86400).toFixed(2)}). Simple annualization, not compounded APY or USD.ai’s current advertised APY. Excludes lending interest and incentives; bridged-token market prices may differ.`,
      source: { ...source, blockNumber: String(blockNumber), startRound: String(start[0]), endRound: String(latest[0]), startTimestamp: Number(start[3]), endTimestamp: Number(latest[3]), startRate: Number(start[1]) / 1e18, endRate: Number(latest[1]) / 1e18 },
    };
  } catch { return unavailable(); }
}
export function createSusdaiRateCache(load: () => Promise<IntrinsicRate>, now = Date.now) {
  let cache: { expires: number; promise: Promise<IntrinsicRate> } | undefined;
  return () => {
    if (cache && cache.expires > now()) return cache.promise;
    const entry = { expires: now() + 300000, promise: Promise.resolve().then(load).catch(unavailable) };
    cache = entry;
    entry.promise = entry.promise.then(result => { entry.expires = now() + (result.apr === null ? 60000 : 300000); return result; });
    return entry.promise;
  };
}
export const getSusdaiIntrinsicRate = createSusdaiRateCache(async () => {
  const client = makeClient('ethereum');
  return readSusdaiIntrinsicRate(client, await client.getBlockNumber());
});
export async function applyIntrinsicRates(protocols: ProtocolResult[], network: NetworkId, load = getSusdaiIntrinsicRate): Promise<ProtocolResult[]> {
  // Deployment identity, not a spoofable token symbol; same canonical token across supported chains.
  if (!['ethereum', 'plasma', 'arbitrum'].includes(network)) return protocols;
  const matches = (a: { address: string; supplied: number }) => a.address.toLowerCase() === SUSDAI && a.supplied > 0;
  if (!protocols.some(p => p.positions.some(p => p.assets.some(matches)))) return protocols;
  const quote = await load().catch(unavailable);
  return protocols.map(p => ({ ...p, positions: p.positions.map(position => ({ ...position, assets: position.assets.map(a => matches(a) ? { ...a, intrinsicSupplyRate: quote } : a) })) }));
}
