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

Both the supplied and borrowed tokens need a configured match on a destination network for a lending pair to be searched there. Supply-only recommendations need just the deposited token. Tokens absent from this file are still searched on their original network. No other cross-network matches are inferred from wallet token lists or ticker names.

These matches apply only to recommendations. Wallet balances, token names, prices, Net value and NPL are unchanged. Adding a match does not establish bridge availability or a guaranteed one-to-one conversion.
