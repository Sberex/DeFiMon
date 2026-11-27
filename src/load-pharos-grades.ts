import { parsePharosGrades, type PharosGrades } from './pharos-safety';
export const PHAROS_SNAPSHOT_URL = 'https://raw.githubusercontent.com/Sberex/DeFiMon/main/analysis/pharos-safety-grades.json';
/** GitHub serves this validated public feed with browser CORS support, unlike Pharos's API. */
export async function loadPharosGrades(endpoint: string | null, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<{ feed: PharosGrades; source: 'api' | 'github' }> {
  for (const [source, url] of [['api', endpoint], ['github', PHAROS_SNAPSHOT_URL]] as const) {
    if (!url) continue;
    if (signal?.aborted) throw Error('Grade lookup cancelled');
    try {
      const response = await fetcher(url, { cache: 'no-store', credentials: 'omit', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
      if (!response.ok) throw Error();
      return { feed: parsePharosGrades(await response.json()), source };
    } catch { if (signal?.aborted) throw Error('Grade lookup cancelled'); }
  }
  throw Error('Current Pharos grades are unavailable from both sources.');
}
