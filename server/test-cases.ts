import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress, isAddress } from 'viem';
import type { Portfolio } from '../src/types.js';
import { networkNames, portfolioNetwork } from '../src/networks.js';
export interface TestCasesStore { record(portfolio: Portfolio): Promise<void> }
/** Count positions, not asset rows. Zero-deposit curator listings and wallet tokens do not count. */
export function activeLendingPositionCount(portfolio: Portfolio): number {
  const positions = new Set<string>();
  for (const protocol of portfolio.protocols) {
    if (!['ok', 'partial'].includes(protocol.status)) continue;
    const chain = protocol.chain ?? networkNames[portfolioNetwork(portfolio.chain)];
    for (const position of protocol.positions) {
      if (!position.assets.some(a => Number.isFinite(a.supplied) && a.supplied > 0 || Number.isFinite(a.borrowed) && a.borrowed > 0)) continue;
      // Spark's Base Morpho markets may also be returned by Morpho discovery.
      const family = ['spark', 'morpho'].includes(protocol.id) && position.id.startsWith('morpho-') ? 'morpho' : protocol.id;
      positions.add(JSON.stringify([chain, family, position.id.toLowerCase()]));
    }
  }
  return positions.size;
}
export function parseTestCases(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(a => typeof a !== 'string' || !isAddress(a, { strict: false }) || /^0x0{40}$/i.test(a))) throw new Error('Invalid test-case JSON; existing entries were not replaced.');
  const seen = new Set<string>();
  return value.filter(a => { const key = a.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}
export function createTestCasesStore(options: { path?: string; token?: () => string | undefined; repository?: string; branch?: string; fetcher?: typeof fetch } = {}): TestCasesStore {
  const path = options.path ?? fileURLToPath(new URL('../analysis/test-cases.json', import.meta.url));
  const token = options.token ?? (() => process.env.COOKBOOK_GITHUB_TOKEN), fetcher = options.fetcher ?? fetch;
  const repository = options.repository ?? 'Sberex/DeFiMon', branch = options.branch ?? 'main';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid test-case repository');
  const endpoint = `https://api.github.com/repos/${repository}/contents/analysis/test-cases.json`;
  const headers = () => ({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) });
  let current: string[] | undefined, queue = Promise.resolve();
  async function save(data: string[]) {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`); await rename(temp, path); current = data;
  }
  async function remote() {
    const response = await fetcher(`${endpoint}?ref=${encodeURIComponent(branch)}`, { headers: headers(), signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (response.status === 404) return { addresses: [], sha: undefined };
    if (!response.ok) throw new Error();
    const body = await response.json();
    if (typeof body.sha !== 'string') throw new Error();
    let content = body;
    if (body.encoding === 'none') {
      const blob = await fetcher(`https://api.github.com/repos/${repository}/git/blobs/${encodeURIComponent(body.sha)}`, { headers: headers(), signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (!blob.ok) throw new Error(); content = await blob.json();
    }
    if (content.encoding !== 'base64' || typeof content.content !== 'string') throw new Error();
    return { addresses: parseTestCases(JSON.parse(Buffer.from(content.content, 'base64').toString('utf8'))), sha: body.sha };
  }
  return { record(portfolio) {
    if (activeLendingPositionCount(portfolio) < 3) return Promise.resolve();
    const run = queue.then(async () => {
      const address = getAddress(portfolio.address.toLowerCase());
      if (/^0x0{40}$/i.test(address)) throw new Error('Invalid test-case wallet');
      if (!current) {
        try { current = parseTestCases(JSON.parse(await readFile(path, 'utf8'))); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') current = []; else throw new Error('Test-case JSON could not be read. Existing entries were not replaced.'); }
      }
      await save(parseTestCases([...current, address]));
      if (!token()) return;
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const base = await remote();
          const merged = parseTestCases([...base.addresses, ...current!]);
          if (JSON.stringify(merged) === JSON.stringify(base.addresses)) { await save(merged); return; }
          const response = await fetcher(endpoint, { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000), body: JSON.stringify({ branch, message: 'Add multi-position wallet to test cases [skip ci] [skip render]', sha: base.sha, content: Buffer.from(`${JSON.stringify(merged, null, 2)}\n`).toString('base64') }) });
          if ([409, 422].includes(response.status)) continue;
          if (!response.ok) throw new Error();
          await save(merged); return;
        }
      } catch { /* Never expose raw GitHub errors or credentials to clients. */ }
      throw new Error('Test-case GitHub sync failed. The address is retained locally for a later retry.');
    });
    queue = run.catch(() => {}); return run;
  } };
}
