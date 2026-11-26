import {
  createCurveReader,
  curveVaultAbi,
  CURVE_ZERO,
  curveMarketUrl,
} from './curve-llamalend.js';
import {
  CURVE_FACTORIES,
  CURVE_NAME,
  CURVE_DISABLED_CONTROLLERS,
  CURVE_V1_CREATED_CUTOFF,
} from './deployments/curve-llamalend.js';
import { limited, option, type Reader } from './market-readers.js';
let policyCache:
  { expires: number; promise: Promise<Map<string, number>> } | undefined;
/** API provides deprecation/creation metadata only. Balances, addresses, rates, oracle and liquidity are on-chain. */
export async function curveCreationPolicy(
  fetcher: typeof fetch = fetch,
): Promise<Map<string, number>> {
  const r = await fetcher(
    'https://prices.curve.finance/v1/lending/markets?per_page=500',
    { signal: AbortSignal.timeout(12000) },
  );
  if (!r.ok) throw Error('Curve metadata unavailable');
  const j = await r.json();
  if (!j?.chains || typeof j.chains !== 'object')
    throw Error('Invalid Curve metadata');
  const result = new Map<string, number>();
  for (const network of ['ethereum', 'arbitrum']) {
    const rows = j.chains[network]?.data;
    if (!Array.isArray(rows)) throw Error('Incomplete Curve metadata');
    for (const row of rows) {
      if (
        typeof row.controller !== 'string' ||
        !/^0x[\da-f]{40}$/i.test(row.controller) ||
        typeof row.created_at !== 'string'
      )
        continue;
      const date = Date.parse(
        row.created_at.endsWith('Z') ? row.created_at : row.created_at + 'Z',
      );
      if (Number.isFinite(date))
        result.set(`${network}:${row.controller.toLowerCase()}`, date);
    }
  }
  return result;
}
function policy() {
  if (!policyCache || policyCache.expires < Date.now())
    policyCache = {
      expires: Date.now() + 300000,
      promise: curveCreationPolicy(),
    };
  return policyCache.promise;
}
export function createCurveMarketReader(
  loadPolicy: () => Promise<Map<string, number>> = policy,
): Reader {
  return async (client, network, block, targets, warn) => {
    if (!CURVE_FACTORIES[network].length) return [];
    const reader = createCurveReader(client, network, block),
      catalog = await reader.catalog();
    if (!catalog.complete)
      warn(
        'Some Curve factories were unavailable; additional markets may exist.',
      );
    const created = await loadPolicy().catch(() => {
      warn(
        'Curve creation/deprecation metadata is unavailable; legacy v1 recommendations are omitted.',
      );
      return new Map<string, number>();
    });
    const markets = catalog.markets
      .filter(
        (m) =>
          !CURVE_DISABLED_CONTROLLERS.has(`${network}:${m.controller}`) &&
          (m.version === 2 ||
            (created.get(`${network}:${m.controller}`) ?? Infinity) <=
              CURVE_V1_CREATED_CUTOFF),
      )
      .filter((m) =>
        targets.some((t) =>
          t.borrowed
            ? t.supplies.includes(m.collateral) &&
              t.borrows.includes(m.borrowed)
            : t.supplies.includes(m.borrowed),
        ),
      );
    return (
      await limited(
        markets,
        async (m) => {
          const q = await reader.quote(m),
            canDeposit = await client
              .readContract({
                address: m.vault,
                abi: curveVaultAbi,
                functionName: 'maxDeposit',
                args: [CURVE_ZERO],
                blockNumber: block,
              })
              .then((v) => v > 0n)
              .catch(() => false);
          return targets.flatMap((t) => {
            const borrow = !!t.borrowed;
            if (
              borrow
                ? !t.supplies.includes(m.collateral) ||
                  !t.borrows.includes(m.borrowed) ||
                  q.cap <= q.debt
                : !t.supplies.includes(m.borrowed) || !canDeposit
            )
              return [];
            return [
              {
                ...option(
                  t,
                  CURVE_NAME,
                  network,
                  block,
                  borrow ? m.controller : m.vault,
                  `${q.label}${borrow ? '' : ' lending vault'}`,
                  borrow ? 0 : q.supplyRate.apr!,
                  borrow ? q.borrowRate.apr! : null,
                  null,
                  'Curve current native APR without compounding or external rewards. Curve uses LLAMMA bands and soft liquidation; no single fixed LLTV is assumed. Collateral intrinsic yield is added separately.',
                ),
                url: curveMarketUrl(network, m.controller, !borrow),
                liquidity: borrow ? q.liquidity : undefined,
              },
            ];
          });
        },
        warn,
      )
    ).flat();
  };
}
export const readCurveMarkets = createCurveMarketReader();
