# DeFiMon

A read-only Ethereum and Plasma wallet dashboard for current lending positions and liquidation risk. No wallet connection, transaction signing, database, or historical tracking.

## Current scope

This is an **early implementation with readers for all five protocol families**. Coverage is limited to the versions and products below; it is not a complete wallet balance. Production build and deterministic tests run locally. Fluid and Aave v4 have been exercised against live Ethereum positions; Aave v3 and Compound still require live position comparisons before use for financial monitoring.

| Protocol | Implemented coverage | Limitations |
| --- | --- | --- |
| Aave v3 | Ethereum and Plasma main markets; deposits, debts, native health factor, oracle prices | Other deployments excluded. Per-asset liquidation prices withheld for efficiency mode. |
| Compound | v3 USDC and WETH markets; base balances, collateral, liquidation factors | v2 and other v3 markets excluded. |
| Aave v4 | 14 Ethereum lending markets plus 37 tokenized-deposit contracts; deposits, premium-inclusive debt, native health factor, and collateral liquidation estimates | Official address-book snapshot, direct ownership only; linked accounts and treasury infrastructure excluded. New deployments require a roster update. |
| Morpho | Ethereum Morpho Blue direct markets plus vault V1/V2 deposits; accrued balances, debt, net value, oracle health, and liquidation estimates | Requires the public Morpho API for discovery/prices. Indexing lag can omit newly opened positions. Legacy Optimizers, linked accounts, and unclaimed rewards excluded. Full live discovery is not yet verified in this cloud environment. |
| Fluid | Ethereum and Plasma T1–T4 vaults and ordinary fToken lending deposits; balances, debt, health estimate and liquidation boundary | Direct ownership only. Standalone DEX/smart-lending deposits and linked smart accounts excluded. Smart vaults show oracle-ratio boundaries rather than a single underlying token’s dollar liquidation price. |

Unavailable protocols are **unknown**, never zero balances. Readers can return partially checked results: successful positions remain visible, while unreadable positions or missing USD prices are explicitly unknown. Dollar totals exclude an entire position if either side cannot be priced, so missing collateral is not mistaken for a negative balance. All totals are labeled partial. Example mode is synthetic, labeled on screen, and never substitutes for a failed live lookup.

## Run locally

Requires Node.js 24 and npm. Use the existing checkout; cloud tasks are already isolated and do not need an additional Git worktree.

```sh
cd /workspace/DeFiMon
npm ci --cache /workspace/.npm-cache
cp .env.example .env
npm run dev
```

Copy `.env.example` only when `.env` does not already exist. Set `ETHEREUM_RPC_URL` in `.env` to an Ethereum mainnet HTTPS provider. The example public provider has no API key and may throttle requests. A dedicated provider is preferable for regular use. Keep provider credentials on the server; never use a wallet key or seed phrase.

The local Vite server uses port 5173 and forwards `/api` to port 3001. For a built version:

```sh
npm run build
npm start
```

The production server serves both the website and API on `PORT` (default 3001). `/api/health` checks the web server and configuration presence; it does not prove Ethereum access. An actual wallet request is required to validate the connection.

## Plasma support

Enter your wallet address and select **Check wallet** to read **Ethereum and Plasma together**. Results are grouped by protocol: Aave v3 on Ethereum followed by Aave v3 on Plasma, then Ethereum Aave v4, Morpho, and Compound, followed by Fluid on Ethereum and Fluid on Plasma. Each card labels its blockchain. No network selector is needed. Plasma currently checks Aave v3 and Fluid; Ethereum checks all five protocol families.

The summary totals add the priced positions from both networks. Collateral, health factors, and liquidation estimates remain independent for each position; collateral on one network never protects borrowing on another. Each network has its own displayed block and check time. Refresh updates both networks for the displayed wallet. If one provider fails, the other network’s results remain visible and the failed network’s readers show unknown balances. The illustrative example includes explicitly fictional positions on both networks.

Plasma uses chain ID **9745** and native currency **XPL**. The public `https://rpc.plasma.to` endpoint is the default. To use your own provider, add `PLASMA_RPC_URL=https://your-provider` to your existing `.env` file (or your host’s environment variables). Keep your existing `ETHEREUM_RPC_URL` for Ethereum; do not replace the whole `.env` file. Restart the server after changing it. No wallet connection or signing key is required.

Both Plasma readers show current deposits, debt, net value, health, and applicable liquidation estimates with the same coverage limits as Ethereum. Aave efficiency mode retains its native health factor but withholds per-asset liquidation prices. Fluid covers T1–T4 vault NFTs and ordinary lending fTokens; smart vaults show a liquidation oracle ratio. Fluid uses Plasma’s Aave oracle for USD valuation, mapping native XPL to WXPL. For standard T1 borrowing positions, missing collateral USD prices can be estimated from Fluid’s liquidation ratio and an independently sourced debt-token USD price. These prices are labeled “Fluid oracle estimate,” the reader is marked partially checked, and supplied/net totals include the estimate. This is a protocol valuation, not a market-sale quote. The fallback does not assume stablecoin parity, replace available independent prices, or apply smart-pool share ratios to underlying assets. Without a valid ratio and a known debt-token price, quantities and oracle-based risk remain visible with unknown dollar values. Ethereum’s Chainlink registry is never queried on Plasma.

Deployment sources: [Aave Plasma address book](https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Plasma.sol) and [Fluid Plasma deployment artifacts](https://github.com/Instadapp/fluid-contracts-public/tree/404d73f91e6806f881f8dabeb30494f93f9e99b7/deployments/plasma). The used Fluid resolver interfaces were compared with the pinned Ethereum ABIs and match. A provider reporting another chain ID is rejected before reading protocols.

Run a live local check with a public wallet address:

```sh
npm run check:plasma -- 0xYourWalletAddress
```

The website requests `/api/portfolio/0xYourWalletAddress?chain=all`, which returns seven protocol/network readers in display order and a separate `networks` snapshot for each chain. A failed network has no block number and explicit error cards; it is not a verified empty wallet. Per-network API access remains available with `chain=ethereum` or `chain=plasma`; omitting `chain` continues to use Ethereum for compatibility. Health reports configuration presence, not successful blockchain access.

Validation: deterministic reader, network-routing, provider-selection, and browser checks cover Plasma. This cloud environment denied access to `rpc.plasma.to` (CONNECT 403), so a live Plasma wallet comparison is still required on a computer or host that can reach the provider. No cloud environment settings have been published by this change.

## Current interest rates

Every supplied/borrowed asset row has **Supply APR** and **Borrow APR**. APR is the current interest rate expressed per year, without assuming compounding. Rates refresh with the wallet and use the same selected network block as its balances. These are current quotes, not past-day averages or a promise of future returns. The example’s rates are fictional.

A dash means that the wallet has no balance on that side. **Unavailable** means a current rate could not be verified; balances and liquidation risk remain visible. A genuine zero-interest rate shows **0.00%**. **≈** marks an estimate or an incomplete income component; open **Rate details / Estimate details** beside the rate for its scope. Negative supply APR means a charge; negative borrow APR means a net incentive within the quoted components. Cash wallet balances have no lending APR merely because they are held.

- **Aave v3, Ethereum and Plasma:** current liquidity APR and the wallet’s balance-weighted variable/stable borrowing APR. Annual ray rates are divided by 1e27. Stable borrowing uses the wallet’s own stable rate; the reserve supplies the variable rate. Reward-token incentives are excluded.
- **Aave v4:** current Hub drawn-rate quotes, accrued drawn index, added assets, premium shares, liquidity fee, and virtual assets determine supply interest. Borrowing APR includes the wallet’s stored premium-share exposure on total debt. The same underlying across reserves is weighted separately by supply and borrow balances; a missing active component keeps the aggregate rate unknown. Tokenized deposits use the same Hub supply APR. Reinvestment income and external reward tokens are excluded; swept capital and effective debt quotes are labeled estimates.
- **Compound v3:** base-token rates use utilization read after simulated current-block accrual. Rates per second are annualized over 365 days. Collateral assets earn zero protocol supply interest; their intrinsic yield and COMP incentives are separate.
- **Fluid, Ethereum and Plasma:** ordinary vault legs use signed `supplyRateVault` / `borrowRateVault` after vault adjustments (100 = 1%). Smart legs combine each underlying token’s interest-bearing Liquidity rate with the signed vault adjustment. Their trading income cannot be calculated from an instant snapshot, so the displayed interest component is labeled an estimate. Lending fTokens use modern total-holder APR where supported, otherwise the exact legacy resolver layout with separately converted bonus units (1e12 = 1% for the legacy streaming model). An incompatible layout is rejected rather than misread.
- **Morpho Blue:** the IRM is queried in the same read-only simulation as accrual, using the resulting market state, so adaptive model state is current and a past accrual interval’s average is not substituted. The per-second borrow rate is annualized; supply APR includes utilization and the market fee. Unlent collateral earns no protocol interest. Same-token lent/collateral quantities are weighted correctly. Incentives and intrinsic token yield are separate.
- **Morpho vaults:** V1 estimates weight current market lending APRs and idle cash and subtract the performance fee. V2 estimates support direct-market adapters and V1-vault adapters, with current allocation checks, the distribution cap, and enabled performance/management fees. An unsupported funded adapter or an unreadable allocation makes the rate unavailable. No historical APY is substituted.

Rate checks have deterministic coverage for units, weights, fees, adaptive-state simulation, true zero, negative adjustments, and missing data. Live Ethereum checks at block 26408160 read Fluid smart-leg rates, a Morpho market’s current rates, a V1 vault allocation estimate, and an interest-free Aave v4 Hub. Plasma remains blocked by this cloud’s network policy; local live comparison is still needed. Rate reading needs no new API key or outbound destination beyond the existing network providers.

## Wallet token balances

The **Wallet tokens** section shows Ethereum first, then Plasma. It includes native **ETH** and **XPL**, the supported ERC-20 token list, and any additional token contracts you enter. Ethereum’s default list includes USDe, USDT, USDC, EUL, COMP, and the user-selected **WFRAX** at `0x04acaf8d2865c0714f79da09645c13fd2888977f`. WFRAX’s symbol and 18 decimals were checked on Ethereum and its address matches Frax’s official deployment list. Other symbols are read from their actual token contracts rather than guessed from names.

**Net value = priced wallet tokens + priced lending deposits − borrowing.** The Total supplied and Total borrowed cards still describe lending positions; ordinary wallet holdings appear in the wallet section. These holdings do not change a borrowing position’s health factor or liquidation rules.

The scanner checks a pinned list of common Ethereum tokens (Uniswap’s default list plus Aave underlyings and WFRAX) and Plasma assets from the official Aave/Fluid deployments. It is **not** an indexer that can discover every token ever sent to a wallet. Only nonzero ERC-20 balances are listed; native currency is always shown. To check another token, open **Add another token**, choose its network, paste its contract address, and select **Add token**. Up to 20 additional contracts are allowed per search. Adding/removing a token refreshes the currently displayed wallet; Refresh retains the added contracts. This list stays only in the open page and clears on a page reload.

Balances and token decimals use the same per-network block as lending positions. Prices first use the selected network’s Aave oracle, then Ethereum’s Chainlink registry where available. A public DefiLlama Coins API lookup supplies remaining prices without an API key. That optional service needs outbound HTTPS access to **`coins.llama.fi`**; it receives network/token addresses, not the searched wallet or provider credentials. Quotes must have matching token decimals, confidence of at least 0.9, and a timestamp within the last hour (with at most five minutes of future clock tolerance). USD prices may update at a different time than the displayed block. No stablecoin is assumed to equal $1.

If a balance, price, or token metadata cannot be read, it stays unknown and warnings identify incomplete coverage. Net value includes only known priced amounts. Lending receipt tokens represented by the supported protocol readers (Aave v3 aTokens, Aave v4 tokenized deposits, Compound v3 receipts, Fluid fTokens, and discovered Morpho vault shares) are excluded from wallet totals. If the receipt-token checks fail, ERC-20 values are excluded from the total until they can be checked; native currency remains independent.

Token-list provenance is recorded in `server/deployments/wallet-tokens.ts`, with Uniswap’s upstream GPL-3.0 license included alongside it. Live Ethereum validation read native ETH and ERC-20 balances and valued ETH, USDe, and COMP using on-chain prices. This cloud still blocks Plasma and the external fallback price service, so their live paths require validation on a host that can reach those services.

A standalone balance diagnostic is available:

```sh
npm run check:wallet -- 0xYourWalletAddress ethereum
npm run check:wallet -- 0xYourWalletAddress plasma
```

The API accepts extra contracts as `tokens=ethereum:0xTokenAddress,plasma:0xTokenAddress` alongside `chain=all` (or a per-network request). Contract inputs are validated and deduplicated; no provider URL can be supplied through this parameter.

## Hosting

The simplest deployment for this implementation is one **Node web service**, for example on Render. A static-only host will not run the API.

1. Push this repository to your GitHub account.
2. In Render, create a Web Service from the repository, with Node 24.
3. Set the build command to `npm ci --include=dev && npm run build` and start command to `npm start`.
4. Add `ETHEREUM_RPC_URL` securely in the service settings. Render supplies `PORT`.
5. After deployment, check a known wallet and compare its balances and risk with the protocol's website.
6. Add your custom domain through the host's settings when ready.

No deployment or Git push is performed by the local build. Hosting/provider plans and prices vary. Before opening this to broad public traffic, configure provider quotas and hosting-level rate limits. The API bounds concurrent requests, but this is not a distributed abuse protection system.

## Calculations

- Net value = supplied value minus debt value. Supplied value already includes collateral; receipt tokens are not counted again.
- All on-chain calls for a wallet use one Ethereum block. Numbers can change after the lookup; refresh manually for a new snapshot.
- Aave uses native account debt and health factor, reserve balances, and its price oracle. The pool, data provider, and oracle are resolved from the official Ethereum addresses provider.
- Compound uses its price feeds and **liquidateCollateralFactor**, rather than the borrowing collateral factor. A single read-only multicall simulates `accrueAccount` before reading base balances. This does not submit a transaction.
- For an individual asset, solve `weighted collateral = debt` while all other prices/balances stay fixed. If that asset is both supplied and borrowed, both sides move with its price.
- Per-asset estimates are scenario calculations, not predictions. A dash means no positive downward boundary can be estimated, no debt, or an unsupported mode. They are not a promise that a position is safe.
- Risk bands: health <= 1 threshold reached; below 1.1 high; below 1.3 watch; otherwise lower. These are display conventions. Protocol rounding, interest, changing prices, and special liquidation rules can affect execution.
- Aave v4 reads each lending Spoke separately: a healthy position in one market does not protect debt in another. Reserve enumeration includes non-collateral deposits. Current underlying balances come from `getUserSuppliedAssets`; debt from `getUserTotalDebt` includes drawn and risk-premium debt.
- V4 account Value units are **USD × 1e26**; `totalDebtValueRay` is **USD × 1e53**; health factor and average collateral factor are **1e18** scaled. These differ from v3. The reader checks that the market oracle uses the required 8-decimal USD precision before converting native USD account totals.
- V4 liquidation estimates use `getDynamicReserveConfig(reserveId, userPosition.dynamicConfigKey)`, not the reserve’s newest configuration key. Repeated underlying assets are merged with enabled-only collateral weights, so price scenarios account for the token appearing on both sides of the position. Native health stays authoritative.
- V4 tokenized-deposit balances use ERC-4626 `convertToAssets` once. A matching reserve for the exact Hub/asset pair supplies the USD oracle price. Deposit-only tokens have no borrowing or collateral liquidation risk. Missing feeds or failed market reads are explicit partial/unknown results, not zero balances.
- V4 estimates assume prices of other tokens, balances, and the current premium debt stay fixed. Future interest, risk-premium changes, user actions that refresh settings, and protocol rounding can change the boundary.
- Fluid discovers vault NFTs using the official VaultResolver and reads each NFT independently. Each NFT has separate risk, even when multiple NFTs use the same vault. Closed NFTs are omitted; balances after liquidation use the resolver’s remaining supply and debt.
- Fluid T2/T3/T4 collateral and debt shares are expanded into underlying tokens using DexResolver per-share amounts from a read-only simulation. Its contracts catch some internal failures and return zeros; all-zero conversion results are treated as unavailable, not zero balances.
- Fluid health = `current supply × liquidation oracle price / 1e27 × liquidation threshold / current debt`, in the resolver’s raw units. This uses the **liquidation** oracle, not the operating oracle or borrowing limit. Tick rounding can affect actual liquidation execution.
- Standard Fluid vaults show a dollar liquidation price assuming the debt token USD price is fixed. Smart vaults instead show current and threshold oracle ratios (debt token or debt pool shares per collateral token or collateral pool share). A pool share quote represents 10^18 raw shares. These are protocol ratios, not a prediction about one underlying token.
- Fluid USD valuations use Aave’s oracle with a Chainlink USD Feed Registry fallback (positive, complete round, no more than 24 hours old at the selected block). Native ETH maps to WETH for Aave pricing. Unsupported prices remain null; stablecoins are never assumed to be worth $1. USD valuation does not determine Fluid’s health estimate.
- Ordinary lending fToken shares are converted once to current underlying assets with `convertToAssets`; they have no borrowing or collateral-liquidation risk.
- Morpho uses the public `https://api.morpho.org/graphql` API only for Ethereum market/vault discovery and indicative USD prices. Market and V1-vault results are paginated; V2 holdings come from `userByAddress(address, chainId: 1)` and its unpaginated `vaultV2Positions` list. A missing user entity is reported as unknown coverage. Failed queries, incomplete pages, duplicate rows, and malformed/wrong-wallet/wrong-chain records are explicit warnings, not a verified empty wallet. No API key is required. Newly created/changed positions may be missing until indexed.
- Morpho identities and token decimals are rechecked on Ethereum. Market parameters are loaded from canonical Morpho Blue (`0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`) and hashed back to the market ID. A vault must be recognized by the factory reported by the official API; V1 vaults must also point to this canonical core. This verifies data identities, not investment safety or curator quality.
- One read-only multicall simulates Morpho market `accrueInterest` before reading market totals and user shares. Supply conversion rounds down; borrowing rounds up, using 1 virtual asset and 1,000,000 virtual shares. Collateral is counted separately from loan-token supply. Loan supply does **not** protect a borrowing position, even within the same market.
- Morpho oracle prices use **1e36** raw-unit scaling. Health matches the protocol’s two floor divisions: `floor(floor(collateral × oraclePrice / 1e36) × LLTV / 1e18) / rounded-up debt`. A reverting oracle gives unknown risk; a successfully read zero price gives zero collateral capacity, as in the protocol. Currency conversion accounts for both tokens’ decimals.
- Morpho vault shares are valued once, without adding their underlying market allocations again. V1 uses the current ERC-4626 conversion. V2 simulates accrual, then reads the user balance, total shares, stored assets, and virtual shares together so fee-share minting and current interest are included. Vault-only holdings have no wallet borrowing liquidation price.
- Morpho USD prices are indicative API prices and may update at a different time than the pinned Ethereum block. They never determine health. Missing prices stay unknown; a token is never assumed to be worth $1. A liquidation USD estimate assumes the loan-token price and both balances stay fixed. The collateral/loan oracle ratio is also shown independently of USD valuation.
- Display calculations use floating-point numbers after decoding integer balances. They are estimates and should not be used for transaction sizing at the liquidation boundary.

Contract sources: [Aave address book](https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Ethereum.sol), [Aave data provider](https://github.com/aave/aave-v3-origin/blob/main/src/contracts/helpers/AaveProtocolDataProvider.sol), Compound [USDC](https://github.com/compound-finance/comet/blob/main/deployments/mainnet/usdc/roots.json) and [WETH](https://github.com/compound-finance/comet/blob/main/deployments/mainnet/weth/roots.json) deployments. Fluid’s selected ABI entries and deployment addresses come from [Instadapp/fluid-contracts-public at 404d73f](https://github.com/Instadapp/fluid-contracts-public/tree/404d73f91e6806f881f8dabeb30494f93f9e99b7/deployments/mainnet). The deployed ABI is pinned in `server/abis/fluid.ts`; current Solidity source has additional struct fields and must not be substituted without checking deployment compatibility.

Aave v4 deployments are pinned from the [official address book at b8c801a](https://github.com/bgd-labs/aave-address-book/blob/b8c801a413c4b934afaf7976d2ddc5fbada6dce6/src/AaveV4Ethereum.sol). Interfaces and normalization follow [Aave v4 at 8be3e0d](https://github.com/aave/aave-v4/tree/8be3e0d59efc23cd1d4664a88743340533dd5a0c/src/spoke), especially `ISpoke.sol` and `libraries/SpokeUtils.sol`. Lists are checked into `server/deployments/aave-v4.ts`; the application never loads executable configuration from a remote source at runtime.

## Validation

```sh
npm test
npm run build
npm run test:browser
```

Unit/API tests cover price boundaries, debt in the same asset, efficiency mode, block consistency, simulated Compound accrual, input validation, and isolated failures. Browser tests cover search, example labeling, errors, refreshed responses, and mobile layout using controlled API fixtures. Browser fixtures do not establish live protocol accuracy.

Fluid was also checked on Ethereum against live standard (T1), smart collateral (T2), and smart collateral/debt (T4) positions at blocks 26406819–26406833, plus a live fUSDC lending deposit at block 26406841. T3 behavior is covered by deterministic fixtures, not an active T3 wallet comparison. One live T2 position had an unsupported syrupUSDC dollar price; the reader correctly retained its balances and oracle health while marking its valuation incomplete. The first two wallets in `TestCases` were also checked at blocks 26406856–26406857: the first returned one active T4 GHO/USDC position with a health estimate near 1.03; the second returned no directly held covered Fluid positions. These checks validate the data path and calculations, not exact liquidation execution at the boundary.

To repeat a live check for a wallet with known Fluid positions:

```sh
npm run check:fluid -- 0xYourEthereumWalletAddress
```

This reads the current block and prints the complete Fluid result. It exits unsuccessfully if any part is unknown or no positions are found; a zero-position lookup is not treated as a meaningful position check.

Browser tests use `/usr/bin/chromium` when present; otherwise run `npx playwright install chromium` first. Override `CHROMIUM_PATH` to use another installed executable.

Aave v4 live checks confirmed all 14 lending contracts and 37 tokenized-deposit balance readers on Ethereum. A live Main-market borrower at block 26407382 returned wstETH collateral, USDC/USDT debt, and a native health factor near 4.10645, with estimated collateral liquidation prices. The second wallet in `TestCases` had no covered direct v4 positions at block 26407366. Tokenized-deposit conversion/valuation interfaces were also checked against live contract-wide supply; an individual active tokenized holder was not independently validated. Historical transfer discovery was limited by the public provider’s archive policy; current-state wallet lookup does not require historical logs.

Repeat a current-state check with a known active v4 wallet:

```sh
npm run check:aave-v4 -- 0xYourEthereumWalletAddress
```

Like the Fluid check, this reports the selected block and result and exits unsuccessfully for incomplete or empty portfolios. It does not store a balance history.

Morpho interfaces, schema reference, share math, and deployment information follow [morpho-org/sdks at 56f1ed6](https://github.com/morpho-org/sdks/tree/56f1ed62827a7aab39d979c0143d1fbf970c37ca). Queries use the SDK’s `marketId` field (aliased to `uniqueKey`) and support an older `uniqueKey` schema only after an explicit unknown-field response. Token prices use the current `Asset.price { usd timestamp }` response, confirmed by public API introspection from a local deployment. The nested `usd` value is accepted only when it is a positive finite number. Null, missing, or invalid prices remain unknown. Older scalar `priceUsd` / `oraclePriceUsd` schemas are retried only after explicit unknown-field errors; if none is supported, discovery proceeds without prices. Token quantities and protocol-oracle liquidation risk remain available while missing USD values stay unknown. V2 discovery uses the SDK’s single-wallet `userByAddress` lookup rather than the unsupported `users` connection reported by a local deployment. These compatibility paths have regression tests; full live API validation remains blocked in this cloud.

Repeat a current-state Morpho check for a known active wallet:

```sh
npm run check:morpho -- 0xYourEthereumWalletAddress
```

Morpho validation so far: deterministic calculation/discovery/API/browser tests pass. A live Blue borrower at blocks 26407512–26407513 returned USDC debt and an apyUSD/USDC liquidation ratio, with health near 1.02133. A live V1 Steakhouse USDC holder at block 26407555 returned 48,209.191007 underlying USDC. These were diagnostic reads with manually selected references, **not** successful full official-API wallet discovery; diagnostic USD prices were absent or separately sourced on-chain. V2 behavior is fixture-tested against the official interface and accounting formula; an active Ethereum V2 holder was not verified.

To diagnose a Morpho error on the computer hosting the website, run:

```sh
npm run diagnose:morpho -- 0xYourEthereumWalletAddress
```

This tests the same public API queries and proxy settings as the website, without using the Ethereum provider. It reports connection/timeouts, HTTP status, query compatibility, or unexpected responses separately. It does not print provider credentials, proxy credentials, or `.env` contents. The public wallet address is sent to Morpho. A successful test checks discovery only; Ethereum reads must still succeed. The website also distinguishes these failure categories. Older versions displayed one generic message for all of them. Compatibility retries now handle explicit unknown-field errors returned with HTTP 400/422 as well as HTTP 200.

For an endpoint exposing the newer `Asset.price` field, `npm run diagnose:morpho -- --schema` reports that field’s return type and available child fields, without sending a wallet address. The current integration reads the verified nested `usd` value for display; its `timestamp` describes the API price, which may differ from the pinned Ethereum block. The compatibility fallback preserves token balances with unknown dollar values if the endpoint exposes no supported price field.

**Outstanding cloud requirement:** this instance denied access to `api.morpho.org`. A draft network addition was saved, preserving the existing Ethereum RPC destination, but applying it was rejected as exceeding the configured limit. This requires resolution of the environment’s permitted network limit; application code cannot raise that limit. Until the API path is allowed and tested, do not describe Morpho’s full live wallet discovery as verified. This cloud restriction does not establish the cause of a failure on another computer. No wallet private key, API token, or new database is needed. Local hosting requires outbound HTTPS access to this API as well as its Ethereum provider.

## Privacy and operations

The application does not persist wallet searches, balances, or history. Hosting access logs, your Ethereum provider, and Morpho’s public lookup service may record requests. Morpho lookups send the searched wallet address to that service. Results use `Cache-Control: no-store`. The server never returns raw provider errors or provider URLs. Keep `.env` out of Git.

The cloud environment permits `ethereum-rpc.publicnode.com` and live Fluid reads were verified. Hosting elsewhere requires configuring its own `ETHEREUM_RPC_URL`. Environment publication and website deployment are separate operations.
