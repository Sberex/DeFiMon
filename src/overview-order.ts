import type { Position, ProtocolResult } from './types';
const finite = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n);
const netValue = (p: Position) => finite(p.suppliedUsd) && finite(p.debtUsd) ? p.suppliedUsd - p.debtUsd : null;
const descending = (a: number | null, b: number | null) => a === null ? b === null ? 0 : 1 : b === null ? -1 : b - a;
const zeroPosition = (p: Position) => p.suppliedUsd === 0 && p.debtUsd === 0 && p.assets.every(a => a.supplied === 0 && a.borrowed === 0);
function protocolNet(p: ProtocolResult) {
  if (!['ok', 'partial'].includes(p.status) || p.balanceDiscoveryComplete === false) return null;
  if (!p.positions.length && p.status === 'partial' && p.balanceDiscoveryComplete !== true) return null;
  const values = p.positions.map(netValue);
  return values.every(finite) ? values.reduce((sum, value) => sum + value, 0) : null;
}
/** Presentation only: keep unreadable balances visible, without changing totals. */
export function orderOverviewMarkets(protocols: ProtocolResult[]) {
  const active: ProtocolResult[] = [], zeroSupply: ProtocolResult[] = [];
  for (const p of protocols) {
    if (!['ok', 'partial'].includes(p.status)) { active.push(p); continue; }
    const positions = p.positions.filter(position => !zeroPosition(position)).sort((a, b) => descending(netValue(a), netValue(b)));
    const zero = p.positions.filter(zeroPosition);
    const discoveryKnown = (p.status === 'ok' && p.balanceDiscoveryComplete !== false) || p.balanceDiscoveryComplete === true;
    if (positions.length || !discoveryKnown) active.push({ ...p, positions });
    if (zero.length || !positions.length && discoveryKnown) zeroSupply.push({ ...p, positions: zero });
  }
  active.sort((a, b) => descending(protocolNet(a), protocolNet(b)));
  return { active, zeroSupply };
}
