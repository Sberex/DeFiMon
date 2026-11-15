# Token matches for recommendations

Edit **token-matches.json** to add or change the tokens that recommendations may compare across Ethereum, Plasma and Arbitrum.

Each named group contains contracts you want treated as the same asset for comparisons. These names are labels: the search matches the actual contract addresses. For example, the USDT group deliberately matches Ethereum USDT, Plasma USDT0 and Arbitrum USDT.

To add another token, copy this pattern into the JSON file, replacing the placeholder with the real contract address:

```json
"TOKEN_NAME": {
  "ethereum": "0x...",
  "arbitrum": "0x..."
}
```

Use a comma between groups. Use only `ethereum`, `plasma` and `arbitrum` as network names. Omit a network if you do not have a match there; do not enter a blank address. You can start with one network and add more later. Contract address capitalization does not matter. A contract on one network must appear in only one group.

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


These matches apply only to recommendations. Wallet balances, token names, prices, Net value and NPL are unchanged. Adding a match does not establish bridge availability or a guaranteed one-to-one conversion.
