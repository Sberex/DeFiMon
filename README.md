# DeFiMon

A read-only Ethereum wallet dashboard for current lending positions and liquidation risk. No wallet connection, transaction signing, database, or historical tracking.

## Current scope

This is an **early implementation with readers for all five protocol families**. Coverage is limited to the versions and products below; it is not a complete wallet balance. Production build and deterministic tests run locally. Fluid and Aave v4 have been exercised against live Ethereum positions; Aave v3 and Compound still require live position comparisons before use for financial monitoring.

| Protocol | Implemented coverage | Limitations |
| --- | --- | --- |
| Aave v3 | Ethereum main market; deposits, debts, native health factor, oracle prices | Other deployments excluded. Per-asset liquidation prices withheld for efficiency mode. |
| Compound | v3 USDC and WETH markets; base balances, collateral, liquidation factors | v2 and other v3 markets excluded. |
| Aave v4 | 14 Ethereum lending markets plus 37 tokenized-deposit contracts; deposits, premium-inclusive debt, native health factor, and collateral liquidation estimates | Official address-book snapshot, direct ownership only; linked accounts and treasury infrastructure excluded. New deployments require a roster update. |
| Morpho | Ethereum Morpho Blue direct markets plus vault V1/V2 deposits; accrued balances, debt, net value, oracle health, and liquidation estimates | Requires the public Morpho API for discovery/prices. Indexing lag can omit newly opened positions. Legacy Optimizers, linked accounts, and unclaimed rewards excluded. Full live discovery is not yet verified in this cloud environment. |
| Fluid | Ethereum T1–T4 vaults and ordinary fToken lending deposits; balances, debt, health estimate and liquidation boundary | Direct ownership only. Standalone DEX/smart-lending deposits and linked smart accounts excluded. Smart vaults show oracle-ratio boundaries rather than a single underlying token’s dollar liquidation price. |

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
- Morpho uses the public `https://api.morpho.org/graphql` API only for Ethereum market/vault discovery and indicative USD prices. Market and V1-vault results are paginated; V2 holdings come from the user entity’s unpaginated `vaultV2Positions` list. Failed queries, incomplete pages, duplicate rows, and malformed/wrong-wallet/wrong-chain records are explicit warnings, not a verified empty wallet. No API key is required. Newly created/changed positions may be missing until indexed.
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

Morpho interfaces, schema reference, share math, and deployment information follow [morpho-org/sdks at 56f1ed6](https://github.com/morpho-org/sdks/tree/56f1ed62827a7aab39d979c0143d1fbf970c37ca). Queries use the SDK’s current `marketId` field (aliased to `uniqueKey`) and support an older `uniqueKey` schema only after an explicit unknown-field response.

Repeat a current-state Morpho check for a known active wallet:

```sh
npm run check:morpho -- 0xYourEthereumWalletAddress
```

Morpho validation so far: deterministic calculation/discovery/API/browser tests pass. A live Blue borrower at blocks 26407512–26407513 returned USDC debt and an apyUSD/USDC liquidation ratio, with health near 1.02133. A live V1 Steakhouse USDC holder at block 26407555 returned 48,209.191007 underlying USDC. These were diagnostic reads with manually selected references, **not** successful full official-API wallet discovery; diagnostic USD prices were absent or separately sourced on-chain. V2 behavior is fixture-tested against the official interface and accounting formula; an active Ethereum V2 holder was not verified.

**Outstanding cloud requirement:** this instance denied access to `api.morpho.org`. A draft network addition was saved, preserving the existing Ethereum RPC destination. Review/save that addition in Environment settings and publish the environment as needed, then rerun a fresh live lookup. Until that is applied and the API path is tested, do not describe Morpho’s full live wallet discovery as verified. No wallet private key, API token, or new database is needed. Local hosting requires outbound HTTPS access to this API as well as its Ethereum provider.

## Privacy and operations

The application does not persist wallet searches, balances, or history. Hosting access logs, your Ethereum provider, and Morpho’s public lookup service may record requests. Morpho lookups send the searched wallet address to that service. Results use `Cache-Control: no-store`. The server never returns raw provider errors or provider URLs. Keep `.env` out of Git.

The cloud environment permits `ethereum-rpc.publicnode.com` and live Fluid reads were verified. Hosting elsewhere requires configuring its own `ETHEREUM_RPC_URL`. Environment publication and website deployment are separate operations.
