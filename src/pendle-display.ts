import type { WalletBalances, WalletToken } from './types';
interface PendleGroup { wallet: WalletBalances; tokens: WalletToken[] }
const finite = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n);
/** Display grouping only; preserve expired PT redemption value in wallet totals. */
export function groupPendleHoldings(wallets: WalletBalances[]) {
  const active: PendleGroup[] = [], collapsed: PendleGroup[] = [];
  for (const wallet of wallets.filter(w => w.pendle)) {
    const tokens = wallet.tokens.filter(t => t.pendle).sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
    const hidden = tokens.filter(t => t.pendle!.matured === true || t.valueUsd === 0 || t.balance === 0);
    const visible = tokens.filter(t => !hidden.includes(t));
    const coverage = wallet.pendle!;
    const verifiedEmpty = !tokens.length && coverage.status !== 'error' && ((coverage.status === 'ok' && coverage.balanceDiscoveryComplete !== false) || coverage.balanceDiscoveryComplete === true);
    const incomplete = coverage.status === 'error' || coverage.balanceDiscoveryComplete === false || (!tokens.length && !verifiedEmpty);
    if (visible.length || incomplete) active.push({ wallet, tokens: visible });
    if (hidden.length || verifiedEmpty) collapsed.push({ wallet, tokens: hidden });
  }
  const holdings = active.flatMap(group => group.tokens.map(token => ({ wallet: group.wallet, token }))).sort((a, b) => {
    const av = a.token.valueUsd, bv = b.token.valueUsd;
    return !finite(av) ? !finite(bv) ? 0 : 1 : !finite(bv) ? -1 : bv - av;
  });
  // Merge only consecutive holdings from the same network, preserving the
  // global value order even when network labels need to recur between assets.
  const ordered: PendleGroup[] = [];
  for (const { wallet, token } of holdings) {
    const last = ordered.at(-1);
    if (last?.wallet === wallet) last.tokens.push(token);
    else ordered.push({ wallet, tokens: [token] });
  }
  ordered.push(...active.filter(group => !group.tokens.length));
  return { active: ordered, collapsed };
}
