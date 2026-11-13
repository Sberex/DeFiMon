import { MORPHO_API } from '../server/morpho-discovery.js';
import { MorphoLookupError, morphoNetworkError } from '../server/morpho-errors.js';

type TypeRef = { name: string | null; kind: string; ofType?: TypeRef | null };
type Field = { name: string; description?: string | null; type: TypeRef; args?: { name: string; type: TypeRef }[] };
const reference = 'kind name ofType { kind name ofType { kind name } }';
const fields = `name description type { ${reference} } args { name type { ${reference} } }`;

/** Public schema metadata only; no wallet, provider, or raw upstream errors. */
export async function inspectMorphoPriceSchema(fetcher: typeof fetch = fetch) {
  async function inspect(name: string): Promise<Field[]> {
    let response: Response;
    try {
      response = await fetcher(MORPHO_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `query PriceSchema($name: String!) { __type(name: $name) { fields { ${fields} } } }`, variables: { name } }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) { throw morphoNetworkError(error); }
    if (!response.ok) throw new MorphoLookupError('http', { httpStatus: response.status });
    let data;
    try { data = await response.json(); } catch { throw new MorphoLookupError('response'); }
    if (data.errors || !Array.isArray(data.data?.__type?.fields)) throw new MorphoLookupError('response');
    return data.data.__type.fields;
  }
  function typeName(type: TypeRef): string {
    const name = type?.name ?? type?.ofType?.name ?? type?.ofType?.ofType?.name;
    if (typeof name !== 'string' || !/^[_A-Za-z][_0-9A-Za-z]{0,127}$/.test(name)) throw new MorphoLookupError('response');
    return name;
  }
  function fieldInfo(field: Field) {
    if (!/^[_A-Za-z][_0-9A-Za-z]{0,127}$/.test(field.name)) throw new MorphoLookupError('response');
    return { name: field.name, type: typeName(field.type), ...(typeof field.description === 'string' ? { description: field.description.slice(0, 1000) } : {}), args: (field.args ?? []).map(arg => {
      if (!/^[_A-Za-z][_0-9A-Za-z]{0,127}$/.test(arg.name)) throw new MorphoLookupError('response');
      return { name: arg.name, type: typeName(arg.type) };
    }) };
  }
  const assetFields = await inspect('Asset');
  const price = assetFields.find(field => field.name === 'price');
  if (!price) return { priceField: null, availablePriceFields: assetFields.filter(field => /price/i.test(field.name)).map(fieldInfo) };
  const kind = price.type.kind === 'NON_NULL' ? price.type.ofType?.kind : price.type.kind;
  const priceFields = kind === 'OBJECT' ? (await inspect(typeName(price.type))).map(fieldInfo) : [];
  return { priceField: fieldInfo(price), priceFields };
}
