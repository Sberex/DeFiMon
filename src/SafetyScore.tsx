import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiUrl } from './api';
import { networkNames } from './networks';
import type { PendleBaseAsset } from './pendle-safety';
import type { ChainName, TokenCategory } from './types';
import type { PharosGrades, tokenSafety } from './pharos-safety';
type Resolve = (chain: ChainName, address: string) => ReturnType<typeof tokenSafety>;
interface State { pendleBases: Map<string, PendleBaseAsset>; feed: PharosGrades | null; source: 'api' | 'github'; busy: boolean; error: string; resolve: Resolve | null }
const initial: State = { pendleBases: new Map(), feed: null, source: 'api', busy: false, error: '', resolve: null };
const SafetyContext = createContext<State & { refresh: (force?: boolean) => Promise<void>; ensurePendle: (chain: ChainName) => Promise<void> }>({ ...initial, refresh: async () => {}, ensurePendle: async () => {} });
export function SafetyScoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initial);
  const bases = useRef<Map<string, PendleBaseAsset>>(new Map());
  const pendleLoads = useRef(new Map<string, { until: number; value: Promise<void> }>());
  const pending = useRef<Promise<void> | null>(null), expires = useRef(0);
  const refresh = useCallback((force = false) => {
    if (pending.current) return pending.current;
    if (!force && expires.current > Date.now()) return Promise.resolve();
    setState(old => ({ ...old, busy: true, error: '' }));
    pending.current = (async () => {
      const metadata = await import('./pharos-safety');
      try {
        const { loadPharosGrades } = await import('./load-pharos-grades');
        let endpoint: string | null = null;
        try { endpoint = apiUrl('/api/safety-grades'); } catch { /* Static preview can use GitHub. */ }
        const result = await loadPharosGrades(endpoint);
        expires.current = Math.min(Date.now() + 600000, result.feed.asOfSec * 1000 + 72 * 3600000);
        setState({ pendleBases: bases.current, feed: result.feed, source: result.source, busy: false, error: '', resolve: (chain, address) => metadata.tokenSafety(chain, address, result.feed, bases.current) });
      } catch {
        expires.current = Date.now() + 60000;
        setState({ ...initial, pendleBases: bases.current, error: 'Pharos grades could not be checked. Assets are temporarily grouped as Not Rated; this does not mean Pharos has left them unrated.', resolve: (chain, address) => metadata.tokenSafety(chain, address, null, bases.current) });
      }
    })().catch(() => { expires.current = Date.now() + 60000; setState({ ...initial, error: 'Pharos asset metadata could not be loaded.' }); }).finally(() => { pending.current = null; });
    return pending.current;
  }, []);
  const ensurePendle = useCallback((chain: ChainName) => {
    const network = (Object.entries(networkNames) as [keyof typeof networkNames, ChainName][]).find(([, name]) => name === chain)?.[0];
    if (!network || network === 'arc') return Promise.resolve();
    const cached = pendleLoads.current.get(chain);
    if (cached && cached.until > Date.now()) return cached.value;
    const entry = { until: Date.now() + 300000, value: Promise.resolve() };
    entry.value = (async () => {
      const { loadPendleSafetyAssets } = await import('./pendle-safety');
      let endpoint: string | null = null;
      try { endpoint = apiUrl(`/api/pendle-safety-assets/${network}`); } catch { /* Public catalog fallback. */ }
      const result = await loadPendleSafetyAssets(network, endpoint);
      const next = new Map([...bases.current].filter(([key]) => !key.startsWith(`${chain}:`)));
      for (const [token, base] of result) next.set(`${chain}:${token}`, base);
      bases.current = next;
      setState(old => ({ ...old, pendleBases: next }));
    })().catch(() => {
      entry.until = Date.now() + 60000;
      bases.current = new Map([...bases.current].filter(([key]) => !key.startsWith(`${chain}:`)));
      setState(old => ({ ...old, pendleBases: bases.current }));
    });
    pendleLoads.current.set(chain, entry); return entry.value;
  }, []);
  return <SafetyContext.Provider value={{ ...state, refresh, ensurePendle }}>{children}</SafetyContext.Provider>;
}
export function useSafetyScores(enabled = true) {
  const context = useContext(SafetyContext);
  useEffect(() => { if (enabled) void context.refresh(); }, [enabled, context.refresh]);
  return context;
}
export function AssetName({ symbol, address, chain, category }: { symbol: string; address: string; chain: ChainName; category?: TokenCategory }) {
  const { resolve, error, ensurePendle } = useSafetyScores();
  const pendle = /^(?:PT|YT)(?:[-\s]|$)/i.test(symbol);
  useEffect(() => { if (pendle) void ensurePendle(chain); }, [pendle, chain, ensurePendle]);
  const result = resolve?.(chain, address);
  const eligible = result || resolve && pendle || resolve && category && category !== 'Other';
  if (!eligible) return <>{symbol}</>;
  const grade = result?.grade ?? 'NR';
  const description = error ? 'Pharos grade unavailable' : pendle && !result ? 'Pendle underlying asset could not be verified; Pharos grade unavailable' : grade === 'NR' ? 'Pharos: Not Rated' : `Pharos Safety Score: ${grade}${result?.score != null ? `, ${result.score}/100` : ''}`;
  const inheritance = result?.inheritedFrom ? ` · inherited from ${result.inheritedFrom}` : '';
  return <>{symbol} <span className="asset-safety-inline" title={description + inheritance}>({grade})</span></>;
}
