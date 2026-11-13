import { expect, it } from 'vitest';
import { MorphoDiscoveryUnavailable, morphoNetworkError, safeSchemaDetail } from '../server/morpho-errors';
import { isolateProtocol } from '../server/portfolio';
it('describes a schema rejection without claiming a network block or leaking upstream text', async () => {
  const error = new MorphoDiscoveryUnavailable([{ family: 'market', code: 'schema', schemaDetail: 'Unsupported field Query.removed' }]);
  const result = await isolateProtocol('morpho', 'Morpho', 'test', async () => { throw error; });
  expect(result.message).toContain('compatibility update'); expect(result.message).not.toContain('connection');
});
it('distinguishes rate limits and connection failures from invalid replies', () => {
  expect(new MorphoDiscoveryUnavailable([{ family: 'market', code: 'http', httpStatus: 429 }]).publicMessage).toContain('limiting');
  expect(new MorphoDiscoveryUnavailable([{ family: 'market', code: 'network' }]).publicMessage).toContain('could not reach');
  expect(new MorphoDiscoveryUnavailable([{ family: 'market', code: 'response' }]).publicMessage).toContain('unexpected');
});
it('exports only known network codes and schema names, without raw error messages', () => {
  expect(morphoNetworkError({ cause: { code: 'ENOTFOUND' } }).info.networkCode).toBe('ENOTFOUND');
  expect(morphoNetworkError({ cause: { code: 'private-api-key' } }).info.networkCode).toBeUndefined();
  expect(safeSchemaDetail([{ message: 'secret https://provider/private-key' }])).toBeUndefined();
  expect(safeSchemaDetail([{ message: 'Cannot query field "foo" on type "Query".' }])).toBe('Unsupported field Query.foo');
});
