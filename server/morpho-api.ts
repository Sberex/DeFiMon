import { MorphoLookupError, morphoNetworkError, safeSchemaDetail } from './morpho-errors.js';
import type { NetworkId } from '../src/types.js';
import { networks } from './networks.js';
export const MORPHO_API = 'https://api.morpho.org/graphql';
type Obj = Record<string, unknown>;
function object(value: unknown): Obj { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Morpho response'); return value as Obj; }
const currentPriceFields = 'price { usd timestamp }';
export function createMorphoQuery(fetcher: typeof fetch, network: NetworkId, warnings: Set<string>) {
  const chainId = networks[network].id;
  async function query(document: string, variables: Record<string, unknown>): Promise<Obj> {
    document = document.replaceAll('chainId_in: [1]', `chainId_in: [${chainId}]`).replaceAll('chainId: 1)', `chainId: ${chainId})`);
    let response: Response;
    try { response = await fetcher(MORPHO_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: document, variables }), signal: AbortSignal.timeout(15000), cache: 'no-store' }); } catch (error) { throw morphoNetworkError(error); }
    if (!response.ok && ![400, 422].includes(response.status)) throw new MorphoLookupError('http', { httpStatus: response.status });
    const text = await response.text().catch(error => { throw morphoNetworkError(error); });
    if (text.length > 4_000_000) throw new MorphoLookupError('response');
    let envelope: Obj;
    try { envelope = object(JSON.parse(text)); } catch { throw new MorphoLookupError(response.ok ? 'response' : 'http', response.ok ? {} : { httpStatus: response.status }); }
    if (envelope.errors !== undefined && (!Array.isArray(envelope.errors) || envelope.errors.length > 0)) {
      // Current SDK queries use marketId; older API schema snapshots expose uniqueKey.
      const oldSchema = Array.isArray(envelope.errors) && envelope.errors.some(e => e && typeof e === 'object' && typeof e.message === 'string' && /Cannot query field ["']marketId["']/.test(e.message));
      if (oldSchema && document.includes('uniqueKey: marketId')) return query(document.replace('uniqueKey: marketId', 'uniqueKey'), variables);
      // Optional display prices must not prevent discovery of balances or oracle-based risk.
      // Older SDK schema snapshots expose scalar priceUsd/oraclePriceUsd instead.
      const detail = safeSchemaDetail(envelope.errors);
      if (detail === 'Unsupported field Asset.price' && document.includes(currentPriceFields)) {
        return query(document.replaceAll(currentPriceFields, 'priceUsd'), variables);
      }
      if (detail === 'Unsupported field Asset.priceUsd' && /\bdecimals priceUsd\b/.test(document)) {
        return query(document.replaceAll('decimals priceUsd', 'decimals priceUsd: oraclePriceUsd'), variables);
      }
      if (detail === 'Unsupported field Asset.oraclePriceUsd' && document.includes('priceUsd: oraclePriceUsd')) {
        warnings.add('Morpho’s lookup service does not expose a supported USD price field. Token balances and oracle-based risk are still checked; dollar values are unavailable.');
        return query(document.replaceAll('priceUsd: oraclePriceUsd', ''), variables);
      }
      const validation = detail || (Array.isArray(envelope.errors) && envelope.errors.some(e => e?.extensions?.code === 'GRAPHQL_VALIDATION_FAILED' || (typeof e?.message === 'string' && /^(Syntax Error|Unknown type|Variable |Value .* does not exist in)/.test(e.message))));
      throw new MorphoLookupError(validation ? 'schema' : response.ok ? 'response' : 'http', { httpStatus: response.status, schemaDetail: detail });
    }
    if (!response.ok) throw new MorphoLookupError('http', { httpStatus: response.status });
    return object(envelope.data);
  }
  return query;
}
