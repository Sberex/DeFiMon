import { useEffect, useMemo, useState } from 'react';
import { apiUrl } from './api';
import { useSafetyScores } from './SafetyScore';
import { savingsCatalogAssets, savingsRateLink, type SavingsCatalogRate } from './savings-catalog';
export function SavingsStablecoins() {
  const { feed, error: scoreError, busy: scoreLoading } = useSafetyScores();
  const [rates, setRates] = useState<Record<string, SavingsCatalogRate>>({}), [failures, setFailures] = useState<Record<string, string>>({}), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0), [filter, setFilter] = useState('');
  useEffect(() => {
    const request = new AbortController(); let index = 0;
    const assets = savingsCatalogAssets.filter(a => a.sources.length > 0);
    setRates({}); setFailures({}); setLoading(true);
    const run = async () => {
      while (index < assets.length && !request.signal.aborted) {
        const asset = assets[index++];
        try {
          const response = await fetch(apiUrl(`/api/savings-stablecoins/${encodeURIComponent(asset.id)}`), { cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]) });
          if (!response.ok) throw Error(response.status === 429 ? 'Rate calculations are busy. Refresh APRs to retry.' : 'The current and historical rate could not be verified.');
          const result = await response.json() as SavingsCatalogRate;
          if (result.group !== asset.id || !Number.isFinite(Date.parse(result.checkedAt)) || !result.quote || result.quote.apr !== null && (typeof result.quote.apr !== 'number' || !Number.isFinite(result.quote.apr)) || !result.quote.source || typeof result.quote.note !== 'string') throw Error('Rate response could not be verified.');
          if (!request.signal.aborted) setRates(old => ({ ...old, [asset.id]: result }));
        } catch (error) { if (!request.signal.aborted) setFailures(old => ({ ...old, [asset.id]: error instanceof Error ? error.message : 'Rate unavailable.' })); }
      }
    };
    void Promise.all(Array.from({ length: 3 }, run)).finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [revision]);
  const grades = useMemo(() => new Map(feed?.grades.map(row => [row.id, row])), [feed]);
  const assets = savingsCatalogAssets.filter(a => a.id.toLowerCase().includes(filter.trim().toLowerCase()));
  const calculated = Object.values(rates).filter(r => r.quote?.apr != null).length;
  return <section className="savings-stablecoins" aria-label="Savings stablecoins">
    <div className="section-label"><h2>Savings stablecoins</h2><span>{savingsCatalogAssets.length} configured assets</span></div>
    <p>All assets marked Savings stablecoin in the config, one row per configured identity across networks. APR uses the same verified intrinsic-rate sources as wallet and lending positions. Oracle rates use a 30-day simple annualization; other sources retain their stated calculation period.</p>
    <div className="savings-catalog-toolbar"><label>Filter assets<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Asset name…" /></label><button type="button" disabled={loading} onClick={() => setRevision(n => n + 1)}>{loading ? 'Calculating APRs…' : 'Refresh APRs'}</button></div>
    <p role="status">{calculated} APRs available · {Object.keys(rates).length + Object.keys(failures).length} of {savingsCatalogAssets.filter(a => a.sources.length > 0).length} configured sources checked{loading ? ' · Calculations in progress' : ''}. Assets without a verified source remain Unavailable.</p>
    {scoreError && <p className="notice">{scoreError}</p>}
    {feed && <p className="savings-score-asof">Pharos grades as of {new Date(feed.asOfSec * 1000).toLocaleString('en-GB', { timeZone: 'Europe/Kyiv' })} Kyiv.</p>}
    <div className="table-wrap"><table><thead><tr><th>Name</th><th>Safety Score</th><th>Intrinsic APR</th><th>Price oracle / source</th></tr></thead><tbody>{assets.map(asset => {
      const row = asset.pharosId ? grades.get(asset.pharosId) : undefined, grade = row?.ratingStatus === 'rated' ? row.grade : 'NR';
      const rate = rates[asset.id], quote = rate?.quote, link = savingsRateLink(asset, quote), pending = loading && asset.sources.length > 0 && !rate && !failures[asset.id];
      const unavailable = failures[asset.id] ?? quote?.note ?? 'No verified intrinsic-rate source configured.';
      return <tr key={asset.id} data-asset-id={asset.id}><td><strong>{asset.name}</strong>{asset.id !== asset.name && <small>{asset.id}</small>}</td><td>{asset.safetyUrl ? <a href={asset.safetyUrl} target="_blank" rel="noreferrer" title={row?.score != null ? `${row.score}/100` : 'Pharos asset page'}>{scoreLoading && !feed ? 'Checking…' : grade} ↗</a> : <span className="muted">NR</span>}{row?.score != null && <small>{row.score}/100</small>}</td><td><strong>{pending ? 'Calculating…' : quote?.apr != null ? `≈ ${(quote.apr * 100).toFixed(2)}%` : 'Unavailable'}</strong>{quote && <details><summary>Rate details</summary><p>{quote.note}</p>{quote.source.startTimestamp != null && quote.source.endTimestamp != null && <p>Observations: {new Date(quote.source.startTimestamp * 1000).toISOString()} → {new Date(quote.source.endTimestamp * 1000).toISOString()}</p>}</details>}{!pending && quote?.apr == null && <small>{unavailable}</small>}</td><td>{link ? <a href={link.url} target="_blank" rel="noreferrer">{link.label} ↗</a> : <span className="muted">No configured source</span>}{rate && <small>Checked {new Date(rate.checkedAt).toLocaleString('en-GB', { timeZone: 'Europe/Kyiv' })} Kyiv</small>}</td></tr>;
    })}</tbody></table></div>{!assets.length && <p>No matching savings assets.</p>}
  </section>;
}
