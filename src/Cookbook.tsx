import { networkExplorers as explorers } from './networks';
import { useEffect, useState, type ReactNode } from 'react';
import { apiUrl } from './api';
import { COOKBOOK_MIN_APR, cookbookPositions, parseCookbook, type CookbookResponse } from './cookbook';
const source = 'https://github.com/Sberex/DeFiMon/blob/main/analysis/cookbook.json';
const rawSource = 'https://raw.githubusercontent.com/Sberex/DeFiMon/main/analysis/cookbook.json';

function ExternalLinkIcon() { return <svg className="arrow-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>; }
type Entry = ReturnType<typeof cookbookPositions>[number];
export function Cookbook({ revision, renderPosition }: { revision: object | null; renderPosition: (entry: Entry, snapshot: object) => ReactNode }) {
  const [result, setResult] = useState<CookbookResponse | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const request = new AbortController(); setLoading(true); setError('');
    void (async () => {
      try {
        let next: CookbookResponse;
        try {
          const response = await fetch(apiUrl('/api/cookbook'), { cache: 'no-store', signal: request.signal });
          if (!response.ok) throw new Error();
          const body: CookbookResponse = await response.json();
          if (!body.persistence || !['github', 'local'].includes(body.persistence.mode) || typeof body.persistence.synced !== 'boolean') throw new Error();
          next = { data: parseCookbook(body.data), persistence: body.persistence };
        } catch {
          if (request.signal.aborted) return;
          const response = await fetch(rawSource, { cache: 'no-store', signal: request.signal });
          if (!response.ok) throw new Error();
          next = { data: parseCookbook(await response.json()), persistence: { mode: 'github', synced: true, message: 'The live Cookbook service is unavailable. Showing snapshots saved in the GitHub JSON file.' } };
        }
        if (!request.signal.aborted) setResult(next);
      } catch { if (!request.signal.aborted) setError('Cookbook snapshots could not be loaded. Reload snapshots to try again.'); }
      finally { if (!request.signal.aborted) setLoading(false); }
    })();
    return () => request.abort();
  }, [revision, retry]);
  const entries = result ? cookbookPositions(result.data) : [];
  const addresses = new Set(entries.map(entry => entry.address.toLowerCase())).size;
  const totalNetValue = entries.reduce((total, entry) => total + entry.netValueUsd, 0);
  const highestApr = entries.reduce<number | null>((highest, entry) => highest === null ? entry.apr : Math.max(highest, entry.apr), null);
  const threshold = result?.data.minimumApr ?? COOKBOOK_MIN_APR;
  const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
  return <section className="cookbook" aria-label="Cookbook">
    <div className="section-label"><h2>Cookbook</h2><span>Position APR &gt; 14%</span></div>
    <section className="summary-grid cookbook-summary" aria-label="Cookbook summary">
      <div className="summary"><span>Number of positions</span><strong>{result ? entries.length.toLocaleString('en-US') : '—'}</strong><small>Saved position snapshots</small></div>
      <div className="summary"><span>Number of addresses</span><strong>{result ? addresses.toLocaleString('en-US') : '—'}</strong><small>Unique wallets with saved positions</small></div>
      <div className="summary cookbook-total-value"><span>Total Net Value</span><strong>{result ? money(totalNetValue) : '—'}</strong><small>Sum of saved position net values</small></div>
      <div className="summary"><span>Highest APR</span><strong>{highestApr === null ? '—' : `${(highestApr * 100).toFixed(2)}%`}</strong><small>Among saved snapshots</small></div>
      <div className="summary"><span>Threshold minimum APR</span><strong>{(threshold * 100).toFixed(0)}%</strong><small>Position APR must exceed this rate</small></div>
    </section>
    <p className="recommendations-intro">Snapshots of lending positions from analysed wallets. APR is monthly NPL × 12 ÷ net value, including the verified intrinsic yield and matched rewards shown in the snapshot. Rates, balances and risk can change after the snapshot.</p>
    <div className="cookbook-toolbar"><a href={source} target="_blank" rel="noreferrer">View source JSON <ExternalLinkIcon /></a><button type="button" className="secondary" disabled={loading} onClick={() => setRetry(n => n + 1)}>{loading ? 'Loading snapshots…' : 'Reload snapshots'}</button></div>
    {result?.persistence.message && <p className="notice cookbook-persistence" role="status">{result.persistence.message}</p>}
    {error && <p className="notice" role="alert">{error}</p>}
    {!loading && !error && !entries.length && <p className="recommendations-empty">No saved positions currently meet the Cookbook threshold. Analyse a wallet to capture positions above 14% APR.</p>}
    <div className="protocol-list">{entries.map(entry => <article className={`protocol cookbook-entry ${entry.protocolId}`} key={`${entry.address}:${entry.chain}:${entry.protocolId}:${entry.position.id}`}>
      <div className="cookbook-source"><div><strong>{entry.protocolName} · {entry.chain}</strong><p>Source wallet: <a className="cookbook-wallet" href={`${explorers[entry.chain]}/address/${entry.address}`} target="_blank" rel="noreferrer"><code>{entry.address}</code> <ExternalLinkIcon /></a></p><p>Snapshot: <time dateTime={entry.snapshotAt} title={entry.snapshotAt}>{new Date(entry.snapshotAt).toLocaleString(undefined, { timeZone: 'Europe/Kiev', timeZoneName: 'short' })}</time>{entry.blockNumber && ` · Block ${entry.blockNumber}`}</p></div><strong className="cookbook-apr">{(entry.apr * 100).toFixed(2)}% APR</strong></div>
      {entry.verification === 'unavailable' && <p className="notice">The latest check could not verify this position’s balances or APR. Showing its last verified snapshot above; it has not been confirmed as closed.</p>}
      {renderPosition(entry, result!.data)}
    </article>)}</div>
  </section>;
}
