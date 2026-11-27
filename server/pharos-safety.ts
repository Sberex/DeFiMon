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
