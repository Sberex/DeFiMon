# Token registry for wallet discovery and recommendations

Edit **token-matches.json** to add tokens to wallet discovery and define cross-network recommendation matches. Ethereum, Plasma, Arbitrum and Base are the current dashboard networks; the file can also store contracts on other registered EVM mainnets, including Optimism.


## Categories

Each group keeps the original flat network/address format and adds optional **`_category`** metadata:

- **`Stablecoin`**: the underlying stable asset, such as USDC, USDT, DAI, USDe, GHO, USDS or USDai.
- **`Savings stablecoin`**: a yield-bearing savings asset, such as sUSDai, sUSDS, sDAI or sUSDe.
- **`Other`**: all other tokens, including USTC as confirmed by the user after its loss of peg. This is the default for older groups without `_category`.

Stablecoin and savings labels appear in Wallet tokens. Categories are never treated as addresses or cross-chain matches. They do not imply a $1 price, guaranteed yield, an APR estimate or additional NPL; balances retain actual market-price checks. USDY, Venus vBUSD and Gate GUSD are marked Savings stablecoin, while Aegis YUSD, Electronic eUSD, Falcon USDf and USDD remain Stablecoin, per user confirmation. Gate GUSD and Gemini GUSD have different identities despite sharing a ticker; `GUSD#3306` is Gemini's Stablecoin.

## CoinMarketCap snapshot

The 2026-11-16 import checked **exactly CoinMarketCap ranks 1–1000 by market capitalization**, then retained **801 ranked assets** with verified nonzero 20-byte EVM mainnet contract addresses. It does not pretend that all 1,000 ranked assets are EVM tokens. Native-only assets, non-EVM addresses, testnets and unverifiable chain metadata are excluded from the import. Pre-existing manual groups and their exact addresses were preserved. The full file has **809 groups and 2,044 contracts across 120 EVM chain keys**, including explicit savings examples that are not necessarily in CMC's circulating-cap ranking.

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
