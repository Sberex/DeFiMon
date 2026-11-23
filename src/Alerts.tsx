import { LiquidityMonitorStatus } from './LiquidityMonitorStatus';
import { useEffect, useState, type ReactNode } from 'react';
import { apiUrl } from './api';
import { alertPositions, alertScopeKey, defaultAlertRules, parsePositionAlertInput, type AlertRules, type PositionAlerts } from './alert-rules';
import { parseWalletHistory, type SavedWallet, type WalletHistoryResponse } from './wallet-history';
import type { Portfolio } from './types';
type Entry = ReturnType<typeof alertPositions>[number];
function AlertForm({ entry, address, saved, snapshot, disabled, onSaved }: { entry: Entry; address: string; saved?: PositionAlerts; snapshot: object; disabled: boolean; onSaved: (response: WalletHistoryResponse) => void }) {
  const [rules, setRules] = useState<AlertRules>(() => saved?.rules ?? defaultAlertRules());
  const [utilization, setUtilization] = useState(() => saved?.rules.utilizationAbove.thresholdPercent?.toString() ?? '');
  const [positionApr, setPositionApr] = useState(() => saved?.rules.positionAprBelow.thresholdPercent?.toString() ?? '');
  const [saving, setSaving] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    setRules(saved?.rules ?? defaultAlertRules()); setUtilization(saved?.rules.utilizationAbove.thresholdPercent?.toString() ?? ''); setPositionApr(saved?.rules.positionAprBelow.thresholdPercent?.toString() ?? ''); setMessage(''); setError('');
  }, [snapshot]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (disabled || saving) return;
    let input;
    try {
      const percentage = (value: string) => value.trim() === '' ? null : Number(value);
      input = parsePositionAlertInput({ network: entry.network, protocol: entry.protocol.id, positionId: entry.position.id, rules: { ...rules, utilizationAbove: { ...rules.utilizationAbove, thresholdPercent: percentage(utilization) }, positionAprBelow: { ...rules.positionAprBelow, thresholdPercent: percentage(positionApr) } } });
    } catch { setError('Enter a utilization threshold from 0 to 100 and a valid position APR threshold for each enabled rule.'); return; }
    setSaving(true); setError(''); setMessage('Saving alert preferences…');
    try {
      const response = await fetch(apiUrl(`/api/wallet-history/${address}/alerts`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      if (!response.ok) throw new Error();
      const result: WalletHistoryResponse = await response.json();
      if (!result.wallet || result.wallet.address.toLowerCase() !== address.toLowerCase() || !result.persistence || typeof result.persistence.synced !== 'boolean') throw new Error();
      result.wallet = parseWalletHistory({ version: 1, wallets: [result.wallet] }).wallets[0];
      onSaved(result);
      setMessage(result.persistence.synced ? 'Alerts saved to GitHub.' : result.persistence.message ?? 'Saved on this server; GitHub sync is pending.');
    } catch { setMessage(''); setError('Alert preferences could not be saved. Your selections are still here; press Save alerts to retry.'); }
    finally { setSaving(false); }
  }
  return <form className="alert-form" aria-label={`Alert rules for ${entry.position.label}`} onSubmit={save}>
    <fieldset disabled={disabled || saving}><legend>Alert conditions</legend>
      <label className="alert-option"><input type="checkbox" checked={rules.borrowAprAboveSupplyApr} onChange={e => setRules({ ...rules, borrowAprAboveSupplyApr: e.target.checked })} />Borrow APR higher than supply APR</label>
      <div className="alert-option"><label><input type="checkbox" checked={rules.utilizationAbove.enabled} onChange={e => setRules({ ...rules, utilizationAbove: { ...rules.utilizationAbove, enabled: e.target.checked } })} />Utilization ratio higher than</label><input aria-label="Utilization threshold (%)" type="number" min="0" max="100" step="any" value={utilization} required={rules.utilizationAbove.enabled} onChange={e => setUtilization(e.target.value)} /><span>%</span></div>
      <label className="alert-option"><input type="checkbox" checked={rules.healthFactorBelow.enabled} onChange={e => setRules({ ...rules, healthFactorBelow: { enabled: e.target.checked, threshold: 1.01 } })} />Health factor is lower than 1.01</label>
      <div className="alert-option"><label><input type="checkbox" checked={rules.positionAprBelow.enabled} onChange={e => setRules({ ...rules, positionAprBelow: { ...rules.positionAprBelow, enabled: e.target.checked } })} />Position total APR is lower than</label><input aria-label="Position APR threshold (%)" type="number" step="any" value={positionApr} required={rules.positionAprBelow.enabled} onChange={e => setPositionApr(e.target.value)} /><span>%</span></div>
      <label className="alert-option"><input type="checkbox" checked={rules.newLiquidityAdded ?? false} onChange={e => setRules({ ...rules, newLiquidityAdded: e.target.checked })} />New liquidity added to the market</label>
      <button className="secondary" type="submit">{saving ? 'Saving alerts…' : 'Save alerts'}</button>
    </fieldset>
    {saved && <p className="alert-saved-at">Last saved: <time dateTime={saved.updatedAt}>{new Date(saved.updatedAt).toLocaleString(undefined, { timeZone: 'Europe/Kiev', timeZoneName: 'short' })}</time></p>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </form>;
}
export function Alerts({ portfolio, savedWallet, persistence, snapshot, demo, loading, onSaved, renderPosition }: { portfolio: Portfolio | null; savedWallet?: SavedWallet | null; persistence?: WalletHistoryResponse['persistence']; snapshot: object | null; demo: boolean; loading: boolean; onSaved: (response: WalletHistoryResponse) => void; renderPosition: (entry: Entry) => ReactNode }) {
  const entries = portfolio ? alertPositions(portfolio) : [];
  return <section aria-label="Alerts"><div className="section-label"><h2>Alerts</h2><span>Position preferences</span></div><p className="recommendations-intro">Save alert conditions for active lending and deposit positions. Supply APR includes intrinsic yield. Preferences are public in wallet-history.json. Liquidity and utilization alerts run on a five-minute GitHub Actions schedule; runs may be delayed or skipped. Monitoring of other rules and message delivery are not enabled yet.</p>
    <p className="recommendations-intro"><a href="https://github.com/Sberex/DeFiMon/blob/main/analysis/liquidity-alert-notifications.json" target="_blank" rel="noreferrer">Liquidity notifications JSON ↗</a> · <a href="https://github.com/Sberex/DeFiMon/blob/main/analysis/utilization-alert-notifications.json" target="_blank" rel="noreferrer">Utilization notifications JSON ↗</a> · <a href="https://github.com/Sberex/DeFiMon/actions/workflows/market-liquidity-monitor.yml" target="_blank" rel="noreferrer">Monitoring runs ↗</a></p>
    {loading ? <p role="status">Checking wallet positions…</p> : !portfolio ? <p className="recommendations-empty">Check a wallet address to configure position alerts.</p> : <>
      {!demo && savedWallet && <><LiquidityMonitorStatus wallet={savedWallet} /><LiquidityMonitorStatus wallet={savedWallet} kind="utilization" /></>}
      {demo && <p className="notice">Example positions are shown for illustration. Check a wallet address to save alerts.</p>}
      {persistence && !persistence.synced && persistence.message && <p className="notice">{persistence.message}</p>}
      {!entries.length && <p className="recommendations-empty">No active lending or deposit positions were found in Wallet Overview.</p>}
      <div className="protocol-list">{entries.map(entry => {
        const scope = { network: entry.network, protocol: entry.protocol.id, positionId: entry.position.id };
        const key = alertScopeKey(scope), saved = savedWallet?.alerts?.find(a => alertScopeKey(a) === key);
        return <article className={`protocol alert-position ${entry.protocol.id}`} key={`${portfolio.address}:${key}`}><div className="protocol-heading"><h3>{entry.protocol.name} · {entry.chain}</h3></div>{renderPosition(entry)}<AlertForm entry={entry} address={portfolio.address} saved={saved} snapshot={snapshot ?? portfolio} disabled={demo} onSaved={onSaved} /></article>;
      })}</div>
    </>}
  </section>;
}
