import type { IntrinsicRate, NetworkId, ProtocolResult, WalletBalances, WalletToken } from '../src/types.js';
import { intrinsicTokenRate } from './intrinsic-rates.js';
import { lidoStakingApr, LIDO_WSTETH } from './lido-rates.js';
import { networkNames } from '../src/networks.js';
import { configuredTokenCategory } from './token-registry.js';
export async function applyWalletInterest(wallet: WalletBalances, network: NetworkId, protocols: ProtocolResult[], loadSavings = intrinsicTokenRate, loadLido = lidoStakingApr): Promise<WalletBalances> {
  const eligible = (t: WalletToken) => configuredTokenCategory(network, t.address) === 'Savings stablecoin' || t.address.toLowerCase() === LIDO_WSTETH[network] || t.pendle?.kind === 'PT';
  const tokens = await Promise.all(wallet.tokens.map(async token => {
    if (!eligible(token)) return token;
    const t: WalletToken = { ...token, interestBearing: true };
    if (t.excludedReason || t.balance === 0) return t;
    if (t.pendle?.kind === 'PT') {
      const p = t.pendle;
      t.intrinsicSupplyRate = { apr: p.matured === true ? 0 : p.impliedApy, estimated: true, note: 'Pendle PT Implied APY is used directly as APR for this wallet income estimate, as for PT collateral. Monthly earnings = wallet USD value × this rate ÷ 12. This estimates PT value growth toward expiry; it is not a token interest payment. Expired PT has zero future accretion APR.', source: { chain: networkNames[network], oracle: p.oracleAddress, kind: 'pendle', label: 'Pendle PT Implied APY used as APR', url: `https://app.pendle.finance/trade/markets/${p.marketAddress}/swap?view=pt&chain=${network}`, blockNumber: p.blockNumber } };
      return t;
    }
    const existing = protocols.flatMap(p => p.positions.flatMap(p => p.assets)).find(a => a.address.toLowerCase() === t.address.toLowerCase() && a.intrinsicSupplyRate)?.intrinsicSupplyRate;
    if (existing) { t.intrinsicSupplyRate = existing; return t; }
    try { t.intrinsicSupplyRate = t.address.toLowerCase() === LIDO_WSTETH[network] ? await loadLido() : await loadSavings(network, t.address); }
    catch { /* A failed source must never manufacture zero wallet income. */ }
    if (!t.intrinsicSupplyRate) t.intrinsicSupplyRate = { apr: null, estimated: true, note: 'Wallet intrinsic APR could not be verified. Monthly earnings are unknown, not zero.', source: { chain: networkNames[network], oracle: '', kind: 'unavailable', label: 'Wallet intrinsic APR unavailable' } };
    return t;
  }));
  const missingRates = tokens.some(t => eligible(t) && !t.excludedReason && t.balance !== 0 && !Number.isFinite(t.intrinsicSupplyRate?.apr));
  return { ...wallet, tokens, status: wallet.status === 'ok' && missingRates ? 'partial' : wallet.status, message: [wallet.message, missingRates ? 'Some wallet intrinsic APRs are unavailable; those monthly earnings are unknown.' : undefined].filter(Boolean).join(' ') || undefined, interestDiscoveryComplete: wallet.status !== 'error' && wallet.interestDiscoveryComplete !== false && wallet.pendle?.balanceDiscoveryComplete !== false };
}
