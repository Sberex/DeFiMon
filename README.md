# DeFiMon

A read-only Ethereum wallet dashboard for current lending positions and liquidation risk. No wallet connection, transaction signing, database, or historical tracking.

## Current scope

This is an **early implementation, not a complete five-protocol monitor**. Production build and deterministic tests run locally. Fluid has been exercised against live Ethereum positions; Aave and Compound still require live position comparisons before use for financial monitoring.

| Protocol | Implemented coverage | Limitations |
| --- | --- | --- |
| Aave v3 | Ethereum main market; deposits, debts, native health factor, oracle prices | Other deployments excluded. Per-asset liquidation prices withheld for efficiency mode. |
| Compound | v3 USDC and WETH markets; base balances, collateral, liquidation factors | v2 and other v3 markets excluded. |
| Aave v4 | Explicit “not connected” state | Deployment and reader verification required. |
| Morpho | Explicit “not connected” state | Market/vault discovery and reader required. |
| Fluid | Ethereum T1–T4 vaults and ordinary fToken lending deposits; balances, debt, health estimate and liquidation boundary | Direct ownership only. Standalone DEX/smart-lending deposits and linked smart accounts excluded. Smart vaults show oracle-ratio boundaries rather than a single underlying token’s dollar liquidation price. |

Unavailable protocols are **unknown**, never zero balances. Fluid can return partially checked results: successful positions remain visible, while unreadable positions or missing USD prices are explicitly unknown. Dollar totals exclude an entire position if either side cannot be priced, so missing collateral is not mistaken for a negative balance. All totals are labeled partial. Example mode is synthetic, labeled on screen, and never substitutes for a failed live lookup.

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
- Fluid discovers vault NFTs using the official VaultResolver and reads each NFT independently. Each NFT has separate risk, even when multiple NFTs use the same vault. Closed NFTs are omitted; balances after liquidation use the resolver’s remaining supply and debt.
- Fluid T2/T3/T4 collateral and debt shares are expanded into underlying tokens using DexResolver per-share amounts from a read-only simulation. Its contracts catch some internal failures and return zeros; all-zero conversion results are treated as unavailable, not zero balances.
- Fluid health = `current supply × liquidation oracle price / 1e27 × liquidation threshold / current debt`, in the resolver’s raw units. This uses the **liquidation** oracle, not the operating oracle or borrowing limit. Tick rounding can affect actual liquidation execution.
- Standard Fluid vaults show a dollar liquidation price assuming the debt token USD price is fixed. Smart vaults instead show current and threshold oracle ratios (debt token or debt pool shares per collateral token or collateral pool share). A pool share quote represents 10^18 raw shares. These are protocol ratios, not a prediction about one underlying token.
- Fluid USD valuations use Aave’s oracle with a Chainlink USD Feed Registry fallback (positive, complete round, no more than 24 hours old at the selected block). Native ETH maps to WETH for Aave pricing. Unsupported prices remain null; stablecoins are never assumed to be worth $1. USD valuation does not determine Fluid’s health estimate.
- Ordinary lending fToken shares are converted once to current underlying assets with `convertToAssets`; they have no borrowing or collateral-liquidation risk.
- Display calculations use floating-point numbers after decoding integer balances. They are estimates and should not be used for transaction sizing at the liquidation boundary.

Contract sources: [Aave address book](https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Ethereum.sol), [Aave data provider](https://github.com/aave/aave-v3-origin/blob/main/src/contracts/helpers/AaveProtocolDataProvider.sol), Compound [USDC](https://github.com/compound-finance/comet/blob/main/deployments/mainnet/usdc/roots.json) and [WETH](https://github.com/compound-finance/comet/blob/main/deployments/mainnet/weth/roots.json) deployments. Fluid’s selected ABI entries and deployment addresses come from [Instadapp/fluid-contracts-public at 404d73f](https://github.com/Instadapp/fluid-contracts-public/tree/404d73f91e6806f881f8dabeb30494f93f9e99b7/deployments/mainnet). The deployed ABI is pinned in `server/abis/fluid.ts`; current Solidity source has additional struct fields and must not be substituted without checking deployment compatibility.

## Validation

```sh
npm test
npm run build
npm run test:browser
```

Unit/API tests cover price boundaries, debt in the same asset, efficiency mode, block consistency, simulated Compound accrual, input validation, and isolated failures. Browser tests cover search, example labeling, errors, refreshed responses, and mobile layout using controlled API fixtures. Browser fixtures do not establish live protocol accuracy.

Fluid was also checked on Ethereum against live standard (T1), smart collateral (T2), and smart collateral/debt (T4) positions at blocks 26406819–26406833, plus a live fUSDC lending deposit at block 26406841. T3 behavior is covered by deterministic fixtures, not an active T3 wallet comparison. One live T2 position had an unsupported syrupUSDC dollar price; the reader correctly retained its balances and oracle health while marking its valuation incomplete. The two wallets in `TestCases` were also checked at blocks 26406856–26406857: the first returned one active T4 GHO/USDC position with a health estimate near 1.03; the second returned no directly held covered Fluid positions. These checks validate the data path and calculations, not exact liquidation execution at the boundary.

To repeat a live check for a wallet with known Fluid positions:

```sh
npm run check:fluid -- 0xYourEthereumWalletAddress
```

This reads the current block and prints the complete Fluid result. It exits unsuccessfully if any part is unknown or no positions are found; a zero-position lookup is not treated as a meaningful position check.

Browser tests use `/usr/bin/chromium` when present; otherwise run `npx playwright install chromium` first. Override `CHROMIUM_PATH` to use another installed executable.

## Privacy and operations

The application does not persist wallet searches, balances, or history. Hosting access logs and your Ethereum provider may record requests. Results use `Cache-Control: no-store`. The server never returns raw provider errors or provider URLs. Keep `.env` out of Git.

The cloud environment permits `ethereum-rpc.publicnode.com` and live Fluid reads were verified. Hosting elsewhere requires configuring its own `ETHEREUM_RPC_URL`. Environment publication and website deployment are separate operations.
