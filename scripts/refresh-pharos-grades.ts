import { writeFile } from 'node:fs/promises';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { PHAROS_SNAPSHOT_PATH, publishPharosGrades, readPharosGrades } from '../server/pharos-safety.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());
if (process.argv.slice(2).some(arg => arg !== '--publish')) throw Error('Usage: tsx scripts/refresh-pharos-grades.ts [--publish]');
try {
  const feed = await readPharosGrades();
  const result = process.argv.includes('--publish')
    ? await publishPharosGrades(feed, { token: process.env.GITHUB_TOKEN ?? '', repository: process.env.GITHUB_REPOSITORY ?? 'Sberex/DeFiMon' })
    : await writeFile(PHAROS_SNAPSHOT_PATH, JSON.stringify(feed, null, 2) + '\n').then(() => ({ saved: true, asOfSec: feed.asOfSec, count: feed.grades.length }));
  console.log(JSON.stringify(result));
} catch {
  console.error('Pharos grade refresh failed. The previous snapshot is retained; expired data is never used as a current rating.');
  process.exitCode = 1;
}
