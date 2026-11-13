import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { InterestRate, ChainName, NetworkId, Portfolio, Position, ProtocolResult, Risk, WalletBalances } from './types';
import { combinedExample } from './example';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './style.css';
const money = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
const quantity = (value: number) => new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 }).format(value);
const riskNames: Record<Risk, string> = { 'no-debt': 'No borrowing', lower: 'Lower risk', watch: 'Watch closely', high: 'High risk', liquidatable: 'Liquidation threshold reached', unknown: 'Risk unavailable' };
const names = [['aave-v3', 'Aave v3'], ['aave-v4', 'Aave v4'], ['morpho', 'Morpho'], ['compound', 'Compound'], ['fluid', 'Fluid']];
function Arrow() { return <svg className="arrow-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function RateView({ quote, active }: { quote?: InterestRate; active: boolean }) {
  if (!active) return <span className="muted">—</span>;
  if (quote?.apr == null) return <span className="muted" title={quote?.note ?? 'Current interest rate unavailable.'}>Unavailable</span>;
  return <div className="asset-rate" title={quote.note}>{quote.estimated ? '≈ ' : ''}{(quote.apr * 100).toFixed(2)}%<details className="rate-details"><summary>{quote.estimated ? 'Estimate details' : 'Rate details'}</summary><p>{quote.note}</p></details></div>;
}
function PositionView({ position: p }: { position: Position }) {
  return <div className="position">
    <div className="position-title"><h3>{p.label}</h3><span className={`risk ${p.risk}`}>{riskNames[p.risk]}</span></div>
    <div className="position-stats"><div><span>Supplied</span><strong>{money(p.suppliedUsd)}</strong></div><div><span>Borrowed</span><strong>{money(p.debtUsd)}</strong></div><div><span>Net value</span><strong>{money(p.suppliedUsd === null || p.debtUsd === null ? null : p.suppliedUsd - p.debtUsd)}</strong></div><div><span title="Collateral adjusted for liquidation rules, divided by debt. Around 1 means liquidation can begin.">Health factor ⓘ</span><strong>{p.healthFactor === null ? '—' : p.healthFactor.toFixed(2)}</strong></div></div>
    {p.healthFactor !== null && p.risk !== 'no-debt' && <div className="health-track" aria-hidden="true"><span style={{ left: `${Math.min(96, Math.max(2, ((p.healthFactor ?? 1) - .8) / 2.2 * 100))}%` }} /></div>}
    <p className="table-scroll-hint">Swipe the table to see rates and liquidation prices <Arrow /></p><div className="table-wrap"><table><caption className="sr-only">Assets and liquidation estimates for {p.label}</caption><thead><tr><th>Asset</th><th>Supplied</th><th title="Current annual supply interest rate, without assumed compounding">Supply APR</th><th>Borrowed</th><th title="Current annual borrowing interest rate, without assumed compounding">Borrow APR</th><th>Current price</th><th>Est. liquidation price</th></tr></thead><tbody>{p.assets.map(a => <tr key={a.address || a.symbol}><td><strong>{a.symbol}</strong>{a.collateral && <small>Collateral</small>}</td><td>{quantity(a.supplied)}</td><td><RateView quote={a.supplyRate} active={a.supplied > 0} /></td><td>{quantity(a.borrowed)}</td><td><RateView quote={a.borrowRate} active={a.borrowed > 0} /></td><td>{money(a.priceUsd)}{a.priceSource === 'fluid-oracle' && <small>Fluid oracle estimate</small>}</td><td>{a.liquidationPriceUsd === null ? <span className="muted">—</span> : <><strong>{money(a.liquidationPriceUsd)}</strong><small>{a.priceUsd === null ? 'Current USD price unavailable' : a.liquidationPriceUsd < a.priceUsd ? `${((1 - a.liquidationPriceUsd / a.priceUsd) * 100).toFixed(1)}% below current price` : 'At or above current price'}</small></>}</td></tr>)}</tbody></table></div>
    {p.liquidationQuote && <div className="liquidation-quote"><strong>Liquidation boundary · oracle ratio</strong><span>Current: {quantity(p.liquidationQuote.current)} {p.liquidationQuote.unit}</span><span>Threshold: {quantity(p.liquidationQuote.threshold)} {p.liquidationQuote.unit}</span><small>Liquidation can begin when this ratio falls to the threshold. Other balances are held fixed.</small></div>}
    <details><summary>How these estimates work</summary>{p.notes.map(n => <p key={n}>{n}</p>)}<p>A dash means no applicable estimate is available. Risk labels are a guide; lower risk does not mean risk-free. Protocol rounding and changing prices can affect liquidation.</p></details>
  </div>;
}
function ProtocolCard({ result, chain }: { result: ProtocolResult; chain: ChainName }) {
  return <article className={`protocol ${result.id}`} data-chain={chain}><div className="protocol-heading"><div className="protocol-name"><span className="protocol-logo" aria-hidden="true">{result.name === 'Compound' ? 'C' : result.name === 'Morpho' ? '⋈' : result.name === 'Fluid' ? '≈' : 'A'}</span><div><h2>{result.name}<span className="chain-badge"> · {chain}</span></h2><p>{result.coverage}</p></div></div><span className={`status ${result.status}`}>{result.status === 'ok' ? 'Checked' : result.status === 'partial' ? 'Partially checked' : result.status === 'error' ? 'Unavailable' : 'Not connected'}</span></div>
    {result.status === 'partial' && <div className="notice protocol-warning" role="status">{result.message}</div>}
    {result.status !== 'ok' && result.status !== 'partial' ? <div className="protocol-empty"><span aria-hidden="true">{result.status === 'error' ? '!' : '+'}</span><p>{result.message || 'This integration is still being built. Positions and risk have not been checked.'}</p></div> : result.positions.length ? result.positions.map(p => <PositionView key={p.id} position={p} />) : result.status === 'partial' ? null : <div className="protocol-empty"><span aria-hidden="true">✓</span><p>No positions found in the markets listed above.</p></div>}
  </article>;
}
function WalletView({ wallet }: { wallet: WalletBalances }) {
  return <article className="wallet-network" data-chain={wallet.chain}><div className="protocol-heading"><div className="protocol-name"><div><h2>Wallet tokens<span className="chain-badge"> · {wallet.chain}</span></h2><p>Known wallet value: <strong>{money(wallet.pricedValueUsd)}</strong></p></div></div><span className={`status ${wallet.status}`}>{wallet.status === 'ok' ? 'Checked' : wallet.status === 'partial' ? 'Partially checked' : 'Unavailable'}</span></div>
    {wallet.message && <div className="notice protocol-warning" role="status">{wallet.message}</div>}
    {wallet.tokens.length > 0 && <div className="position"><div className="table-wrap"><table><caption className="sr-only">Wallet token balances on {wallet.chain}</caption><thead><tr><th>Token</th><th>Balance</th><th>Price</th><th>USD value</th></tr></thead><tbody>{wallet.tokens.map(token => <tr key={token.address}><td><strong>{token.symbol}</strong><small title={token.address}>{token.address === 'native' ? 'Native currency' : `${token.address.slice(0, 8)}…${token.address.slice(-6)}`}</small></td><td>{token.balance === null ? '—' : quantity(token.balance)}</td><td>{money(token.priceUsd)}</td><td>{money(token.valueUsd)}{token.excludedReason && <small>{token.excludedReason}</small>}</td></tr>)}</tbody></table></div></div>}
    <p className="wallet-coverage">{wallet.coverage}</p>
  </article>;
}
function App() {
  const [input, setInput] = useState('');
  const [customTokens, setCustomTokens] = useState<{ network: NetworkId; address: string }[]>([]);
  const [tokenNetwork, setTokenNetwork] = useState<NetworkId>('ethereum');
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [data, setData] = useState<Portfolio | null>(null);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    if (!/^0x[0-9a-fA-F]{40}$/.test(input.trim()) || /^0x0{40}$/i.test(input.trim())) { setError('Enter a valid wallet address: 0x followed by 40 letters and numbers.'); return; }
    await searchAddress(input.trim());
  }

  function addToken(event: React.FormEvent) {
    event.preventDefault();
    const address = tokenInput.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address) || /^0x0{40}$/.test(address)) { setTokenError('Enter the token contract address, starting with 0x.'); return; }
    if (customTokens.some(t => t.network === tokenNetwork && t.address === address)) { setTokenError('That token is already added for this network.'); return; }
    if (customTokens.length >= 20) { setTokenError('You can add up to 20 token contracts.'); return; }
    const next = [...customTokens, { network: tokenNetwork, address }];
    setCustomTokens(next); setTokenInput(''); setTokenError('');
    if (data && !demo) void searchAddress(data.address, next);
  }
  function showExample() { controller.current?.abort(); setLoading(false); setData(combinedExample); setDemo(true); setError(''); }
  const positions = data?.protocols.filter(p => p.status === 'ok' || p.status === 'partial').flatMap(p => p.positions) || [];
  const pricedPositions = positions.filter(p => p.suppliedUsd !== null && p.debtUsd !== null);
  const missingValuations = positions.length - pricedPositions.length;
  const walletValue = data?.wallets?.reduce((sum, wallet) => sum + (wallet.pricedValueUsd ?? 0), 0) ?? 0;
  const hasKnownWallet = data?.wallets?.some(wallet => wallet.pricedValueUsd !== null) ?? false;
  const missingWalletValues = data?.wallets?.reduce((sum, wallet) => sum + wallet.unpricedCount, 0) ?? 0;
  const supplied = pricedPositions.reduce((s, p) => s + p.suppliedUsd!, 0);
  const borrowed = pricedPositions.reduce((s, p) => s + p.debtUsd!, 0);
  const checked = data?.protocols.filter(p => p.status === 'ok').length || 0;
  const incompleteData = positions.some(p => p.risk === 'unknown') || data?.protocols.some(p => p.status === 'partial' || p.status === 'error') || data?.wallets?.some(wallet => wallet.status !== 'ok');
  const hasKnownTotals = checked > 0 || pricedPositions.length > 0;
  const worst = positions.filter(p => p.risk !== 'no-debt' && p.healthFactor !== null).sort((a, b) => a.healthFactor! - b.healthFactor!)[0];
  return <><header><a className="brand" href="/" aria-label="DeFiMon home"><span className="brand-mark">d<span>m</span></span>DeFiMon<span className="beta">EARLY BUILD</span></a><div className="network"><span />Ethereum + Plasma</div></header>
    <main><section className="intro"><div className="eyebrow"><span /> YOUR POSITIONS. A CLEARER PICTURE.</div><h1>Know where<br />your wallet stands<span>.</span></h1><p>See your wallet tokens, lending balances, and liquidation risk.<br className="desktop-only" /> One address. A clearer view of your DeFi.</p><div className="privacy"><span aria-hidden="true">◇</span> Read-only · No wallet connection · No history stored</div></section>
    <section className="search-panel" aria-label="Wallet lookup"><form onSubmit={search}><label htmlFor="address">Wallet address</label><div className="search-row"><span className="search-icon" aria-hidden="true">⌕</span><input id="address" name="address" value={input} onChange={e => setInput(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} aria-describedby={error ? 'search-error' : 'address-help'} /><button disabled={loading} type="submit">{loading ? 'Reading both networks…' : 'Check wallet'}<span aria-hidden="true"> <Arrow /></span></button></div></form><div className="search-help"><span id="address-help">Checks Ethereum and Plasma together. ENS names are not supported yet.</span><button className="text-button" onClick={showExample}>Explore an example <Arrow /></button></div>{error && <p id="search-error" role="alert" className="error">{error}</p>}<details className="custom-tokens"><summary>Add another token</summary><p>Common tokens are checked automatically. Add a token contract to check others on either network.</p><form className="token-form" onSubmit={addToken}><label>Token network<select value={tokenNetwork} onChange={e => setTokenNetwork(e.target.value as NetworkId)}><option value="ethereum">Ethereum</option><option value="plasma">Plasma</option></select></label><label>Token contract address<input value={tokenInput} onChange={e => setTokenInput(e.target.value)} placeholder="0x…" spellCheck={false} /></label><button type="submit">Add token</button></form>{tokenError && <p className="error" role="alert">{tokenError}</p>}{customTokens.map(token => <div className="added-token" key={`${token.network}:${token.address}`}><span>{token.network === 'ethereum' ? 'Ethereum' : 'Plasma'} · {token.address.slice(0, 8)}…{token.address.slice(-6)}</span><button type="button" onClick={() => { const next = customTokens.filter(t => t !== token); setCustomTokens(next); if (data && !demo) void searchAddress(data.address, next); }}>Remove</button></div>)}</details></section>
    {loading && <div className="loading" role="status"><span className="spinner" />Reading current positions and protocol prices…</div>}
    {data ? <section className="results" aria-label="Wallet results"><div className="results-heading"><div><div className="eyebrow">{demo ? 'ILLUSTRATIVE EXAMPLE' : 'WALLET OVERVIEW'}</div><h2>{demo ? 'A look inside the dashboard' : `${data.address.slice(0, 8)}…${data.address.slice(-6)}`}</h2></div>{!demo && <div className="refresh"><div className="network-snapshots">{data.networks ? data.networks.map(snapshot => <span key={snapshot.chain}>{snapshot.chain} · {snapshot.status === 'error' ? 'Connection unavailable' : `Block ${snapshot.blockNumber} · Checked ${new Date(snapshot.updatedAt).toLocaleTimeString()}`}</span>) : <span>{data.chain} · Checked {new Date(data.updatedAt).toLocaleTimeString()} · Block {data.blockNumber}</span>}</div><button className="secondary" onClick={() => { setInput(data.address); void searchAddress(data.address); }}>Refresh</button></div>}</div>
      <div className="notice" role="status">{demo ? 'Example only — all balances, prices, and risks below are fictional. Search your wallet for real data.' : `Coverage: ${checked} of ${data.protocols.length} protocol readers completed on ${data.chain}; partially checked results are labeled below. Totals cover only the priced wallet tokens and markets successfully checked below; they are not your complete wallet balance.${missingValuations ? ` Dollar totals exclude ${missingValuations} positions with unknown values.` : ''}${missingWalletValues ? ` Wallet totals exclude ${missingWalletValues} unpriced or unreadable token amounts.` : ''}`}</div>
      <div className="summary-grid"><div className="summary primary"><span>Net value · checked assets</span><strong>{hasKnownWallet || (hasKnownTotals && (pricedPositions.length > 0 || !missingValuations)) ? money(supplied - borrowed + walletValue) : '—'}</strong><small>Wallet tokens + supplied assets − debt</small></div><div className="summary"><span>Total supplied</span><strong>{hasKnownTotals && (pricedPositions.length > 0 || !missingValuations) ? money(supplied) : '—'}</strong><small>Includes collateral and deposits</small></div><div className="summary"><span>Total borrowed</span><strong>{hasKnownTotals && (pricedPositions.length > 0 || !missingValuations) ? money(borrowed) : '—'}</strong><small>Debt in checked markets</small></div><div className="summary"><span>Lowest health factor</span><strong>{worst ? worst.healthFactor!.toFixed(2) : '—'}{worst && <span className={`risk ${worst.risk}`}>{riskNames[worst.risk]}</span>}</strong><small>{incompleteData ? 'Some data is unavailable' : '1.00 is the liquidation boundary'}</small></div></div>
      <div className="section-label"><h2>Protocol breakdown</h2><span>Current annual rates (APR) · Risk is separate for each position</span></div><div className="protocol-list">{data.protocols.map(p => <ProtocolCard key={`${p.id}:${p.chain ?? data.chain}`} result={p} chain={p.chain ?? (data.chain === 'Plasma' ? 'Plasma' : 'Ethereum')} />)}</div>
      {!!data.wallets?.length && <section className="wallet-section" aria-label="Wallet tokens"><div className="section-label"><h2>Wallet tokens</h2><span>Ethereum first · Plasma second</span></div><div className="wallet-list">{data.wallets.map(wallet => <WalletView key={wallet.chain} wallet={wallet} />)}</div></section>}
    </section> : !loading && <section className="empty-state"><div className="section-label"><h2>Your DeFi, in one place</h2><span>Current state only</span></div><div className="protocol-tiles">{names.map(([id, name]) => <div key={id}><span className={`tile-logo ${id}`}>{name.startsWith('Aave') ? 'A' : name === 'Morpho' ? '⋈' : name === 'Fluid' ? '≈' : 'C'}</span><strong>{name}</strong><small>{['aave-v3', 'aave-v4', 'morpho', 'compound', 'fluid'].includes(id) ? (id === 'fluid' ? 'Vaults + lending deposits' : id === 'morpho' ? 'Markets + vault deposits' : id === 'aave-v4' ? 'Lending + tokenized deposits' : 'Reader built · verification pending') : 'Integration in progress'}</small></div>)}</div><div className="welcome-note"><span aria-hidden="true"><Arrow /></span><div><h3>Start with a wallet address</h3><p>We’ll read its supported lending positions, subtract debt from supplied assets, and estimate where liquidation could begin.</p></div></div></section>}
    <footer><span>DeFiMon <span className="footer-dot">/</span> Clarity for your on-chain positions.</span><span>Estimates can change. This monitor does not prevent liquidation.</span></footer></main></>;
  async function searchAddress(address: string, watchedTokens = customTokens) {
    // Refresh the displayed wallet even if the search input has been edited.
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setLoading(true); setError(''); setData(null); setDemo(false);
    const query = new URLSearchParams({ chain: 'all' });
    if (watchedTokens.length) query.set('tokens', watchedTokens.map(t => `${t.network}:${t.address}`).join(','));
    try { const response = await fetch(`/api/portfolio/${address}?${query}`, { signal: request.signal }); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Refresh failed.'); if (!request.signal.aborted) setData(body); }
    catch (e) { if (!request.signal.aborted) setError(e instanceof Error ? e.message : 'Refresh failed.'); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
