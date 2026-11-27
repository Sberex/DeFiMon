import { expect, it } from 'vitest';
import { loadPharosGrades, PHAROS_SNAPSHOT_URL } from '../src/load-pharos-grades';
import { parsePharosGrades } from '../src/pharos-safety';
import { publishPharosGrades } from '../server/pharos-safety';
const payload = () => ({ schemaVersion: 1, asOfSec: Math.floor(Date.now() / 1000), publicationStatus: 'current', methodologyVersion: '10.57', grades: [{ id: 'susdai-usd-ai', grade: 'D', score: 47, ratingStatus: 'rated' }] });
it('uses the public GitHub snapshot when the deployed backend has no grade endpoint', async () => {
  const calls: string[] = [];
  const result = await loadPharosGrades('https://backend.example/api/safety-grades', undefined, async input => {
    calls.push(String(input)); return calls.length === 1 ? new Response('{"error":"Endpoint not found"}', { status: 404 }) : new Response(JSON.stringify(payload()));
  });
  expect(calls).toEqual(['https://backend.example/api/safety-grades', PHAROS_SNAPSHOT_URL]); expect(result.source).toBe('github'); expect(result.feed.grades[0].grade).toBe('D');
});
it('uses only the backend when its feed is valid and never accepts an expired fallback', async () => {
  let calls = 0;
  const valid = await loadPharosGrades('/api/safety-grades', undefined, async () => { calls++; return new Response(JSON.stringify(payload())); });
  expect(valid.source).toBe('api'); expect(calls).toBe(1);
  await expect(loadPharosGrades(null, undefined, async () => new Response(JSON.stringify({ ...payload(), asOfSec: Math.floor(Date.now() / 1000) - 73 * 3600 })))).rejects.toThrow('both sources');
});
it('does not publish unchanged grades, regress to an older publication or overwrite a conflicting GitHub update', async () => {
  const next = parsePharosGrades(payload());
  const file = (data: unknown) => new Response(JSON.stringify({ encoding: 'base64', sha: 'a'.repeat(40), content: Buffer.from(JSON.stringify(data)).toString('base64') }));
  let writes = 0;
  const unchanged = await publishPharosGrades(next, { token: 'test', repository: 'Sberex/DeFiMon', fetcher: async (_url, options) => { if(options?.method === 'PUT') writes++; return file(next); } });
  expect(unchanged.committed).toBe(false); expect(writes).toBe(0);
  let reads = 0;
  const newer = { ...next, asOfSec: next.asOfSec + 1 };
  const result = await publishPharosGrades(next, { token: 'test', repository: 'Sberex/DeFiMon', fetcher: async (_url, options) => {
    if(options?.method === 'PUT') { writes++; const body=JSON.parse(String(options.body));expect(body.sha).toBe('a'.repeat(40));return new Response('',{status:409}); }
    reads++;return file(reads === 1 ? {...next,asOfSec:next.asOfSec-1} : newer);
  } });
  expect(reads).toBe(2);expect(writes).toBe(1);expect(result).toMatchObject({committed:false,asOfSec:newer.asOfSec});
});
