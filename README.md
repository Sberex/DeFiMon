# DeFiMon

A read-only Ethereum, Plasma, and Arbitrum wallet dashboard for current lending positions and liquidation risk. No wallet connection, transaction signing, database, or historical tracking.

## Current scope

This is an **early implementation with readers for six protocol families**. Coverage is limited to the versions and products below; it is not a complete wallet balance. Production build and deterministic tests run locally. Fluid and Aave v4 have been exercised against live Ethereum positions; Aave v3 and Compound still require live position comparisons before use for financial monitoring.

| Protocol | Implemented coverage | Limitations |
| --- | --- | --- |
| Aave v3 | Ethereum, Plasma, and Arbitrum main markets; deposits, debts, native health factor, oracle prices | Other deployments excluded. Per-asset liquidation prices withheld for efficiency mode. |
| Compound | v3 Ethereum USDC/WETH and Arbitrum USDC/USDC.e/USDT/WETH markets; base balances, collateral, liquidation factors | v2 and other v3 markets excluded. |
| Aave v4 | 14 Ethereum lending markets plus 37 tokenized-deposit contracts; deposits, premium-inclusive debt, native health factor, and collateral liquidation estimates | Official address-book snapshot, direct ownership only; linked accounts and treasury infrastructure excluded. New deployments require a roster update. |
| Morpho | Ethereum and Arbitrum Morpho Blue direct markets plus vault V1/V2 deposits and associated creator/curator/owner vaults, including zero deposits; accrued balances, debt, net value, oracle health, and liquidation estimates | Requires the public Morpho API for discovery/prices. Indexing lag can omit newly opened positions. Legacy Optimizers, linked accounts, and unclaimed rewards excluded. Full live discovery is not yet verified in this cloud environment. |
| Fluid | Ethereum, Plasma, and Arbitrum T1–T4 vaults and ordinary fToken lending deposits; balances, debt, health estimate and liquidation boundary | Direct ownership only. Standalone DEX/smart-lending deposits and linked smart accounts excluded. Smart vaults show oracle-ratio boundaries rather than a single underlying token’s dollar liquidation price. |
| Euler | V2 EVK vault deposits, isolated loans and enabled collateral in owned EVC subaccounts on Ethereum, Plasma and Arbitrum; rates, LLTV, native health, NPL and alternative markets | Legacy V1, Euler Earn aggregators, external smart-account ownership discovery and passive deposits in unenabled subaccounts are excluded. |

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

Enter your wallet address and select **Check wallet** to read **Ethereum, Plasma, and Arbitrum together**. Results are grouped by protocol, with networks ordered Ethereum, Plasma, then Arbitrum within each group. Ethereum checks all six protocol families, Plasma checks Aave v3, Fluid and Euler, and Arbitrum checks Aave v3, Morpho, Compound, Fluid and Euler. Each card labels its blockchain. No network selector is needed.

The summary totals add priced positions from all three networks. Collateral, health factors, and liquidation estimates remain independent for each position; collateral on one network never protects borrowing on another. Each network has its own displayed block and check time. Refresh updates all networks for the displayed wallet. If one provider fails, other networks remain visible and the failed network shows unknown balances. The illustrative example includes explicitly fictional positions on all three networks.

Plasma uses chain ID **9745** and native currency **XPL**. The public `https://rpc.plasma.to` endpoint is the default. To use your own provider, add `PLASMA_RPC_URL=https://your-provider` to your existing `.env` file (or your host’s environment variables). Keep your existing `ETHEREUM_RPC_URL` for Ethereum; do not replace the whole `.env` file. Restart the server after changing it. No wallet connection or signing key is required.

Both Plasma readers show current deposits, debt, net value, health, and applicable liquidation estimates with the same coverage limits as Ethereum. Aave efficiency mode retains its native health factor but withholds per-asset liquidation prices. Fluid covers T1–T4 vault NFTs and ordinary lending fTokens; smart vaults show a liquidation oracle ratio. Fluid uses Plasma’s Aave oracle for USD valuation, mapping native XPL to WXPL. For standard T1 borrowing positions, missing collateral USD prices can be estimated from Fluid’s liquidation ratio and an independently sourced debt-token USD price. These prices are labeled “Fluid oracle estimate,” the reader is marked partially checked, and supplied/net totals include the estimate. This is a protocol valuation, not a market-sale quote. The fallback does not assume stablecoin parity, replace available independent prices, or apply smart-pool share ratios to underlying assets. Without a valid ratio and a known debt-token price, quantities and oracle-based risk remain visible with unknown dollar values. Ethereum’s Chainlink registry is never queried on Plasma.

Deployment sources: [Aave Plasma address book](https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Plasma.sol) and [Fluid Plasma deployment artifacts](https://github.com/Instadapp/fluid-contracts-public/tree/404d73f91e6806f881f8dabeb30494f93f9e99b7/deployments/plasma). The used Fluid resolver interfaces were compared with the pinned Ethereum ABIs and match. A provider reporting another chain ID is rejected before reading protocols.

Run a live local check with a public wallet address:

```sh
npm run check:plasma -- 0xYourWalletAddress
```

The website requests `/api/portfolio/0xYourWalletAddress?chain=all`, which returns fourteen protocol/network readers in display order and a separate `networks` snapshot for each chain. A failed network has no block number and explicit error cards; it is not a verified empty wallet. Per-network API access remains available with `chain=ethereum`, `chain=plasma`, or `chain=arbitrum`; omitting `chain` continues to use Ethereum for compatibility. Health reports configuration presence, not successful blockchain access.

Validation: deterministic reader, network-routing, provider-selection, and browser checks cover Plasma. This cloud environment denied access to `rpc.plasma.to` (CONNECT 403), so a live Plasma wallet comparison is still required on a computer or host that can reach the provider. No cloud environment settings have been published by this change.

## Arbitrum support

Arbitrum One uses chain ID **42161** and native **ETH**. The default public connection is `https://arb1.arbitrum.io/rpc`; no extra key is required. Optionally add `ARBITRUM_RPC_URL=https://your-provider` to your existing `.env` or hosting settings, then restart the server. Keep the other network settings.

Arbitrum includes Aave v3 deposits/borrowing, Fluid T1–T4 vaults and ordinary fToken deposits, Morpho Blue direct markets and V1/V2 vault deposits, and Compound v3’s USDC, USDC.e, USDT, and WETH markets. These readers include USD valuation where prices are available, net value, current interest rates, and applicable liquidation risk with the same product limits as Ethereum. Morpho queries use chain 42161 and validate against Arbitrum’s own canonical core (`0x6c247b1F6182318877311737BaC0844bAa518F5e`), rather than Ethereum’s core. Fluid uses Arbitrum’s Aave oracle for available USD prices, including wrapped ETH for native ETH; its labeled collateral-price fallback follows the Plasma rules above. Missing prices remain unknown.

Wallet ETH and supported Arbitrum tokens appear after Ethereum and Plasma in **Wallet tokens**, contributing to Net value. Supported lending receipts are excluded to prevent double counting. Additional token contracts can be entered for Arbitrum too.

Deployment sources: [Aave Arbitrum address book](https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Arbitrum.sol), [Fluid Arbitrum artifacts](https://github.com/Instadapp/fluid-contracts-public/tree/404d73f91e6806f881f8dabeb30494f93f9e99b7/deployments/arbitrum), [Morpho SDK deployment addresses](https://github.com/morpho-org/sdks/blob/56f1ed62827a7aab39d979c0143d1fbf970c37ca/packages/morpho-ts/src/addresses.ts), and [Compound Arbitrum deployments](https://github.com/compound-finance/comet/tree/f766f51583c23acc33b2a7824654ef2029a96804/deployments/arbitrum). Used Fluid resolver ABI entries exactly match the pinned Ethereum interfaces.

```sh
npm run check:arbitrum -- 0xYourWalletAddress
npm run diagnose:morpho -- 0xYourWalletAddress arbitrum
```

Deterministic tests cover all four readers, selected-chain contracts, balances/rates/risk, receipt exclusions, wrong-chain rejection, partial failures, and the combined page. This cloud denied the public Arbitrum endpoint (CONNECT 403); live balances and full Morpho API discovery must still be compared locally with the protocol websites. No cloud environment settings were changed or published.

## Euler V2 EVK

The dashboard now checks **14 protocol/network readers**, including Euler on Ethereum, Plasma and Arbitrum. Euler contracts and selected ABIs are pinned to `euler-xyz/euler-interfaces@0ea27dcf23c31249857180a0753638c040c4df1b`. Core accounting was checked against `euler-vault-kit@93a1de491531e54cbbcf0e5c8cacfe558f924867` and the official EVK periphery lens/math references. No Euler API, subgraph key or new external host is required; reads use each configured network provider at the displayed block.

The registry scan checks direct deposits held by the entered address in up to 4,096 factory EVaults. When the entered address is the registered EVC owner, its 256 same-prefix subaccounts are checked for enabled controllers and collateral. If the address is a subaccount owned by another address, only that entered account is checked. Each account's loan is isolated; collateral never protects debt in another account. A main-account receipt included in a loan is not included again as a passive deposit. Registered Euler receipt tokens are excluded from wallet token totals even if Euler's position reader fails. Failed registry pages, balance reads or missing account checks leave complete coverage unknown and block a complete NPL.

Balances use `balanceOf` → `convertToAssets` and current rounded-up `debtOf` amounts. Borrow APR is the instantaneous per-second ray rate annualized without compounding; supply APR weights it by utilization and deducts the vault's interest fee. Current `LTVLiquidation` captures the vault's time-varying LTV ramp. Health uses `accountLiquidity(account, true)` from the debt controller. Dollar prices use the existing verified price readers; missing prices can use a labeled Euler oracle quote only when the controller explicitly uses Euler's USD unit of account (`0x...0348`, 18-decimal quotes). A missing route or feed stays unknown. Dollar liquidation scenarios are withheld when display-price collateral capacity differs by more than 5% from native oracle health, or a required factor is missing. Native health still determines the risk label.

Euler deposits and loans participate in Recommendations with the existing manual/automatic cross-network token matching. Alternative loans require the exact underlying pair and an accepted collateral receipt vault with a nonzero borrowing LTV. Current supply/borrow interest rates, live liquidation LTV, receipt route and borrowing liquidity are included. Available liquidity is vault cash bounded by the remaining borrow cap; Euler's compact 16-bit cap is decoded in raw asset units, with raw zero meaning unlimited and zero-mantissa/nonzero-exponent meaning a real zero cap. Custom borrow hooks and custom collateral deposit hooks are excluded from loan alternatives because eligibility cannot be verified without an execution context. External Merkl incentives are not guessed for Euler alternatives. All recommendations remain read-only rate comparisons.

This integration covers **EVK**, not legacy Euler V1 or Euler Earn strategy aggregators. Passive deposits in subaccounts without enabled collateral/controller, operator-linked smart wallets, and non-EVK collateral wrappers are outside the discovery/valuation scope. These exclusions are shown in the Euler card coverage. No history or transaction submission is required.

```sh
npm run check:euler -- 0x5929D94eb4C41D91955154465a58a531Ad4CF7b8 ethereum
npm run check:euler -- 0xWalletAddress arbitrum
npm run check:euler -- 0xWalletAddress plasma
```

The live Ethereum check at block **26422107** completed a registry/main-account scan for the test address and found no covered Euler positions. A live Ethereum market search at block **26422150** returned **109 alternatives**, including 13 accepted collateral/debt routes; individual read failures were reported as partial coverage. Subaccount loans, share conversion, rates, receipt exclusions, oracle failures, LLTV, NPL and market search are covered by deterministic tests on all three network configurations. Plasma and Arbitrum live RPC checks remain blocked by this cloud's existing network restrictions.

## Dashboard sections

Below the shared wallet search, the desktop layout has a left navigation column and a right content column. **Wallet Overview** is selected initially and contains the existing balances, NPL/APR totals, risk, protocols, wallet tokens and Merkl rewards. **Recommendations** shows current lending positions as `Supplied asset — Supply APR — Borrowed asset — Borrow APR`, with protocol, network and original loan labels. Personal Morpho V1/V2 vault deposits greater than zero appear as `Supplied asset — Supply APR`; managed vaults with zero personal deposits are omitted. Other one-sided lending positions show a dash for the absent side.

Fluid vaults with exactly the same two distinct token contracts supplied and borrowed (for example Plasma Vault 33 GHO/USDT0 against GHO/USDT0) are excluded from Recommendations, do not generate alternative-search requests, and are excluded as Fluid alternative candidates. Token order and capitalization do not affect this rule; token symbols alone are not used. Other Fluid positions remain eligible. Wallet Overview, balances, risk and NPL still include these vaults.

Rates reuse the same protocol, intrinsic and matched Merkl components as Wallet Overview. Unknown active rates stay unavailable. Multi-asset loans show asset combinations inside that loan; assets are never paired across unrelated positions, protocols or networks. Below each existing position, live alternative markets are ranked by lower Borrow APR or higher Supply APR as described below. Switching sections preserves overview scenario inputs and does not change totals; the first Recommendations visit for each wallet snapshot starts an independent market search. A new wallet search or refresh updates both sections from the same response. On smaller screens the menu moves above the content, with wide tables scrolling inside their cards.

## Alternative-market recommendations

Recommendations independently searches the supported market deployments for the same supplied/borrowed token pair. It lists strictly lower **Borrow APR**, ordered by Available Liquidity from highest to lowest, with unavailable liquidity last and lower Borrow APR breaking liquidity ties. The Best verified Borrow APR summary still identifies the cheapest verified rate, independently of row order. For Morpho vault deposits and other supply-only positions, it lists strictly higher **Supply APR** for the same deposited token, including other Morpho vaults and direct lending markets. Each alternative identifies its protocol, network, contract/market, snapshot block, rate difference in percentage points, LLTV for loans, and an app link. The current market is excluded; Aave v4 hub/reserve routes remain distinct. Multi-asset Fluid pools qualify only if all of their required supply and debt underlyings are present in the source position's token basket.

- Aave v3: current main-pool reserves on Ethereum, Plasma and Arbitrum, with active/frozen/paused, collateral, borrowing and isolation-eligibility checks. Quotes use standard variable borrow rates, not a guessed wallet-specific eMode or discount.
- Aave v4: the 14 supported Ethereum lending Spokes and 37 tokenized deposits. New single-collateral loan estimates include the reserve's risk premium; existing multi-collateral or stored premium shares can differ.
- Compound v3: the supported Ethereum USDC/WETH and Arbitrum USDC/USDC.e/USDT/WETH deployments. Only the base token can be borrowed; configured collateral, supply caps and supply/withdraw pause flags are checked. Collateral protocol supply APR is zero.
- Morpho: Ethereum and Arbitrum Blue markets, vault V1 and vault V2, discovered by token address with bounded pagination and then checked using the actual core/factory/underlying contracts. Instant IRM and allocation-weighted, fee-adjusted vault rates reuse the existing on-chain rate readers. Morpho Plasma is unsupported.
- Euler: V2 EVK vaults and accepted collateral/debt pairs on Ethereum, Plasma and Arbitrum; receipt routes, current fee-adjusted interest and capped borrowing liquidity.
- Fluid: T1–T4 vaults and ordinary fToken deposits across the three supported networks, using the published resolver registry and existing per-token rate readers. Smart-pool rates exclude trading income and retain their full required asset basket.

Loan alternatives show **Available Liquidity** immediately after Borrow APR, in units of the destination market's debt token (for example GHO or USDT0). It is independent of the wallet's personal collateral capacity. Each amount uses the same network block as its rate quote. Aave v3 uses reserve cash capped by virtual liquidity and remaining borrow-cap headroom; minting GHO reserves instead use remaining facilitator capacity. Aave v4 uses Hub liquidity capped by the specific Spoke's remaining draw capacity, including owed debt and deficit. Compound uses the Comet's base-token cash. Fluid T1/T2 uses resolver-reported underlying borrowable capacity; smart-debt T3/T4 converts proportional shares into both debt tokens and limits them by vault/pool caps, per-token liquidity and utilization headroom. Smart-debt values are explicitly estimates requiring the paired token. Morpho shows **Total liquidity**: accrued total supplied loan assets minus accrued total borrowed loan assets, not collateral TVL or total supplied deposits. Verified zero is displayed as zero; unreadable amounts/decimals remain **Unavailable** and do not remove an otherwise verified rate recommendation. No dollar peg or balance approximation is used to invent liquidity.

Token matching uses exact contract addresses on the same network and the manually editable [config/token-matches.json](config/token-matches.json) across networks. It contains the user's manually maintained token groups. Ethereum USDT, Plasma USDT0 and Arbitrum USDT are explicitly matched in the USDT group. USDC.e is not mapped to native USDC. Only networks explicitly listed in a manual group are matched for that group; omitted entries remain omitted. Unlisted source contracts are automatically looked up through CoinGecko and, when its server key is configured, CoinMarketCap. Discovery verifies the original network/contract and reads other platform addresses from the same asset record; both assets of a pair still need a verified match on the destination network. If lookup fails, the original-network search remains available. Similar API tickers and wallet-token-catalog symbols are never used as identity proof. Manual groups always win, including omitted networks. Automatic links into existing manual groups or conflicting provider identities are excluded. Recommendations shows provider links and matched contracts under Token matching. Automatic groups are cached only in memory and never written into the JSON file. See [config/README.md](config/README.md) for how to add groups and restart the server; JSON edits do not require a build. Invalid addresses, unsupported network names and duplicate network/address identities are rejected at startup. Native Fluid ETH is normalized to its wrapped equivalent, so wrapping or bridging may be required.

Current rates retain the wallet's matched Merkl incentives. Candidate rates include protocol fees/streaming adjustments and the same verified intrinsic token yield, but exclude unverified external Merkl campaigns. This conservatively compares a candidate borrowing rate against the wallet's effective net borrowing cost, rather than promising rewards for a position the wallet has not entered. Comparisons do not alter NPL, balances, or risk. Rate snapshots do not guarantee capacity for the full existing loan/deposit, account access, caps, bridge availability or migration costs; those details are stated with each candidate. Empty/unreadable rates are not treated as zero, and no-better-result messages refer only to verified search results.

`POST /api/recommendations` accepts only bounded token/network targets, not a provider URL or wallet credentials. Searches run separately from wallet monitoring with two concurrent searches per server; each source has independent failure/coverage reporting. Up to 40 asset combinations, 500 Morpho records per query family, and bounded RPC worker time are checked. Partial or failed sources remain labeled and do not block verified alternatives or wallet totals. Responses are not stored as wallet history. Automatic discovery uses at most twenty unlisted source contracts per request, two workers, eight-second HTTP timeouts, a twenty-second scheduling budget, one-hour success caches and one-minute failure retries. CoinGecko platform IDs are resolved from chain IDs 1/42161/9745. CoinMarketCap uses the official `/v2/cryptocurrency/info?address=` endpoint with `COINMARKETCAP_API_KEY`; CoinGecko Demo/Pro keys are optional settings documented in [config/README.md](config/README.md). Provider access/quota errors are reported without sending keys to the browser. This cloud blocked the new public lookup during verification, so live discovery must also be checked from a host with API access; deterministic and browser tests cover successful and failing sources. The browser reuses a completed search when switching sections and provides **Refresh alternative rates** for a new snapshot.

A public local diagnostic is available with `npm run check:recommendations`. A live Ethereum check at block **26420663** found wstETH/GHO Aave v4 BLUECHIP around **3.6644%** and MAIN around **3.9521%**, compared with Aave v3's **4.50%** standard rate, plus USDC deposit quotes. These are verification snapshots, never hardcoded recommendations. Cloud access to Morpho and Plasma/Arbitrum providers remains blocked; deterministic and browser tests cover those branches, and live checks there must run from a host with the corresponding access.

## Morpho vault deposits and associated vaults

Morpho V1/V2 vault deposits are checked on **Ethereum and Arbitrum**, using the selected network’s contracts and block. In addition to the depositor lookups, the dashboard finds vaults associated with the searched address even if its vault share balance is zero or the entire vault has no deposits:

- V1 vaults: indexed **creator**, current **curator**, and current **owner** address filters.
- V2 vaults: current **curator** and **owner** address filters. The API does not expose V2 creator-address/history search. A V2 vault created by this address is found while that address remains its owner/curator or has a deposit; creation-only associations after all roles are transferred cannot be discovered through these endpoints. Owner is labeled Owner, rather than being relabeled Creator.

These role fields and filters were confirmed by public API introspection supplied from the user’s computer. Role queries use `vaults` / `vaultV2s` and their exact address/chain filters, without a minimum deposit, total-assets or listed-status filter. Every connection is paginated (100 rows per page, up to 20 pages per role). Failures, duplicate rows, changing pagination and malformed/wrong-wallet/wrong-chain records produce incomplete-coverage messages rather than a verified empty list. A later page failure retains earlier validated rows. Depositor and role results are merged by vault contract on the selected network, combining roles and checking version/factory/underlying identity so the same vault is counted once.

Vault registration and underlying assets are rechecked on-chain. V1 must point to the selected chain’s canonical Morpho core. Current owner/curator roles are read from the vault at the displayed block; stale roles that no longer match are removed. When a role getter is unavailable, the indexed role remains explicitly labeled **API record**, with partial coverage. Historical V1 Creator attribution is an API creation record and is labeled accordingly. Failed balance/factory/accounting checks remain unknown, never a fabricated zero.

Every displayed vault includes its contract, relevant roles, and **Vault assets · all depositors**. These assets are context only. Personal Supplied/Net value/NPL/APR use only the wallet’s current shares converted to underlying assets; managing a $1 million vault with zero personal shares does not add $1 million to the wallet. V2 share balances and assets are read together after simulated accrual, including fee-share minting; no transaction is sent. A zero-share associated vault shows $0 personal supply and no borrowing. An unfunded vault’s lending APR remains unavailable rather than being invented. Ordinary zero-share vaults with no associated role remain omitted. Discovered vault shares continue to be excluded from wallet-token totals to avoid double counting.

**Plasma is marked unsupported for Morpho discovery.** The user’s live public API check returned `unsupported chainId "9745"` for vault/market queries. This is a Morpho indexing restriction, not the cloud’s outbound limit, and does not prove that no related contracts exist on Plasma. No Ethereum core/factory address is reused there and no empty Plasma Morpho balance is asserted. As requested, existing Plasma Aave/Fluid coverage and the protocol totals remain unchanged; the page displays the Morpho discovery limitation separately.

`npm run diagnose:morpho -- 0xYourWalletAddress ethereum` (or `arbitrum`) now checks both holdings and the five supported role lookups and reports associated vault contracts/versions/roles. This cloud still blocks `api.morpho.org`; deterministic parser/reader/API/browser checks validate the change, while complete live discovery must be compared on a computer that can reach Morpho. New or unindexed vaults may take time to appear. Organization/linked-smart-account relationships are not inferred from branding or curator names. No wallet history or additional key is required.

## Collateral LLTV and liquidation scenarios

Every protocol asset table includes **LLTV**: the percentage of collateral value counted toward the liquidation boundary, rather than the maximum initial borrowing limit. Aave v3 uses its liquidation threshold; Compound uses `liquidateCollateralFactor`; Morpho uses the market LLTV; Fluid uses the vault liquidation threshold; Aave v4 uses the wallet’s stored collateral settings. Aave v4 combines same-token reserves using the effective balance-weighted factor, excluding disabled collateral, and labels it accordingly. Morpho displays actual market LLTV even when lent and pledged balances of the same token are merged. Deposits that are not pledged show a dash. Unverified effective LLTV shows **Unavailable**, never a guessed percentage. Modern Aave v3 efficiency-mode LLTV is read from category settings and verified reserve bitmap membership; older/incompatible deployments remain unknown. Efficiency-mode token liquidation estimates continue to be withheld.

For a loan with two or more supplied collateral assets, the table calculates a liquidation price for **only the largest holding by current supplied USD value**. Enter a non-negative USD liquidation price for each other collateral token in its row, then press **Calculate**. For three assets the calculation is:

```text
price_1 = (borrowed_USD - price_2 × LLTV_2 × supplied_2
                        - price_3 × LLTV_3 × supplied_3)
          / (LLTV_1 × supplied_1)
```

Percentages are converted to fractions (80% = 0.8). The same sum extends to any number of collateral assets within that loan. Borrowed USD, supplied quantities, and effective factors stay fixed, including any debt denominated in a collateral token. This is a scenario based on your entered prices; it does not predict that the tokens will reach those prices together or change the current health factor, balances, or net value. A single-collateral loan retains its existing estimate, including its existing same-token debt treatment.

All other collateral prices must be entered before a result is calculated. Editing a price clears the previous result; refreshing or loading another wallet clears all inputs and results. Zero is allowed. If the other collateral alone exceeds the fixed borrowed USD amount, the result explains that there is no non-negative price boundary rather than displaying a negative token price. Missing debt valuation, collateral prices needed for ranking, or effective LLTV prevents calculation. Independent loans, networks, and protocol positions are never combined for liquidation calculations. Manual prices stay in the open page and are not sent to a server or saved.

Fluid smart collateral/debt uses pool-share oracle rules. Its collateral rows display the vault LLTV, but independent token-price calculations remain unavailable; the existing oracle-ratio boundary is retained. Missing or unsupported liquidation rules are identified explicitly.

## Current interest rates

Every supplied/borrowed asset row has **Supply APR** and **Borrow APR**. APR is the current interest rate expressed per year, without assuming compounding. Protocol rates refresh with the wallet and use the same selected network block as its balances. sUSDai additionally shows a separately labeled past-month intrinsic estimate from an Ethereum oracle, with its own reference block and observation dates (see below). These are current quotes, not past-day averages or a promise of future returns. The example’s rates are fictional.

A dash means that the wallet has no balance on that side. **Unavailable** means a current rate could not be verified; balances and liquidation risk remain visible. A genuine zero-interest rate shows **0.00%**. **≈** marks an estimate or an incomplete income component; open **Rate details / Estimate details** beside the rate for its scope. Negative supply APR means a charge; negative borrow APR means a net incentive within the quoted components. Cash wallet balances have no lending APR merely because they are held.

- **Aave v3, Ethereum, Plasma, and Arbitrum:** current liquidity APR and the wallet’s balance-weighted variable/stable borrowing APR. Annual ray rates are divided by 1e27. Stable borrowing uses the wallet’s own stable rate; the reserve supplies the variable rate. Reward-token incentives are excluded.
- **Aave v4:** current Hub drawn-rate quotes, accrued drawn index, added assets, premium shares, liquidity fee, and virtual assets determine supply interest. Borrowing APR includes the wallet’s stored premium-share exposure on total debt. The same underlying across reserves is weighted separately by supply and borrow balances; a missing active component keeps the aggregate rate unknown. Tokenized deposits use the same Hub supply APR. Reinvestment income and external reward tokens are excluded; swept capital and effective debt quotes are labeled estimates.
- **Compound v3:** base-token rates use utilization read after simulated current-block accrual. Rates per second are annualized over 365 days. Collateral assets earn zero protocol supply interest; their intrinsic yield and COMP incentives are separate.
- **Fluid, Ethereum, Plasma, and Arbitrum:** ordinary vault legs use signed `supplyRateVault` / `borrowRateVault` after vault adjustments (100 = 1%). Smart legs combine each underlying token’s interest-bearing Liquidity rate with the signed vault adjustment. Their trading income cannot be calculated from an instant snapshot, so the displayed interest component is labeled an estimate. Lending fTokens use modern total-holder APR where supported, otherwise the exact legacy resolver layout with separately converted bonus units (1e12 = 1% for the legacy streaming model). An incompatible layout is rejected rather than misread.
- **Morpho Blue:** the IRM is queried in the same read-only simulation as accrual, using the resulting market state, so adaptive model state is current and a past accrual interval’s average is not substituted. The per-second borrow rate is annualized; supply APR includes utilization and the market fee. Unlent collateral earns no protocol interest. Same-token lent/collateral quantities are weighted correctly. Incentives and intrinsic token yield are separate.
- **Morpho vaults:** V1 estimates weight current market lending APRs and idle cash and subtract the performance fee. V2 estimates support direct-market adapters and V1-vault adapters, with current allocation checks, the distribution cap, and enabled performance/management fees. An unsupported funded adapter or an unreadable allocation makes the rate unavailable. No historical APY is substituted. Independently matched Merkl incentives are shown as a separate component rather than changing the protocol quote.

Rate checks have deterministic coverage for units, weights, fees, adaptive-state simulation, true zero, negative adjustments, and missing data. Live Ethereum checks at block 26408160 read Fluid smart-leg rates, a Morpho market’s current rates, a V1 vault allocation estimate, and an interest-free Aave v4 Hub. Plasma and Arbitrum remain blocked by this cloud’s network policy; local live comparison is still needed. Rate reading needs no new API key or outbound destination beyond the existing network providers.

## Monthly interest and NPL

Every supplied/borrowed asset row shows **Monthly interest earned** and **Monthly interest paid**, in token units and in USD where a price is known. Calculations use full-precision values before display rounding:

```text
monthly earned tokens = supplied tokens × supply APR / 12
monthly paid tokens   = borrowed tokens × borrow APR / 12
monthly USD amount    = monthly token amount × current USD price
monthly NPL           = total monthly interest earned USD − total monthly interest paid USD
```

APR values are fractions (6% = 0.06). Monthly calculations use the same effective APRs displayed in the asset row: supply APR includes intrinsic yield and verified Merkl incentives once, while borrow APR subtracts verified Merkl rebates. Supply and borrow rates can be signed: a negative earned amount is a supply charge; a negative paid amount is a borrowing incentive/credit. Zero-interest collateral earns zero protocol interest.

Each non-Fluid protocol/network card shows its combined **Net value**, followed by **Monthly NPL** and the earned/paid USD breakdown, summing every checked position in that card. Fluid shows NPL separately inside each vault position; ordinary fToken lending deposits each have their own NPL too, with no Fluid-wide NPL displayed. The fourth portfolio summary card, **Total NPL**, replaces the former Lowest health factor card and sums all protocol/network positions, counting each Fluid vault and lending deposit once. It includes sUSDai intrinsic yield where available and excludes ordinary wallet tokens. A failed protocol reader or unknown active interest component makes the complete total unavailable; partial coverage is labeled when only checked positions can be included. The summary cards appear after loading a wallet or the illustrative example. Health factors remain visible for individual positions. Networks and unrelated protocols remain independent. NPL means the projected net monthly interest result; it does not include token-price gains/losses, gas, liquidation charges, or other unlisted fees/rewards, and it does not change current Net value or health.

Morpho V1/V2 vault deposit cards use a supply-only table: **Asset**, **Supplied**, **Supply APR**, **Current price**, and **Monthly interest earned**. Vault cards omit Borrowed and Net value; direct Morpho borrowing-market cards retain their lending and risk fields. Monthly token interest is `own supplied tokens × combined Supply APR ÷ 12`; its USD equivalent uses the current token price and enters Total NPL exactly once through the existing protocol total. The combined rate includes verified intrinsic yield and matched Merkl supply incentives. Creator/owner/curator roles do not turn vault-wide assets into personal deposits or earnings. A zero personal deposit contributes zero, even if its APR or price is unknown; an active deposit with a missing rate or required price remains unavailable.

Personal balance discovery and vault-management discovery are tracked separately for Morpho. If all three personal lookups (markets, V1 deposits and V2 deposits) finish without coverage warnings, failed creator/curator/owner listing queries do not invalidate those personal balances or block NPL. Management-query failures remain visible on the Morpho card. An incomplete personal lookup still blocks NPL, even if management queries succeed; unreadable individual positions, active rates and required prices also remain blockers. This covers the reported Arbitrum response where six lookups succeed, all personal holdings are empty, and only the two V2 role queries are rejected. Those empty personal holdings contribute zero, while V2 role coverage remains unknown.

When Total NPL is unavailable, a **Missing interest data** explanation below the overview lists the affected protocol, network, position and token, distinguishing missing Supply/Borrow APR, intrinsic yield, USD prices and unreadable protocol lookups. Portfolio APR depends on Total NPL and therefore remains unavailable too. A known balance or Net value does not imply that all interest inputs are known. Missing costs are never silently excluded or set to zero.

To diagnose the same wallet on the computer hosting the app, run:

```sh
npm run diagnose:npl -- 0x5929D94eb4C41D91955154465a58a531Ad4CF7b8
```

This checks native lending interest and intrinsic yield across the configured networks, prints the missing inputs, and excludes Merkl incentives. It does not print provider URLs, keys or `.env` contents. Cloud network restrictions can differ from those on the host computer; a cloud lookup cannot establish which source failed locally. The page's explanation uses its currently displayed data, including any applied Merkl APR.

A fifth overview card, **Portfolio APR**, appears directly after Total NPL. It uses `Total monthly NPL × 12 ÷ displayed Net value`, expressed as a percentage. The denominator includes the same priced wallet tokens, supplied assets and debt as the Net value card; it is not limited to lending equity. It includes Merkl and intrinsic yield through Total NPL once, uses unrounded values, and follows the same zero/unknown/nonfinite and signed-negative-value rules as position APR. Partial coverage is labeled. For the supplied example, $1,054.76 monthly NPL and $280,096.14 Net value produce approximately **4.52%** annually.

Each position’s summary shows **APR** between Net value and Health factor, calculated as `Monthly NPL × 12 ÷ Net value` and displayed as a percentage. Protocol totals use their combined monthly NPL and net value; Fluid vaults and lending deposits use only their own amounts. The calculation includes any intrinsic yield and matched Merkl incentives already included in NPL. Zero or unknown net value, unknown NPL, and nonfinite results show **Unavailable**. Negative net value follows the signed formula and is explicitly labeled, rather than presented as a return on positive capital. This figure is an annualized NPL estimate, separate from an individual asset’s Supply/Borrow APR, and does not change balances or risk.

These are estimates for one-twelfth of a year, assuming unchanged balances, APRs and USD prices, without compounding. They refresh with the displayed wallet. The sUSDai intrinsic component retains its past-month observation basis rather than becoming a guaranteed next-month rate. Missing active rates or required USD prices make the affected totals and NPL **Unavailable**; token interest can still be shown when only its USD price is missing. Zero balances require no rate or price to contribute zero. Explicit unreadable positions prevent a complete total; partial coverage is labeled and any displayed subtotal covers checked positions only. All calculations happen in the page using the existing response, without additional network requests or history storage.

## sUSDai intrinsic yield

Supplied **sUSDai** includes a separately labeled **Intrinsic (30d)** APR across all protocol families on Ethereum, Plasma, and Arbitrum. Matching uses the deployed token contract `0x0B2b2B2076d95dda7817e785989fE353fe955ef9`, not a token symbol. Other assets and borrow APR remain unchanged.

The source is Ethereum’s [sUSDai/USDai exchange-rate feed](https://etherscan.io/address/0x0fBE44B96320EBD455FF9CCE0781fA9A83Ddee7a#readContract). Its address is the raw rate source in [Fluid’s pinned Ethereum CappedRateChainlink_SUSDAI deployment](https://github.com/Instadapp/fluid-contracts-public/blob/404d73f91e6806f881f8dabeb30494f93f9e99b7/deployments/mainnet/CappedRateChainlink_SUSDAI.json). The reader verifies Ethereum chain ID, feed description and decimals, and valid positive oracle rounds. It never uses the capped oracle’s maximum permitted APR as earned interest.

```text
intrinsic_APR = (end_exchange_rate / start_exchange_rate - 1)
                × seconds_in_365_days / elapsed_seconds
```

“Last month” means a trailing **30-day lookback**, not the previous calendar month. The reader selects the last oracle observation at or before 30 days ago and the latest available observation, annualizing their actual elapsed time. Oracle updates are discrete: the current reading and the old boundary may each lag by up to three days, and accepted observation windows must span 27–33 days. Details show the actual observation dates, source, and Ethereum reference block. The feed’s existing round records are queried at one current block, including previous aggregator phases when necessary; no archive-node subscription, USD.ai API access, wallet history collection, or database is required. Missing/gapped rounds, stale prices, incompatible feeds, or failed provider reads produce **Unavailable**, never an invented zero. No new domain or key is required beyond the configured Ethereum provider.

The supply cell shows **Estimated total APR**, consisting of current protocol lending APR plus this annualized past-month intrinsic return and any separately matched Merkl incentive APR. This is an approximate combination of different observation periods, not a current combined quote, compounded APY, or USD.ai’s advertised dashboard APY. Share-rate performance can include losses and differs from the USD market price or bridge premium. If the protocol or intrinsic component is unknown, the combined supply APR stays unavailable while verified components remain visible. Unverified Merkl incentives are excluded with a notice as described below. Balances, net value, borrowing rates, health and liquidation prices are not changed by the yield estimate.

The oracle quote is shared across protocol/network lookups and cached for five minutes; unavailable quotes retry after one minute. No wallet address is sent to the oracle. Live verification at Ethereum block **26414491** found sUSDai/USDai rates of about **1.11884234** and **1.12579575** over **30.008 days**, yielding an estimated intrinsic APR of **7.5594%**. This is a verification snapshot, not a hardcoded rate.

To repeat the public check on your host:

```sh
npm run check:susdai-apr
```

## Wallet token balances

The **Wallet tokens** section shows Ethereum first, then Plasma, then Arbitrum. It includes native **ETH** on Ethereum/Arbitrum and **XPL** on Plasma, the supported ERC-20 token list, and any additional token contracts you enter. Ethereum’s default list includes USDe, USDT, USDC, EUL, COMP, and the user-selected **WFRAX** at `0x04acaf8d2865c0714f79da09645c13fd2888977f`. WFRAX’s symbol and 18 decimals were checked on Ethereum and its address matches Frax’s official deployment list. Other symbols are read from their actual token contracts rather than guessed from names.

**Net value = priced wallet tokens + priced lending deposits − borrowing.** The Total supplied and Total borrowed cards still describe lending positions; ordinary wallet holdings appear in the wallet section. These holdings do not change a borrowing position’s health factor or liquidation rules.

The scanner checks a pinned list of common Ethereum tokens (Uniswap’s default list plus Aave underlyings and WFRAX) plus common Arbitrum tokens from the same pinned Uniswap list, and Plasma/Arbitrum assets from the official Aave/Fluid deployments. It is **not** an indexer that can discover every token ever sent to a wallet. Only nonzero ERC-20 balances are listed; native currency is always shown. To check another token, open **Add another token**, choose its network, paste its contract address, and select **Add token**. Up to 20 additional contracts are allowed per search. Adding/removing a token refreshes the currently displayed wallet; Refresh retains the added contracts. This list stays only in the open page and clears on a page reload.

Balances and token decimals use the same per-network block as lending positions. Prices first use the selected network’s Aave oracle, then Ethereum’s Chainlink registry where available. A public DefiLlama Coins API lookup supplies remaining prices without an API key. That optional service needs outbound HTTPS access to **`coins.llama.fi`**; it receives network/token addresses, not the searched wallet or provider credentials. Quotes must have matching token decimals, confidence of at least 0.9, and a timestamp within the last hour (with at most five minutes of future clock tolerance). USD prices may update at a different time than the displayed block. No stablecoin is assumed to equal $1.

If a balance, price, or token metadata cannot be read, it stays unknown and warnings identify incomplete coverage. Net value includes only known priced amounts. Lending receipt tokens represented by the supported protocol readers (Aave v3 aTokens, Aave v4 tokenized deposits, Compound v3 receipts, Fluid fTokens, and discovered Morpho vault shares) are excluded from wallet totals. If the receipt-token checks fail, ERC-20 values are excluded from the total until they can be checked; native currency remains independent.

Token-list provenance is recorded in `server/deployments/wallet-tokens.ts`, with Uniswap’s upstream GPL-3.0 license included alongside it. Live Ethereum validation read native ETH and ERC-20 balances and valued ETH, USDe, and COMP using on-chain prices. This cloud still blocks Plasma, Arbitrum, and the external fallback price service, so their live paths require validation on a host that can reach those services.

A standalone balance diagnostic is available:

```sh
npm run check:wallet -- 0xYourWalletAddress ethereum
npm run check:wallet -- 0xYourWalletAddress plasma
npm run check:wallet -- 0xYourWalletAddress arbitrum
```

The API accepts extra contracts as `tokens=ethereum:0xTokenAddress,plasma:0xTokenAddress,arbitrum:0xTokenAddress` alongside `chain=all` (or a per-network request). Contract inputs are validated and deduplicated; no provider URL can be supplied through this parameter.

## Merkl rewards

The **Merkl rewards** section shows the searched wallet’s **unclaimed** and **pending** token rewards, grouped Ethereum, Plasma, then Arbitrum. Accumulated reward balances stay separate from Net value, health and collateral. Live reward APR is handled separately: verified matching opportunities increase Supply APR or reduce effective Borrow APR, and the adjusted rates flow into monthly interest and NPL. Already-claimed rewards are excluded because those tokens may already be represented in wallet balances. Ordinary token rewards from any Merkl campaign on these three networks are included; they are not restricted to the lending protocols above. Campaign-level attribution uses verified network, protocol, contract and lending-side identities; it is never inferred from token symbols or campaign names. Points, pre-token allocations, test rewards, unsupported networks, linked accounts and smart-account ownership discovery are excluded.

The server uses Merkl’s public `GET https://api.merkl.xyz/v4/users/{address}/rewards/summary` endpoint. The response follows the published `@merkl/api` **1.20.21** `UserController` / `UserRewardsSummaryResourceDto` declarations ([package](https://www.npmjs.com/package/@merkl/api/v/1.20.21)); the SDK itself is not installed as a runtime dependency. The complete per-wallet summary is filtered locally to the three supported networks, avoiding incomplete campaign breakdown pagination. Quantities use raw cumulative token amounts: `unclaimed = max(amount − claimed, 0)`, with `pending` displayed separately. Token decimals, contracts, chain IDs and unsigned integer amounts are validated; duplicate token/network records make complete totals unknown. The application does not use the API’s aggregate USD totals to infer missing token data.

### Merkl APR adjustments

The same rewards lookup independently reads `GET /v4/users/{address}/rewards/active-opportunities`, then fetches `GET /v4/opportunities/{id}?campaigns=true` for supported campaign rules. APR values returned in percentage points are divided by 100 (1.75 becomes 0.0175). The opportunity’s current `apr` is used, not its `maxApr`, historical earnings, native protocol APR, or a campaign’s target/capped distribution setting. Only live opportunities with a currently active token-reward campaign and verifiable eligibility are applied. Historical unclaimed balances are never added to projected monthly income.

Currently supported matching:

- **Fluid `FLUIDVAULT_COLLATERAL` and `FLUIDVAULT_BORROW`:** require the actual resolver-reported vault contract, network, action and underlying token set to match the checked vault position. Supply rewards increase the supply APR; borrow rewards reduce effective borrowing APR. Each smart-pool underlying receives the side’s APR so total annual rewards equal that side’s USD value × APR. It does not duplicate one pool-side reward on each underlying’s full pool value. Multiple NFTs in the same vault receive the rate on their own balances; another vault, network or fToken deposit does not inherit it.
- **Aave v4 `AAVE_V4_HUB_NET_BORROWING`:** fetch current campaign hub, borrow-asset and supply-asset IDs and underlying contracts. On-chain hub/asset exposures are retained across merged reserves and tokenized deposits. Eligible stablecoin supplies across checked spokes are deducted from eligible borrowing. The net reward value is allocated proportionally across matching debt, giving an effective rebate of `listed APR × max(0, eligible borrowed USD − eligible supplied USD) / eligible borrowed USD`, further weighted when only part of a merged token balance qualifies. Thus 1.75% on a $10,000 loan with $4,000 of qualifying supplies gives a 1.05% effective rebate on gross debt. Incomplete Aave coverage, missing qualifying prices, mismatched identities or unreconciled exposures prevent automatic adjustment. Current balances approximate the campaign’s time-weighted score; the result is explicitly an estimate.

Campaign times, computation chain, opportunity identity, token reward type, whitelist/blacklist rules, and conflicting active eligibility sets are checked. Custom score/subtype methods, hooks, forwarded-account conditions, private/overridden campaigns, unknown campaign types, unsupported reward types and ambiguous or duplicate identities are not guessed. Those opportunities remain listed with **Not applied** and an explanation. Discovery is bounded to twelve supported opportunity-rule lookups per wallet, with three concurrent detail requests. Newly opened positions may be absent until Merkl indexes earnings; the user-opportunity endpoint is not a complete list of every campaign a fresh position could qualify for.

Asset rows retain **Protocol**, **Intrinsic (30d)** where applicable, and **Merkl** components and their details. Borrow APR can become negative when the estimated rebate exceeds base interest. Merkl pays rewards separately: the lender still charges protocol interest, and monthly net token amounts are value-equivalents rather than the actual reward-token payout. The displayed NPL assumes unchanged rates, balances and prices; future caps, campaign expiry, qualification and time-weighting can change earnings. Market prices, collateral liquidation rules, health and current Net value are unchanged.

APR lookups can fail independently of reward balances. While loading or unavailable, verified protocol rates remain visible and a notice explains that NPL excludes unverified Merkl incentives. Supported opportunities are applied only to the wallet that was searched, and repeated responses never compound the same APR. User-provided public Merkl outputs confirmed the three example types and identifiers (Aave’s hub net-borrowing campaign and separate Fluid supply/borrow opportunities on Plasma); deterministic and browser fixtures cover their matching and financial calculations. Full live end-to-end verification is still blocked by this cloud’s Merkl network restriction.

USD values use positive numeric Merkl token quotes only when the token is marked verified by Merkl and the quote timestamp is within one hour (allowing five minutes of future clock tolerance). Merkl’s verified flag is a token metadata flag, not an investment-safety assessment. Missing/stale prices keep USD values unknown while preserving token quantities. Fully claimed zero-balance rewards are omitted. A successful empty report means no unclaimed/pending token rewards were reported; connection errors, throttling, malformed responses or unsupported schemas mean **unknown**, never a verified empty wallet. Recent claims and earnings can lag Merkl indexing. An indicated dispute window is shown, and “unclaimed” is not a guarantee that every published reward is immediately claimable. Claiming is handled on Merkl’s own website; this dashboard never connects a wallet or signs a claim.

Reward balances and APR opportunities load through `/api/rewards/0xYourWalletAddress` independently of lending and wallet balance lookups. Wallet searches and Refresh update both; stale/canceled responses cannot replace a newer wallet or the synthetic example. A Merkl outage does not hide lending positions, and a lending-provider outage does not discard successfully read rewards. No wallet searches, rewards history, Merkle proofs or signing keys are stored. The server sends the public wallet address to Merkl, but never provider credentials. The illustrative example contains explicitly fictional reward amounts and prices.

Hosting needs outbound HTTPS access to **`api.merkl.xyz`**; no API key, new environment variable, or browser CORS configuration is required. This cloud currently rejects that domain (CONNECT 403), so **full live Merkl discovery remains unverified here**. The implementation is checked against the published API schema and controlled parser/API/browser fixtures; no cloud environment settings were changed or published. On a computer/host that can reach Merkl, compare the results with Merkl’s website using:

```sh
npm run check:merkl -- 0xYourWalletAddress
```

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
- Morpho uses the public `https://api.morpho.org/graphql` API only for Ethereum/Arbitrum market/vault discovery and indicative USD prices. Market and V1-vault results are paginated; V2 holdings come from `userByAddress(address, chainId: 1)` (42161 on Arbitrum) and its unpaginated `vaultV2Positions` list. A missing user entity is reported as unknown coverage. Failed queries, incomplete pages, duplicate rows, and malformed/wrong-wallet/wrong-chain records are explicit warnings, not a verified empty wallet. No API key is required. Newly created/changed positions may be missing until indexed.
- Morpho identities and token decimals are rechecked on the selected network. Market parameters are loaded from canonical Morpho Blue (Ethereum `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, Arbitrum `0x6c247b1F6182318877311737BaC0844bAa518F5e`) and hashed back to the market ID. A vault must be recognized by the factory reported by the official API; V1 vaults must also point to this canonical core. This verifies data identities, not investment safety or curator quality.
- One read-only multicall simulates Morpho market `accrueInterest` before reading market totals and user shares. Supply conversion rounds down; borrowing rounds up, using 1 virtual asset and 1,000,000 virtual shares. Collateral is counted separately from loan-token supply. Loan supply does **not** protect a borrowing position, even within the same market.
- Morpho oracle prices use **1e36** raw-unit scaling. Health matches the protocol’s two floor divisions: `floor(floor(collateral × oraclePrice / 1e36) × LLTV / 1e18) / rounded-up debt`. A reverting oracle gives unknown risk; a successfully read zero price gives zero collateral capacity, as in the protocol. Currency conversion accounts for both tokens’ decimals.
- Morpho vault shares are valued once, without adding their underlying market allocations again. V1 uses the current ERC-4626 conversion. V2 simulates accrual, then reads the user balance, total shares, stored assets, and virtual shares together so fee-share minting and current interest are included. Vault-only holdings have no wallet borrowing liquidation price.
- Morpho USD prices are indicative API prices and may update at a different time than the pinned network block. They never determine health. Missing prices stay unknown; a token is never assumed to be worth $1. A liquidation USD estimate assumes the loan-token price and both balances stay fixed. The collateral/loan oracle ratio is also shown independently of USD valuation.
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

This tests the same public API queries and proxy settings as the website, without using the blockchain provider. It reports connection/timeouts, HTTP status, query compatibility, or unexpected responses separately. It does not print provider credentials, proxy credentials, or `.env` contents. The public wallet address is sent to Morpho. A successful test checks discovery only; blockchain reads must still succeed. The website also distinguishes these failure categories. Older versions displayed one generic message for all of them. Compatibility retries now handle explicit unknown-field errors returned with HTTP 400/422 as well as HTTP 200.

For an endpoint exposing the newer `Asset.price` field, `npm run diagnose:morpho -- --schema` reports that field’s return type and available child fields, without sending a wallet address. The current integration reads the verified nested `usd` value for display; its `timestamp` describes the API price, which may differ from the pinned network block. The compatibility fallback preserves token balances with unknown dollar values if the endpoint exposes no supported price field.

**Outstanding cloud requirement:** this instance denied access to `api.morpho.org`. A draft network addition was saved, preserving the existing Ethereum RPC destination, but applying it was rejected as exceeding the configured limit. This requires resolution of the environment’s permitted network limit; application code cannot raise that limit. Until the API path is allowed and tested, do not describe Morpho’s full live wallet discovery as verified. This cloud restriction does not establish the cause of a failure on another computer. No wallet private key, API token, or new database is needed. Local hosting requires outbound HTTPS access to this API as well as its blockchain providers.

## Privacy and operations

The application does not persist wallet searches, balances, or history. Hosting access logs, your blockchain providers, Morpho’s public lookup service, and Merkl’s public rewards service may record requests. Morpho and Merkl lookups send the searched wallet address to their respective services. Results use `Cache-Control: no-store`. The server never returns raw provider errors or provider URLs. Keep `.env` out of Git.

The cloud environment permits `ethereum-rpc.publicnode.com` and live Fluid reads were verified. Hosting elsewhere requires configuring its own `ETHEREUM_RPC_URL`. Environment publication and website deployment are separate operations.
