# Token registry for wallet discovery and recommendations

Edit **token-matches.json** to add tokens to wallet discovery and define cross-network recommendation matches. Ethereum, Plasma, Arbitrum, Base and Binance Smart Chain are the current dashboard networks; the file can also store contracts on other registered EVM mainnets, including Optimism.


## Categories

Each group keeps the original flat network/address format and adds optional **`_category`** metadata:

- **`Stablecoin`**: the underlying stable asset, such as USDC, USDT, DAI, USDe, GHO, USDS or USDai.
- **`Savings stablecoin`**: a yield-bearing savings asset, such as sUSDai, sUSDS, sDAI or sUSDe.
- **`Other`**: all other tokens, including USTC as confirmed by the user after its loss of peg. This is the default for older groups without `_category`.

Stablecoin and savings labels appear in Wallet tokens. Categories are never treated as addresses or cross-chain matches. They do not imply a $1 price or guaranteed yield. Supplied Savings stablecoin assets request a verified 30-day intrinsic rate; that separately identified component enters Supply APR and NPL when available. Missing history makes the affected interest unknown, rather than zero. Balances retain actual market-price checks. USDY, Venus vBUSD and Gate GUSD are marked Savings stablecoin, while Aegis YUSD, Electronic eUSD, Falcon USDf and USDD remain Stablecoin, per user confirmation. Gate GUSD and Gemini GUSD have different identities despite sharing a ticker; `GUSD#3306` is Gemini's Stablecoin.

## CoinMarketCap snapshot

The 2026-11-16 import checked **exactly CoinMarketCap ranks 1–1000 by market capitalization**, then retained **801 ranked assets** with verified nonzero 20-byte EVM mainnet contract addresses. It does not pretend that all 1,000 ranked assets are EVM tokens. Native-only assets, non-EVM addresses, testnets and unverifiable chain metadata are excluded from the import. Pre-existing manual groups and their exact addresses were preserved. The original import produced **809 groups and 2,044 contracts across 120 EVM chain keys**, including explicit savings examples that are not necessarily in CMC's circulating-cap ranking.

**token-matches.sources.json** records the ranking, CMC IDs, ranks, source links, categories, excluded platforms and supplemental sources. Contract platforms are checked against public EVM chain lists, CoinGecko platform chain IDs and the installed viem chain definitions. Requested savings examples absent from the ranked selection use clearly identified CoinGecko records; their identity is never inferred from the ticker. Multiple assets with the same symbol use a `#CMC_ID` suffix. If a source has multiple distinct contracts on the same chain, the importer keeps separate variant groups instead of silently equating wrappers. The normal import does not request an API key.

To import a new snapshot deliberately (requires the project's Node dependencies and Python 3):

```sh
python3 scripts/import-cmc-tokens.py --refresh
```

The importer fetches public CMC listing/detail records with five bounded workers and retries, validates all 1,000 records before writing the config, and preserves existing addresses. Cache files stay in the system temporary directory (or `--cache-dir PATH`), outside the repository. Without `--refresh`, the same cached snapshot can be reprocessed. Review the JSON diff and uncertain categories before committing; updated ranks or platforms do not prove bridge safety or price parity. Existing entries are retained rather than automatically deleted when they leave the top 1,000. Refreshing the registry is an explicit maintenance command, never a wallet-request side effect or a CI build step.

Each named group contains contracts you want treated as the same asset for comparisons. These names are labels: the search matches the actual contract addresses. For example, the USDT group deliberately matches Ethereum USDT, Plasma USDT0 and Arbitrum USDT.

To add another token, copy this pattern into the JSON file, replacing the placeholder with the real contract address:

```json
"TOKEN_NAME": {
  "_category": "Other",
  "ethereum": "0x...",
  "arbitrum": "0x..."
}
```

Use a comma between groups. Use network keys from **evm-chains.json**, such as `ethereum`, `plasma`, `arbitrum`, `base`, `optimism`, `polygon` and `bsc`. Adding an address on another EVM chain stores that match; it does not add that chain to the dashboard or configure an RPC provider. Omit a network if you do not have a match there; do not enter a blank address. You can start with one network and add more later. Contract address capitalization does not matter. A contract on one network must appear in only one group.

Save the file, stop the website and run `npm start` again. Editing this file does not require rebuilding the website. If you also update website code from GitHub, run `npm run build` before starting it.

Both the supplied and borrowed tokens need a verified match on a destination network for a lending pair to be searched there. Supply-only recommendations need just the deposited token.

For a token whose source-network contract is already in this file, only its manual group is used. A missing network entry in that group stays missing; automatic discovery does not fill it in or change your choices.

For source contracts absent from this file, the server automatically looks up CoinGecko and, when configured, CoinMarketCap. It checks the exact original network and contract address, then reads the other platform contracts from that same asset record. Ticker names are never used to guess an identity. Conflicting records and automatic links that overlap a manual identity group are excluded; add the source contract to the appropriate manual group to confirm those cases. If discovery is unavailable, original-network recommendations still work.

The **Token matching** details in Recommendations show manual/automatic status, discovered contract addresses, provider record links and lookup problems. Automatic results stay in memory for one hour (failed lookups retry after one minute) and never write to this file. The first twenty unlisted tokens are looked up per request, with two workers and a twenty-second scheduling budget; unprocessed tokens remain available on their original network.

CoinGecko uses its public API by default. Optional server `.env` settings are:

```dotenv
# Enables CoinMarketCap's official contract-address lookup:
COINMARKETCAP_API_KEY=your_coinmarketcap_api_key
# Optional CoinGecko Demo key for the public API:
COINGECKO_API_KEY=your_coingecko_demo_key
# Or a CoinGecko Pro key, which selects the Pro API:
COINGECKO_PRO_API_KEY=your_coingecko_pro_key
```

Use the API key for the service, not a wallet private key. Leave unused settings empty. CoinMarketCap keys are obtained from https://pro.coinmarketcap.com/; CoinGecko keys from https://www.coingecko.com/en/api. Restart the website after changing `.env`. Keys remain on the server and are not sent to the browser or printed in diagnostics. Provider plans and rate limits can affect access.

The website host must be able to reach `api.coingecko.com` (or `pro-api.coingecko.com` for a Pro key) and `pro-api.coinmarketcap.com` when CoinMarketCap is enabled. No cloud environment settings are changed automatically.

To diagnose an unlisted token without sending a wallet address or printing credentials, run:

```sh
npm run diagnose:token-matches -- ethereum 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
```


Wallet discovery merges the configured contracts for each supported network with the existing supported token roster, removes duplicate contracts, and reads balances at the displayed block. Only nonzero ERC-20 balances are listed. Config entries take precedence for roster labels; symbols and decimals are still read from the token contract. Existing receipt-token exclusions and USD pricing checks remain in place. Adding a match does not establish bridge availability or a guaranteed one-to-one conversion.

User-requested additions after that snapshot include **reUSD**, classified as **Savings stablecoin**. Its Ethereum, Arbitrum, Base, Ink, BNB Smart Chain (`bsc`) and Avalanche addresses come from [CoinGecko’s Re Protocol reUSD record](https://www.coingecko.com/en/coins/re-protocol-reusd). Solana is excluded from this EVM file, and no Plasma address is guessed. The current group/contract/category counts and source evidence are saved in **token-matches.sources.json**.

## Savings-token oracle sources

**token-matches.json** keeps optional **`_intrinsicOracles`** metadata inside each token group. It is an ordered list of sources. Each declares `network` (oracle chain), `address` (oracle contract), `token` (that chain's canonical asset in the same group), `kind` (`chainlink` or `erc4626`), and a `label`. Chainlink sources may pin `description` and `decimals`; ERC-4626 sources must pin `underlying`. Names and tickers never select a source. The old separate `savings-oracles.json` file has been removed.

Example (the token can have balances on several chains while its oracle lives on Ethereum):

```json
"reUSD": {
  "_category": "Savings stablecoin",
  "ethereum": "0x5086bf358635b81d8c47c66d1c8b9e567db70c72",
  "_intrinsicOracles": [
    {
      "network": "ethereum",
      "kind": "chainlink",
      "address": "0x72B5760cFBE437DD01409f44055fDfB8f8121B46",
      "token": "0x5086bf358635b81d8c47c66d1c8b9e567db70c72",
      "description": "reUSD/USD exchange rate",
      "decimals": 18,
      "label": "reUSD/USD exchange-rate oracle"
    }
  ]
}
```

Sources are tried in listed order. Each must supply its own valid current and 30-day-old observations; prices from different sources are never combined. A source must match the token's configured network/address, and the token must be categorized Savings stablecoin for its income to be included. Metadata is excluded from token discovery and cross-chain address matches. `npm run check:config` validates it before building. sUSDai uses `"history": "rounds"` to preserve its archive-free Chainlink round lookup; other feeds use historical block reads. Both lending positions and wallet balances consume these same configured sources. mF-ONE uses the official Midas mF-ONE/USD NAV feed, distinct from its Unloop product's feed.

The reUSD source is the actual reUSD/USD adapter `0x72B5760cFBE437DD01409f44055fDfB8f8121B46`, verified through its Morpho market `0x4565ac05d38b19374ccbb04c17cca60ca9353cd41824f0803d0fc7704f60eaed` and the oracle's `BASE_FEED_1` reference. Its source is verified on Sourcify. sUSDS, sDAI and sUSDe use the canonical share contract's `convertToAssets` rate with the declared stable underlying, rather than a presumed $1 market price. sUSDai retains its existing uncapped Ethereum exchange-rate feed and historical-round reader.

For a newly classified asset without a configured source, the reader tries an attributable canonical ERC-4626 share rate, an Aave-referenced asset feed, or a direct single base feed of an actually held Morpho collateral market. Composite oracle/vault structures are not guessed. If no source or valid history can be verified, the intrinsic APR is explicitly unavailable. Additional adapters can be configured as reliable oracle data becomes available.

For the new archive-based sources, the server reads the current block and finds the last block at or before `current timestamp − 30 days`, verifies the next-block boundary, and reads the **same source** at both snapshots. It applies exactly `(current rate − old rate) × 365 / (30 × old rate)`. Units and identity must match, prices must be positive, and feeds must not be future-dated or more than three days stale at either snapshot. Negative growth remains negative. Quote results are deduplicated by group across networks, cached for five minutes, and failed reads retry after one minute. No wallet history or historical balance database is stored.

Historical contract reads require an archive-capable source-network provider. Optionally set **ETHEREUM_ARCHIVE_RPC_URL** (or another supported network's **..._ARCHIVE_RPC_URL**) on Render; otherwise the normal network provider is used. Keep provider keys in server environment settings. Never use a current oracle reading as the missing month-old value. Diagnose with:

```sh
npm run check:savings-apr -- reUSD ethereum
npm run check:savings-apr -- sUSDS ethereum
```

User-requested CoinGecko additions include **strUSD** ([Tori Staked trUSD](https://www.coingecko.com/en/coins/tori-staked-trusd)) on Ethereum and Monad, and **USD3** ([3Jane USD3](https://www.coingecko.com/en/coins/3jane-usd3)) on Ethereum. Both are classified **Savings stablecoin**: CoinGecko describes strUSD as accruing strategy performance through its trUSD exchange rate, and USD3 as a yield-bearing ERC-4626 senior-tranche token. Monad is stored as an EVM match only; it is not a dashboard network. The source records and current counts are retained in **token-matches.sources.json**.

**etrUSD** ([Tori Ecosystem Vault on CoinGecko](https://www.coingecko.com/en/coins/tori-ecosystem-vault)) is included on Ethereum and classified **Savings stablecoin** as requested. It represents vault shares redeemable for trUSD; the label does not imply a fixed USD peg. Its only CoinGecko-listed platform is Ethereum.


## CoinGecko top-2,000 supplement

The reviewed 2026-11-16 snapshot includes **1,524 ranked assets with eligible EVM contracts** and excludes 476 without eligible contracts. It added **832 groups and 1,876 addresses**, bringing the combined registry to **1,645 groups and 3,930 addresses across 153 EVM chain keys**. Ten address conflicts kept the existing mapping. The current categories are 125 Stablecoin, 57 Savings stablecoin and 1,463 Other.

The CoinGecko import checks exactly circulating market-cap ranks **1–2000**, then retains only nonzero 20-byte contract addresses on verified EVM mainnets. Assets that only exist on non-EVM networks or have no token contract are excluded. The import preserves every existing address and its capitalization, including CoinMarketCap addresses that disagree with CoinGecko. It can add a missing network to an identity matched by an exact contract. A shared ticker never establishes an identity; unrelated assets with the same symbol get a `#cg-COINGECKO_ID` suffix. Records that join multiple existing identities are recorded as conflicts and are not merged.

**token-matches.coingecko.sources.json** records all 2,000 ranked records, included/excluded platforms, added contracts and skipped conflicts. The original **token-matches.sources.json** retains the earlier CoinMarketCap ranking and source records; its current registry counts are updated separately. CoinGecko category decisions and user confirmations live in **coingecko-category-overrides.json**. Reviewed yield-bearing assets, including the user-confirmed USD/EUR investment funds, are classified Savings stablecoin. User-confirmed depegs are classified Other, including when their old stablecoin category needs correcting; their contract addresses remain unchanged. Stablecoin labels never assume a dollar peg, and non-USD stablecoins are classified against their reference currency.

To prepare a new import, use a fresh cache directory to obtain a new snapshot and review the classification decisions. The default command writes only a preview outside the repository:

```sh
python3 scripts/import-coingecko-tokens.py --cache-dir /tmp/defimon-cg2000
python3 scripts/import-coingecko-tokens.py --cache-dir /tmp/defimon-cg2000 --apply
```

The second command writes the reviewed config and provenance files only after the ranking, chains, address uniqueness and category decisions validate. It refuses to apply while category questions remain pending. API requests respect CoinGecko rate-limit retry intervals. Adding platforms to this registry does not enable extra dashboard networks: wallet discovery continues to use Ethereum, Plasma, Arbitrum, Base and Binance Smart Chain.

The import conflict checks can be run with:

```sh
python3 -m unittest discover -s tests -p test_coingecko_import.py
```

**PST (PayFi Strategy Token)** on Ethereum is classified **Savings stablecoin**. Its `_intrinsicOracles` entry pins the uncapped Chainlink **PST-USDC Exchange Rate (Calculated)** feed [`0x4BE50bE32dB1510240d542f77c5B36Ca0D0965E6`](https://etherscan.io/address/0x4BE50bE32dB1510240d542f77c5B36Ca0D0965E6#readContract), with six decimals and historical round lookup. Fluid Vault 165's oracle `0x2e95050bb3F06fe0c83Ee6E3E08ed3972c5D9263` references the capped rate wrapper `0x7Be47fb0679366B9F0aD5ed383f84fE735E047C5`, whose `configData().rateSource_` identifies that feed. Intrinsic APR uses the underlying uncapped reference rate, so Fluid's liquidation caps do not become token earnings. The rate is **USDC per PST**; it does not establish a USD peg. The same configured rate enriches held PST collateral and wallet balances by exact chain/contract match. Check it with `npm run check:savings-apr -- PST ethereum`.

**MGLOBAL (mGLOBAL)** is classified **Savings stablecoin** for its existing Ethereum and Avalanche contracts. Its intrinsic source is the user-specified Ethereum Chainlink proxy [`0xe034De753a3d855B6daD1A4984de75a5c443E939`](https://etherscan.io/address/0xe034De753a3d855B6daD1A4984de75a5c443E939#readContract), verified against Aave Horizon's `mGLOBAL_ORACLE` and `mGLOBAL_UNDERLYING` address-book entries. The source pins eight decimals and the exact description `mGlobal NAV - Aave Llamaguard`; historical rounds provide the current and month-old NAV observations without an archive RPC. The same configured source supplies intrinsic APR for held collateral and wallet tokens. Existing contracts are unchanged. Diagnose with `npm run check:savings-apr -- MGLOBAL ethereum`; `npm run check:horizon -- 0xWalletAddress` also includes configured intrinsic yield in its monthly-interest output.

**scrvUSD (Savings crvUSD)** is classified **Savings stablecoin** on Ethereum at [`0x0655977feb2f289a4ab78af67bab0d17aab84367`](https://etherscan.io/address/0x0655977feb2f289a4ab78af67bab0d17aab84367). CoinGecko and Curve's official deployment aliases agree on this contract. The configured intrinsic price source is the canonical vault itself: `convertToAssets(10^decimals)` returns crvUSD per whole scrvUSD share. The reader verifies `asset()` against crvUSD `0xf939e0a03fb07f59a73314e73794be0e57ac1b4e` and checks share/underlying units at both historical blocks. This measures intrinsic redemption growth without assuming crvUSD equals $1 or using a capped liquidation price. Lending collateral and directly held wallet tokens use the same source automatically.

A live archive check on 2026-11-26 read **1.1107387223563252** crvUSD per scrvUSD at block **26285350** and **1.1160429730597246** at block **26500676**, exactly 30 days later, giving **5.8101017751%** simple annualized intrinsic APR. This is a dated validation result; the app recalculates the rate rather than fixing that percentage in configuration. Repeat with `npm run check:savings-apr -- scrvUSD ethereum`. An Ethereum archive provider is needed for historical redemption reads; the existing public fallback can be used when applicable. Sources: [CoinGecko](https://www.coingecko.com/en/coins/savings-crvusd), [Curve vault documentation](https://docs.curve.finance/developer/scrvusd/overview) and the evidence URLs inside the token's `_intrinsicOracles` entry.

### Savings oracle audit — 2026-11-26

The missing-source audit covered **48 of 60 Savings stablecoin groups** and added **29 source entries for 27 tokens**. All 27 produced usable current/month-old quotes through the application reader during the live check. Existing contracts, categories and the 12 previously configured groups were preserved. The full per-token record, dated observations, provider references and reasons for the 21 unresolved groups are in [analysis/savings-oracle-audit.json](../analysis/savings-oracle-audit.json). “Unconfigured” means no suitable source was established in this audit, not proof that no oracle exists.

Preferred provider sources include Chainlink EURSAFO NAV and Base vyUSD exchange rate, and RedStone fundamental/NAV feeds for strUSD, etrUSD, nOPAL, nALPHA and EURSPKCC. Midas mTBILL/mAPOLLO/mROX/mRe7YIELD/mBASIS and Re Protocol reUSDe use attributable issuer NAV adapters. `kind: "chainlink"` identifies the AggregatorV3-compatible reader interface; it does not mean Chainlink publishes an issuer or RedStone feed. Raw NAV is preferred to capped liquidation prices, market-price discounts or reserves. The RedStone `USD3` feed did not establish the same uncapped NAV semantics as canonical redemption, and a same-ticker `YUSD` feed was not attributed to the configured YieldFi token; those tokens use their own canonical share conversions instead.

Canonical ERC-4626 sources cover the remaining verified share tokens, including USDC/USDT lending vaults, sFRXUSD, cUSDO, apyUSD, srUSDat, yoUSD and the YieldFi shares. Their exact underlying and both token decimal units are checked at both blocks. A zero verified change remains zero; losses remain negative. Rebasing tokens and distributing funds are not assigned dollar-peg or constant-$1 NAV feeds as a substitute for income. The attributable mM1-USD candidate remained stale beyond the existing three-day bound, so freshness rules were not loosened to fill it.

Aladdin's fxSAVE adapter `0x9dD65b6d956E31F4dc093372D975275986695827` exposes full USD `token.nav()` rather than only the fxSP-denominated share conversion. Its verified implementation deliberately returns zero round IDs and timestamps. It is explicitly configured with `computed: true`, `tokenGetter: "token"`, and `computedTimestamp: "none"`, pinned description/decimals, and an exact token match at both archive blocks. Only that explicit computed mode uses the queried block as the observation time; ordinary stored-feed freshness checks remain unchanged. InfiniFi's existing computed adapter keeps its block-timestamp mode. RedStone multi-feed historical observations and unphased Midas rounds use archive block reads; `getRoundData` availability alone is not taken as proof of attributable month-old round history.

## Cookbook APR threshold

`config.json` is the source of truth for Cookbook discovery and display:

```json
{
  "cookbook": {
    "minimumAprPercent": 14
  }
}
```

Use percentage units (`14` means 14%, `12.5` means 12.5%). Only positions with total position APR **strictly above** the threshold qualify. Values must be finite and non-negative; invalid values fail configuration validation.

The server, refresh script, page filters, summary and explanatory text share this setting. After editing it, deploy/restart the server and rebuild/deploy the frontend (normal deployments do this). Existing snapshots below a raised threshold are hidden immediately by the new build, without making the historical JSON unreadable. Lowering the threshold allows previously stored qualifying snapshots to display again; analyse wallets again to capture positions that were never saved under the previous threshold. `analysis/cookbook.json.minimumApr` is snapshot metadata, not the setting.

## syrupUSDC

`syrupUSDC` is configured as **Savings stablecoin** with nine verified EVM token contracts: Ethereum, Base, Arbitrum, Monad, Arc, Ink, Tempo, Robinhood Chain and X Layer. CoinGecko's API ID is `syrupusdc` (the website link uses `syrup-usdc`). Its five EVM entries are cross-checked with Maple's canonical/crosschain documentation; Ink, Tempo, Robinhood and X Layer are supplemental official Maple deployments. Solana is outside this EVM registry. Token addresses are taken from the docs' **Token** rows, not the similarly named CCIP Pool contracts.

The ordered `_intrinsicOracles` sources are Maple-recommended uncapped Chainlink syrupUSDC/USDC feeds:

- **Base:** `0x311D3A3faA1d5939c681E33C2CDAc041FF388EB2`, description `syrupUSDC-USDC Exchange Rate`, 18 decimals.
- **Arbitrum fallback:** `0xF8722c901675C4F2F7824E256B8A6477b2c105FB`, description `syrupUSDC / USDC Exchange Rate`, 18 decimals.

Both use historical oracle rounds for the 30-day simple annualization. They report **USDC per syrupUSDC**, not the USDC/USD spot price. Maple states that these feeds relay the canonical Ethereum pool's `convertToExitAssets()` valuation, accounting for unrealized losses. Aave Base's capped syrupUSDC liquidation oracle `0x5e9eCce4aCBBc8172A40f7b8A7c086A4bb5CDeac` was checked on-chain: `RATIO_PROVIDER()` returns the configured Base feed. Intrinsic APR therefore uses the uncapped exchange rate; protocol lending APR, Merkl incentives and SYRUP rewards remain separate. The same group rate applies to exact configured wallet/collateral contracts across supported dashboard networks.

Live validation on 2026-11-27:

- Base block `62951103`, rounds `36893488147419103455` → `36893488147419103485`, rates **1.1901136170458433** → **1.1950672360642736** USDC per token: **5.0641409801% intrinsic APR**.
- Arbitrum block `527999505`, rounds `36893488147419103429` → `36893488147419103459`, rates **1.1901512802747258** → **1.1951075896507897**: **5.0667310177% intrinsic APR**.

The observations are approximately 30.01 days apart because the feeds update periodically. These are dated validation results; the application recalculates APR using `(current rate − historical rate) × 365 / (30 × historical rate)`. They are not advertised APYs or guaranteed future returns. Historical round reads do not require Ethereum archive access. The Ethereum canonical contract was independently checked for symbol `syrupUSDC`, six share decimals, and underlying USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`.

Sources: [CoinGecko](https://www.coingecko.com/en/coins/syrup-usdc), [Maple Ethereum integration](https://docs.maple.finance/integrate/ethereum-mainnet/asset-integration), [Maple crosschain contracts and feeds](https://docs.maple.finance/integrate/crosschain/syrupusd-crosschain), and [Aave Base address book](https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Base.sol). Repeat the primary source check with `npm run check:savings-apr -- syrupUSDC ethereum`; the configured source chain is Base even when the held token is on Ethereum.
