import { parsePharosGrades, type PharosGrades } from '../src/pharos-safety.js';
export const PHAROS_GRADES_URL = 'https://api.pharos.watch/api/safety-grades';
export function createPharosGradesReader(fetcher: typeof fetch = fetch, now = Date.now) {
  let cache: { until: number; value: Promise<PharosGrades> } | undefined;
  return () => {
    if (cache && cache.until > now()) return cache.value;
    const entry = { until: now() + 600000, value: Promise.resolve(null as unknown as PharosGrades) };
    entry.value = (async () => {
      const response = await fetcher(PHAROS_GRADES_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000), cache: 'no-store' });
      if (!response.ok) throw Error('Pharos grades unavailable');
      const value = parsePharosGrades(await response.json(), now());
      entry.until = Math.min(now() + 600000, value.asOfSec * 1000 + 72 * 3600000);
      return value;
    })().catch(() => { entry.until = now() + 60000; throw Error('Pharos safety grades are temporarily unavailable. Assets are shown as Not Rated until grades can be checked.'); });
    cache = entry;
    return entry.value;
  };
}
export const readPharosGrades = createPharosGradesReader();

export const PHAROS_SNAPSHOT_PATH = 'analysis/pharos-safety-grades.json';
/** Publish only the public grade feed; optimistic content SHAs preserve concurrent updates. */
export async function publishPharosGrades(feed: PharosGrades, options: { token: string; repository: string; branch?: string; fetcher?: typeof fetch }) {
  const next = parsePharosGrades(feed), { token, repository } = options, branch = options.branch ?? 'main', fetcher = options.fetcher ?? fetch;
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w./-]+$/.test(branch)) throw Error('Grade publishing requires a repository and contents-write token.');
  const url = `https://api.github.com/repos/${repository}/contents/${PHAROS_SNAPSHOT_PATH}`;
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = await fetcher(`${url}?ref=${encodeURIComponent(branch)}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    let sha: string | undefined;
    if (previous.ok) {
      const file = await previous.json();
      if (file.encoding !== 'base64' || typeof file.content !== 'string' || !/^[\da-f]{40}$/.test(file.sha)) throw Error('Grade snapshot content unavailable.');
      sha = file.sha;
      let old: PharosGrades | undefined;
      try { old = parsePharosGrades(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))); } catch { /* A stale snapshot can be replaced by a verified new feed. */ }
      if (old && (old.asOfSec > next.asOfSec || JSON.stringify(old) === JSON.stringify(next))) return { committed: false, asOfSec: old.asOfSec, count: old.grades.length };
    } else if (previous.status !== 404) throw Error('Grade snapshot could not be read.');
    const response = await fetcher(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ branch, ...(sha ? { sha } : {}), message: 'Refresh public Pharos safety grades', content: Buffer.from(JSON.stringify(next, null, 2) + '\n').toString('base64') }) });
    if (response.ok) return { committed: true, asOfSec: next.asOfSec, count: next.grades.length };
    if (![409, 422].includes(response.status)) throw Error('Grade snapshot could not be published.');
  }
  throw Error('Grade snapshot changed repeatedly; retry without overwriting another update.');
}
