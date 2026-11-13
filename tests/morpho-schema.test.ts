import { expect, it } from 'vitest';
import { inspectMorphoPriceSchema } from '../scripts/morpho-schema';
import { toMorphoFailure } from '../server/morpho-errors';

it('follows the actual named price type and reports its fields without assuming a USD format', async () => {
  const seen: string[] = [];
  const fetcher = (async (_url, init) => {
    const { query, variables } = JSON.parse(String(init?.body));
    expect(query).toContain('__type(name: $name)'); seen.push(variables.name);
    return new Response(JSON.stringify({ data: { __type: { fields: variables.name === 'Asset' ? [
      { name: 'price', type: { name: null, kind: 'NON_NULL', ofType: { name: 'CurrentAssetPrice', kind: 'OBJECT' } }, args: [{ name: 'maxLag', type: { name: 'Int', kind: 'SCALAR' } }] },
    ] : [{ name: 'value', type: { name: 'Float', kind: 'SCALAR' }, args: [] }] } } }));
  }) as typeof fetch;
  expect(await inspectMorphoPriceSchema(fetcher)).toEqual({ priceField: { name: 'price', type: 'CurrentAssetPrice', args: [{ name: 'maxLag', type: 'Int' }] }, priceFields: [{ name: 'value', type: 'Float', args: [] }] });
  expect(seen).toEqual(['Asset', 'CurrentAssetPrice']);
});

it('does not expose raw upstream errors or credentials when introspection fails', async () => {
  const fetcher = (async () => new Response(JSON.stringify({ errors: [{ message: 'secret-provider-key' }] }))) as typeof fetch;
  let failure;
  try { await inspectMorphoPriceSchema(fetcher); } catch (error) { failure = toMorphoFailure('price schema', error); }
  expect(failure).toEqual({ family: 'price schema', code: 'response' });
});
