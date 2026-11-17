import type { WalletBalances, WalletToken } from './types';
export const interestBearingToken = (t: WalletToken) => t.interestBearing === true || t.category === 'Savings stablecoin' || t.pendle?.kind === 'PT';
const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
export function walletTokenInterest(token: WalletToken): { earnedTokens: number | null; earnedUsd: number | null } {
  if (!interestBearingToken(token) || token.excludedReason || token.balance === 0) return { earnedTokens: 0, earnedUsd: 0 };
  if (!finite(token.balance) || token.balance < 0) return { earnedTokens: null, earnedUsd: null };
  const apr = token.intrinsicSupplyRate?.apr;
  const earnedTokens = finite(token.balance) && token.balance >= 0 && finite(apr) ? token.balance * apr / 12 : null;
  const earnedUsd = finite(token.valueUsd) && token.valueUsd >= 0 && finite(apr) ? token.valueUsd * apr / 12 : null;
  return { earnedTokens: finite(earnedTokens) ? earnedTokens : null, earnedUsd: finite(earnedUsd) ? earnedUsd : null };
}
export function walletCategoryInterest(wallets: WalletBalances[]) {
  const tokens = wallets.flatMap(w => w.tokens).filter(t => interestBearingToken(t) && !t.excludedReason);
  const complete = wallets.every(w => w.status !== 'error' && w.interestDiscoveryComplete !== false && w.pendle?.balanceDiscoveryComplete !== false);
  const amounts = tokens.map(t => walletTokenInterest(t).earnedUsd);
  const earnedUsd = complete && amounts.every(finite) ? amounts.reduce((sum, value) => sum + value, 0) : null;
  const values = tokens.map(t => t.balance === 0 ? 0 : t.valueUsd);
  const valueUsd = complete && values.every((v): v is number => finite(v) && v >= 0) ? values.reduce((sum, value) => sum + value, 0) : null;
  const knownValueUsd = values.filter((v): v is number => finite(v) && v >= 0).reduce((s, v) => s + v, 0);
  const apr = finite(earnedUsd) && finite(valueUsd) && valueUsd > 0 ? earnedUsd * 12 / valueUsd : null;
  return { earnedUsd: finite(earnedUsd) ? earnedUsd : null, valueUsd: finite(valueUsd) ? valueUsd : null, knownValueUsd, apr: finite(apr) ? apr : null };
}
export function walletInterestIssues(wallets: WalletBalances[]) {
  return wallets.flatMap(wallet => {
    const context = { protocol: 'Wallet tokens', chain: wallet.chain, position: 'Interest bearing tokens' };
    const issues: (typeof context & { asset?: string; reason: string })[] = [];
    if (wallet.status === 'error' || wallet.interestDiscoveryComplete === false || wallet.pendle?.balanceDiscoveryComplete === false) issues.push({ ...context, reason: 'Interest-bearing token discovery or receipt checks could not be completed. Additional wallet income is unknown.' });
    for (const token of wallet.tokens.filter(t => interestBearingToken(t) && !t.excludedReason && t.balance !== 0)) {
      const reasons: string[] = [];
      if (!finite(token.balance) || token.balance < 0) reasons.push('balance unavailable');
      if (!finite(token.intrinsicSupplyRate?.apr)) reasons.push('intrinsic APR unavailable');
      if (!finite(token.valueUsd) || token.valueUsd < 0) reasons.push('USD value unavailable');
      if (reasons.length) issues.push({ ...context, asset: token.symbol, reason: reasons.join('; ') });
    }
    return issues;
  });
}
