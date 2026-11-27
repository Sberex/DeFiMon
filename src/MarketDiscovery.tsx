import {
  strategySupplyChoices,
  strategyBorrowChoices,
  groupedStrategyMarkets,
} from './leveraged-strategies';
import React, { useEffect, useId, useRef, useState } from 'react';
import { apiUrl } from './api';
import {
  discoveryTokenChoices,
  groupedDiscoveryMarkets,
  type DiscoveryAsset,
  type DiscoveryMarket,
  type DiscoveryResult,
} from './market-discovery';
import { networkNames, networkExplorers } from './networks';
import type { NetworkId } from './types';
const percent = (value: number | null | undefined) =>
  value == null ? 'Unavailable' : `${(value * 100).toFixed(2)}%`;
const quantity = (value: number) =>
  new Intl.NumberFormat('en-US', { maximumSignificantDigits: 7 }).format(value);
const money = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
function AssetPicker({
  label,
  value,
  onChange,
  choices = discoveryTokenChoices,
}: {
  choices?: { id: string; category: string }[];
  label: string;
  value: string | null | undefined;
  onChange: (value: string | null | undefined) => void;
}) {
  const id = useId(),
    [text, setText] = useState(value ?? 'Any asset'),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const choicesFor = (text: string) =>
    choices.filter((t) =>
      t.id.toLowerCase().startsWith(text.trim().toLowerCase()),
    );
  const matches = choicesFor(text.toLowerCase() === 'any asset' ? '' : text),
    visible = matches.slice(0, 50);
  const options = [
    { id: null as string | null, category: 'All assets' },
    ...visible,
  ];
  function choose(id: string | null) {
    setText(id ?? 'Any asset');
    onChange(id);
    setOpen(false);
    setActive(0);
  }
  return (
    <div className="discovery-asset-picker">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        aria-activedescendant={
          open
            ? `${id}-option-${Math.min(active, options.length - 1)}`
            : undefined
        }
        value={text}
        autoComplete="off"
        placeholder="Start typing a token name"
        onFocus={(e) => {
          e.currentTarget.select();
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          setOpen(true);
          setActive(choicesFor(next).length ? 1 : 0);
          onChange(
            next.trim().toLowerCase() === 'any asset'
              ? null
              : choices.find(
                  (t) => t.id.toLowerCase() === next.trim().toLowerCase(),
                )?.id,
          );
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            setActive((i) =>
              Math.max(
                0,
                Math.min(
                  options.length - 1,
                  i + (e.key === 'ArrowDown' ? 1 : -1),
                ),
              ),
            );
          }
          if (e.key === 'Enter' && open) {
            e.preventDefault();
            choose(options[Math.min(active, options.length - 1)].id);
          }
        }}
      />
      {open && (
        <div className="discovery-suggestions">
          <ul
            id={`${id}-options`}
            role="listbox"
            aria-label={`${label} suggestions`}
          >
            {options.map((option, i) => (
              <li
                id={`${id}-option-${i}`}
                key={option.id ?? 'any'}
                role="option"
                aria-selected={active === i}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(option.id)}
              >
                <strong>{option.id ?? 'Any asset'}</strong>
                <small>{option.category}</small>
              </li>
            ))}
          </ul>
          {matches.length > 50 && (
            <p>Type more letters to narrow {matches.length} matching assets.</p>
          )}
          {!visible.length && (
            <p>No configured token starts with these letters.</p>
          )}
        </div>
      )}
      {value === undefined && (
        <small className="discovery-picker-help">
          Choose a configured token or Any asset.
        </small>
      )}
    </div>
  );
}
function AssetCell({
  asset,
  network,
  required = [],
}: {
  asset: DiscoveryAsset | null;
  network: NetworkId;
  required?: DiscoveryAsset[];
}) {
  if (!asset) return <span className="muted">No borrowing</span>;
  return (
    <>
      <strong>{asset.name}</strong>
      <small>{asset.category}</small>
      <a
        className="discovery-contract"
        href={`${networkExplorers[networkNames[network]]}/token/${asset.address}`}
        target="_blank"
        rel="noreferrer"
      >
        <code>{asset.address}</code> ↗
      </a>
      {required
        .filter((a) => a.address !== asset.address)
        .map((a) => (
          <div className="discovery-required-asset" key={a.address}>
            <small>Also required in this pool</small>
            <AssetCell asset={a} network={network} />
          </div>
        ))}
    </>
  );
}
function DiscoverySearch({ strategy = false }: { strategy?: boolean }) {
  const [supply, setSupply] = useState<string | null | undefined>(null),
    [borrow, setBorrow] = useState<string | null | undefined>(null),
    [result, setResult] = useState<DiscoveryResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>(
    {},
  );
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (supply === undefined || borrow === undefined) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setResult(null);
    setVisibleCounts({});
    try {
      const response = await fetch(
        apiUrl(
          strategy ? '/api/leveraged-strategies' : '/api/market-discovery',
        ),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ supply, borrow }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw Error(
          typeof body.error === 'string'
            ? body.error
            : 'Market discovery could not complete. Please retry.',
        );
      }
      const data = await response.json();
      if (
        !Array.isArray(data.markets) ||
        !Array.isArray(data.coverage) ||
        !data.query
      )
        throw Error(
          'Market discovery returned an invalid response. Please retry.',
        );
      if (!controller.signal.aborted) setResult(data);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : 'Market discovery could not complete. Please retry.',
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const allGroups = strategy
    ? groupedStrategyMarkets(result?.markets ?? [])
    : groupedDiscoveryMarkets(result?.markets ?? []);
  const count = allGroups.reduce((n, group) => n + group.markets.length, 0);
  const belowCent = (market: DiscoveryMarket) =>
    strategy &&
    typeof market.liquidityUsd === 'number' &&
    Number.isFinite(market.liquidityUsd) &&
    market.liquidityUsd >= 0 &&
    market.liquidityUsd < 0.01;
  const groups = allGroups
    .map((g) => ({ ...g, markets: g.markets.filter((m) => !belowCent(m)) }))
    .filter((g) => g.markets.length);
  const smallGroups = allGroups
    .map((g) => ({ ...g, markets: g.markets.filter(belowCent) }))
    .filter((g) => g.markets.length);
  const smallCount = smallGroups.reduce((n, g) => n + g.markets.length, 0);
  const renderGroups = (
    rows: ReturnType<typeof groupedDiscoveryMarkets>,
    prefix = '',
  ) =>
    rows.map(({ network, markets }) => (
      <section
        key={network}
        aria-label={`Discovered markets on ${networkNames[network]}`}
        className="discovery-chain"
      >
        <h3>
          {networkNames[network]} <small>({markets.length})</small>
        </h3>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">
              Discovered markets on {networkNames[network]}, highest
              {strategy ? 'modelled APR' : 'available liquidity'} first
            </caption>
            <thead>
              <tr>
                <th>Market</th>
                <th>Supply Asset</th>
                <th>Supply APR</th>
                <th>Borrow Asset</th>
                <th>Borrow APR</th>
                <th aria-sort={strategy ? undefined : 'descending'}>
                  Available Liquidity{!strategy && ' ↓'}
                </th>
                <th>LLTV</th>
                {strategy && <th aria-sort="descending">APR ↓</th>}
              </tr>
            </thead>
            <tbody>
              {markets
                .slice(0, visibleCounts[prefix + network] ?? 50)
                .map((market, index) => (
                  <tr
                    key={`${market.protocol}:${market.market}:${market.route ?? ''}:${index}`}
                  >
                    <td>
                      <a href={market.url} target="_blank" rel="noreferrer">
                        {market.protocol} · {market.supplyAsset.name}
                        {market.borrowAsset
                          ? ` / ${market.borrowAsset.name}`
                          : ' deposit'}{' '}
                        · {market.market.slice(0, 10)}… ↗
                      </a>
                      <details>
                        <summary>Market details</summary>
                        <p>{market.label}</p>
                        <code className="discovery-contract">
                          {market.market}
                        </code>
                        {market.collateralVault && (
                          <a
                            href={market.collateralVault.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Collateral vault: {market.collateralVault.label} ↗
                          </a>
                        )}
                        <p>{market.note}</p>
                        <p>Snapshot block: {market.block}</p>
                      </details>
                    </td>
                    <td>
                      <AssetCell
                        asset={market.supplyAsset}
                        network={network}
                        required={market.requiredSupplyAssets}
                      />
                    </td>
                    <td>
                      <strong>{percent(market.totalSupplyApr)}</strong>
                      {market.supplyRateNote && (
                        <details>
                          <summary>Supply rate details</summary>
                          <p>{market.supplyRateNote}</p>
                        </details>
                      )}
                      {market.supplyAsset.intrinsicApr !== 0 && (
                        <small>
                          Protocol: {percent(market.supplyApr)}
                          <br />
                          Intrinsic: {percent(market.supplyAsset.intrinsicApr)}
                        </small>
                      )}
                      {!!market.merklSupplyApr && (
                        <small>
                          Merkl supply incentive: +
                          {percent(market.merklSupplyApr)}
                        </small>
                      )}
                      {market.merklPrograms
                        ?.filter((p) => p.side === 'supply')
                        .map((p) => (
                          <details key={p.id}>
                            <summary>Merkl reward details</summary>
                            <a href={p.url} target="_blank" rel="noreferrer">
                              {p.name} ↗
                            </a>
                            <p>{p.note}</p>
                            <p>
                              Ends:{' '}
                              {new Date(p.endAt).toLocaleString(undefined, {
                                timeZone: 'Europe/Kiev',
                                timeZoneName: 'short',
                              })}
                            </p>
                          </details>
                        ))}
                    </td>
                    <td>
                      <AssetCell
                        asset={market.borrowAsset}
                        network={network}
                        required={market.requiredBorrowAssets}
                      />
                    </td>
                    <td>
                      {market.borrowAsset ? percent(market.borrowApr) : '—'}
                      {market.protocolBorrowApr != null && (
                        <small>
                          Protocol APR: {percent(market.protocolBorrowApr)}
                          <br />
                          Merkl incentive: −
                          {percent(market.merklBorrowApr ?? 0)}
                        </small>
                      )}
                      {market.merklPrograms
                        ?.filter((p) => p.side === 'borrow')
                        .map((p) => (
                          <details key={p.id}>
                            <summary>Merkl reward details</summary>
                            <a href={p.url} target="_blank" rel="noreferrer">
                              {p.name} ↗
                            </a>
                            <p>{p.note}</p>
                            <p>
                              Ends:{' '}
                              {new Date(p.endAt).toLocaleString(undefined, {
                                timeZone: 'Europe/Kiev',
                                timeZoneName: 'short',
                              })}
                            </p>
                            {market.protocolBorrowApy !== undefined && (
                              <p>
                                Protocol APY:{' '}
                                {percent(market.protocolBorrowApy)} · Merkl
                                reward APY: {percent(p.apy)}
                              </p>
                            )}
                          </details>
                        ))}
                      {market.borrowApy != null && (
                        <small>Borrow APY: {percent(market.borrowApy)}</small>
                      )}
                    </td>
                    <td>
                      {market.liquidity ? (
                        <>
                          <strong>
                            {quantity(market.liquidity.amount)}{' '}
                            {market.liquidity.symbol}
                          </strong>
                          {market.liquidityUsd !== null && (
                            <small>{money(market.liquidityUsd)}</small>
                          )}
                          <details>
                            <summary>Liquidity details</summary>
                            <p>{market.liquidity.note}</p>
                          </details>
                        </>
                      ) : (
                        <span className="muted">Unavailable</span>
                      )}
                    </td>
                    <td>
                      {market.lltv === null ? '—' : percent(market.lltv)}
                      {!strategy &&
                        market.borrowingModes?.some((mode) => mode.id > 0) && (
                          <details>
                            <summary>Eligible eModes</summary>
                            {market.borrowingModes
                              .filter((mode) => mode.id > 0)
                              .map((mode) => (
                                <p key={mode.id}>
                                  eMode {mode.id} · {mode.label}: LLTV{' '}
                                  {percent(mode.lltv)}, max LTV{' '}
                                  {percent(mode.ltv)}
                                </p>
                              ))}
                          </details>
                        )}
                      {strategy && market.modelledMode && (
                        <small>
                          {market.modelledMode.id
                            ? `eMode ${market.modelledMode.id} · ${market.modelledMode.label}`
                            : 'Standard collateral'}
                          <br />
                          {market.modelledEntryLtv !== undefined && (
                            <>Max LTV: {percent(market.modelledEntryLtv)}</>
                          )}
                        </small>
                      )}
                    </td>
                    {strategy && (
                      <td>
                        <strong>{percent(market.modelledApr)}</strong>
                        <small>
                          Health factor:{' '}
                          {(market.modelledHealthFactor ?? 1.02).toFixed(4)}
                        </small>
                        {market.modelledLtvLimited && (
                          <small>Limited by maximum entry LTV</small>
                        )}
                        <small>
                          Debt / collateral: {percent(market.modelledDebtRatio)}
                        </small>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {markets.length > (visibleCounts[prefix + network] ?? 50) && (
          <button
            type="button"
            className="secondary discovery-show-more"
            onClick={() =>
              setVisibleCounts((old) => ({
                ...old,
                [prefix + network]: (old[prefix + network] ?? 50) + 50,
              }))
            }
          >
            Show more markets (
            {Math.min(visibleCounts[prefix + network] ?? 50, markets.length)} of{' '}
            {markets.length} shown)
          </button>
        )}
      </section>
    ));
  return (
    <section
      className="market-discovery"
      aria-label={
        strategy ? 'Leveraged Borrowing Strategy Search' : 'Market Discovery'
      }
    >
      <div className="section-label">
        <h2>
          {strategy
            ? 'Leveraged Borrowing Strategy Search'
            : 'Market Discovery'}
        </h2>
        <span>Ethereum · Plasma · Arbitrum · Base · Binance Smart Chain</span>
      </div>
      <p className="recommendations-intro">
        {strategy ? (
          <>
            Find Savings stablecoin collateral with verified intrinsic APR above
            Stablecoin borrow APR. Target health factor: 1.02 or higher.
            Verified eligible Aave eMode is selected when it improves APR. Debt
            / collateral = min(LLTV / 1.02, maximum entry LTV); APR = (Supply
            APR − Borrow APR × debt ratio) / (1 − debt ratio). Supply APR
            includes protocol interest and intrinsic yield and verified Merkl
            incentives. Assumes constant prices and rates, excluding unverified
            rewards and fees. This is a model, not an execution quote.
          </>
        ) : (
          <>
            Find lending markets by supplied collateral and borrowed asset,
            without checking a wallet. Choose Any asset to leave either side
            unrestricted. When Borrow asset is Any asset, deposit-only markets
            are included too.
          </>
        )}
      </p>
      <form className="market-discovery-search" onSubmit={search}>
        <AssetPicker
          label="Supply asset"
          value={supply}
          onChange={setSupply}
          choices={strategy ? strategySupplyChoices : undefined}
        />
        <AssetPicker
          label="Borrow asset"
          value={borrow}
          onChange={setBorrow}
          choices={strategy ? strategyBorrowChoices : undefined}
        />
        <button
          type="submit"
          disabled={busy || supply === undefined || borrow === undefined}
        >
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>
      {busy && (
        <p role="status">
          Checking supported market sources across all five chains… Broad
          searches can take a few minutes. Markets with unavailable rates or
          prices are labeled or omitted with coverage details.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {result && (
        <>
          <div className="discovery-results-summary">
            <h3>{count} markets found</h3>
            <p>
              Supply: {result.query.supply ?? 'Any asset'} · Borrow:{' '}
              {result.query.borrow ?? 'Any asset'}
            </p>
            <p>
              Snapshot: {new Date(result.checkedAt).toLocaleString()} · Sorted
              {strategy
                ? 'by modelled APR at health factor 1.02, highest first.'
                : 'by available liquidity in USD, highest first. Unpriced liquidity is placed last; same-token amounts remain comparable.'}
            </p>
          </div>
          {result.messages?.map((message) => (
            <p className="notice" key={message}>
              {message}
            </p>
          ))}
          {result.coverage.some(
            (c) => c.status === 'partial' || c.status === 'error',
          ) && (
            <p className="notice">
              Some sources could not be fully checked. These results cover the
              markets verified below; additional markets may exist.
            </p>
          )}
          {!count && (
            <p className="recommendations-empty">
              No matching markets were verified. Check source coverage below
              before assuming no market exists.
            </p>
          )}
          {renderGroups(groups)}
          {smallCount > 0 && (
            <details className="strategy-small-liquidity">
              <summary>
                Markets with available liquidity below $0.01 ({smallCount})
              </summary>
              {renderGroups(smallGroups, 'small:')}
            </details>
          )}
          <details className="discovery-coverage">
            <summary>
              Market discovery coverage ·{' '}
              {result.coverage.filter((c) => c.status === 'ok').length} sources
              completed
            </summary>
            <p>
              Rates include verified Merkl incentives for the displayed pair.
              Other wallet supplies or debts may change eligibility; unverified
              programs are excluded. Supply APR includes verified savings-token
              intrinsic yield where applicable. Caps, collateral eligibility,
              LLAMMA bands and access rules can affect entry; available
              liquidity is a market snapshot.
            </p>
            <ul>
              {result.coverage.map((c, index) => (
                <li key={`${c.protocol}:${c.network}:${index}`}>
                  {c.protocol} · {networkNames[c.network]}:{' '}
                  {c.status === 'ok'
                    ? 'Checked'
                    : c.status === 'partial'
                      ? 'Partially checked'
                      : c.status === 'unsupported'
                        ? 'Not supported'
                        : 'Unavailable'}
                  {c.message && ` · ${c.message}`}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}

export function MarketDiscovery() {
  return (
    <>
      <DiscoverySearch />
      <DiscoverySearch strategy />
    </>
  );
}
