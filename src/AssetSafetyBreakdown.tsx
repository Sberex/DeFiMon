import { AssetName, useSafetyScores } from './SafetyScore';
import { useMemo } from 'react';
import type { Portfolio } from './types';
import { assetSafetySummary } from './pharos-safety';
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const quantity = (n: number) => new Intl.NumberFormat('en-US', { maximumSignificantDigits: 7 }).format(n);
export function AssetSafetyBreakdown({ portfolio, loading }: { portfolio: Portfolio | null; loading: boolean }) {
  const { feed, source, busy, error, refresh, pendleBases } = useSafetyScores(!!portfolio && !loading);
  const summary = useMemo(() => portfolio ? assetSafetySummary(portfolio, feed, pendleBases) : null, [portfolio, feed, pendleBases]);
  return <section className="asset-safety" aria-label="Assets by Safety Score">
    <div className="section-label"><h3>Assets by Safety Score</h3>{portfolio && <button className="text-button" disabled={busy || loading} onClick={() => void refresh(true)}>Refresh grades</button>}</div>
    <p>Wallet tokens and supplied assets, including positions shown in Bad Debt. Borrowings are liabilities and are not added or deducted here. Grades apply to the configured asset, not its lending protocol or position. Receipt tokens already excluded from wallet balances are counted through their supplied assets once.</p>
    {loading ? <p role="status">Checking wallet assets…</p> : !summary ? <p>Check a wallet address to classify its assets.</p> : <>
      <div className="asset-safety-summary"><div><span>Known asset value</span><strong>{money(summary.knownValueUsd)}</strong></div><div><span>Rated assets</span><strong>{money(summary.ratedValueUsd)}</strong></div><div><span>Not Rated</span><strong>{money(summary.notRatedValueUsd)}</strong></div></div>
      {busy && <p role="status">Loading Pharos safety grades…</p>}
      {error && <p className="notice" role="status">{error}</p>}
      {feed && <p className="safety-asof"><a href="https://pharos.watch/" target="_blank" rel="noreferrer">Pharos Safety Score</a> · as of {new Date(feed.asOfSec * 1000).toLocaleString('en-GB', { timeZone: 'Europe/Kyiv' })} Kyiv · methodology {feed.methodologyVersion}{source === 'github' && ' · GitHub feed snapshot'}</p>}
      {(summary.incomplete || summary.unpriced > 0) && <p className="notice">Partial asset coverage.{summary.unpriced > 0 && ` ${summary.unpriced} holding${summary.unpriced === 1 ? ' has' : 's have'} no individual USD valuation.`} Unpriced holdings remain visible; their unknown values are excluded from grade totals. Known position value that cannot be allocated to individual assets is shown separately under Not Rated.</p>}
      {!summary.groups.length ? <p>No checked wallet tokens or supplied assets found.</p> : <div className="table-wrap"><table className="safety-grade-table"><thead><tr><th>Safety grade</th><th>Known USD value</th><th>Share of known assets</th><th>Assets</th></tr></thead><tbody>{summary.groups.map(group => <tr key={group.grade} data-grade={group.grade}><td><strong className={`safety-grade ${group.grade === 'Not Rated' ? 'unrated' : ''}`}>{group.grade}</strong></td><td>{money(group.valueUsd)}{group.unpriced > 0 && <small>+ {group.unpriced} unpriced holding{group.unpriced === 1 ? '' : 's'}</small>}</td><td>{summary.knownValueUsd > 0 ? `${(group.valueUsd / summary.knownValueUsd * 100).toFixed(2)}%` : '—'}</td><td><details><summary>{group.assets.length} asset{group.assets.length === 1 ? '' : 's'}</summary><ul className="safety-assets">{group.assets.map(asset => <li key={asset.key}><div>{asset.url ? <a href={asset.url} target="_blank" rel="noreferrer"><AssetName symbol={asset.symbol} address={asset.address} chain={asset.chain} /> ↗</a> : <strong><AssetName symbol={asset.symbol} address={asset.address} chain={asset.chain} /></strong>} <span>{money(asset.valueUsd)}{asset.unpriced ? ' + unpriced' : ''}</span>{asset.score !== null && <small>Pharos score: {asset.score}/100</small>}</div><ul>{asset.holdings.map((holding, i) => <li key={i}>{holding.chain} · {holding.location}<br />{holding.amount === null ? 'Amount unavailable' : `${quantity(holding.amount)} ${asset.symbol}`} · {holding.valueUsd === null ? 'USD value unavailable' : money(holding.valueUsd)}</li>)}</ul></li>)}</ul></details></td></tr>)}</tbody></table></div>}
    </>}
  </section>;
}
