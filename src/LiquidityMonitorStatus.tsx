import { useEffect, useState } from 'react';
import type { SavedWallet } from './wallet-history';
import { liquidityMonitorStatus } from './liquidity-monitor-status';
export function LiquidityMonitorStatus({ wallet, kind = 'liquidity' }: { wallet: SavedWallet; kind?: 'liquidity' | 'utilization' }) {
  const enabled = wallet.alerts?.some(a => kind === 'liquidity' ? (a.rules.newLiquidityAdded || a.rules.liquidityWithdrawn) : a.rules.utilizationAbove.enabled) ?? false;
  const [state, setState] = useState<unknown>(null), [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`https://raw.githubusercontent.com/Sberex/DeFiMon/main/analysis/${kind}-alert-state.json?minute=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store', signal: abort.signal });
        if (!response.ok) throw new Error(); const result = await response.json(); if (!abort.signal.aborted) { setState(result); setNow(Date.now()); }
      } catch { if (!abort.signal.aborted) { setState(null); setNow(Date.now()); } }
    };
    void load(); const timer = setInterval(() => { void load(); }, 60000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [wallet.address, enabled, kind]);
  const status = liquidityMonitorStatus(state, wallet, now, kind);
  const time = (value: string) => <time dateTime={value}>{new Date(value).toLocaleString(undefined, { timeZone: 'Europe/Kiev', timeZoneName: 'short' })}</time>;
  return <section className="monitoring-status" aria-label={kind === 'liquidity' ? 'Liquidity monitoring status' : 'Utilization monitoring status'}><strong>{status.text}</strong>{status.lastRunAt && <p>Last tracker check: {time(status.lastRunAt)}</p>}{status.lastScheduledRunAt && <p>Last scheduled check: {time(status.lastScheduledRunAt)}</p>}{status.lastExternalRunAt && <p>Last external trigger check: {time(status.lastExternalRunAt)}</p>}</section>;
}
