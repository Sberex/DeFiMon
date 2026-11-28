import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiUrl } from './api';
import type { ChainName, TokenCategory } from './types';
import type { PharosGrades, tokenSafety } from './pharos-safety';
type Resolve = (chain: ChainName, address: string) => ReturnType<typeof tokenSafety>;
interface State { feed: PharosGrades | null; source: 'api' | 'github'; busy: boolean; error: string; resolve: Resolve | null }
const initial: State = { feed: null, source: 'api', busy: false, error: '', resolve: null };
const SafetyContext = createContext<State & { refresh: (force?: boolean) => Promise<void> }>({ ...initial, refresh: async () => {} });
export function SafetyScoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initial);
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
        setState({ feed: result.feed, source: result.source, busy: false, error: '', resolve: (chain, address) => metadata.tokenSafety(chain, address, result.feed) });
      } catch {
        expires.current = Date.now() + 60000;
        setState({ ...initial, error: 'Pharos grades could not be checked. Assets are temporarily grouped as Not Rated; this does not mean Pharos has left them unrated.', resolve: (chain, address) => metadata.tokenSafety(chain, address, null) });
      }
    })().catch(() => { expires.current = Date.now() + 60000; setState({ ...initial, error: 'Pharos asset metadata could not be loaded.' }); }).finally(() => { pending.current = null; });
    return pending.current;
  }, []);
  return <SafetyContext.Provider value={{ ...state, refresh }}>{children}</SafetyContext.Provider>;
}
export function useSafetyScores(enabled = true) {
  const context = useContext(SafetyContext);
  useEffect(() => { if (enabled) void context.refresh(); }, [enabled, context.refresh]);
  return context;
}
export function AssetName({ symbol, address, chain, category }: { symbol: string; address: string; chain: ChainName; category?: TokenCategory }) {
  const { resolve, error } = useSafetyScores();
  const result = resolve?.(chain, address);
  const eligible = result || resolve && category && category !== 'Other';
  if (!eligible) return <>{symbol}</>;
  const grade = result?.grade ?? 'NR';
  const description = error ? 'Pharos grade unavailable' : grade === 'NR' ? 'Pharos: Not Rated' : `Pharos Safety Score: ${grade}${result?.score != null ? `, ${result.score}/100` : ''}`;
  return <>{symbol} <span className="asset-safety-inline" title={description}>({grade})</span></>;
}
