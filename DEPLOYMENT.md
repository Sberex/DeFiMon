# Publish DeFiMon

The public website runs on **GitHub Pages**. Live balances, rates and recommendations run on **Render**. GitHub Pages cannot run the Node server itself. Your Ethereum-provider keys belong only on Render.

Once connected, pushing changes to `main` runs tests and publishes the website automatically. Render also redeploys automatically after GitHub checks pass. Failed checks stop deployment.

## 1. Enable GitHub Pages

1. Open [DeFiMon → Settings → Pages](https://github.com/Sberex/DeFiMon/settings/pages).
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Open [Actions → Deploy GitHub Pages](https://github.com/Sberex/DeFiMon/actions/workflows/pages.yml), choose **Run workflow**, and select `main`.
4. Wait for the workflow to turn green. The expected website address is **https://sberex.github.io/DeFiMon/**. The workflow's deployment link is the authoritative address.

The page can publish before Render is ready. It clearly explains that live checks are not configured and offers the illustrative example dashboard.

## 2. Create the Render server

1. Sign into [Render](https://dashboard.render.com/). You can also open the [DeFiMon Blueprint setup](https://render.com/deploy?repo=https://github.com/Sberex/DeFiMon) directly.
2. Select **New → Blueprint** and connect `Sberex/DeFiMon` using branch `main`. Render reads the included `render.yaml`.
3. Enter `ETHEREUM_RPC_URL`: the Ethereum provider URL from your local configuration. Enter it directly in Render, never in GitHub source files or a chat message. No wallet key or seed phrase is needed.
4. Create the service and wait until it is live. Copy the public URL shown by Render, for example `https://defimon-api-xxxx.onrender.com` (your actual name may differ).
5. Open `https://YOUR-ACTUAL-SERVICE.onrender.com/api/health`. It should return JSON containing `"status":"ok"`. This checks the server, not all protocol connections.

The blueprint starts with Render's free plan. Free services sleep when idle, so the first lookup after inactivity can be slow; resource limits can also affect large searches. An always-on paid plan is optional and can be chosen in Render. Render pricing and plan availability may change.

The server uses public Plasma and Arbitrum providers initially. For regular use, replace `PLASMA_RPC_URL` and `ARBITRUM_RPC_URL` in **Render → service → Environment** with your dedicated providers. Optional CoinGecko/CoinMarketCap keys from `.env.example` also belong there. Render sets `PORT` automatically; do not copy your local port setting.

`FRONTEND_ORIGINS` is already set to `https://sberex.github.io`. If you add a custom domain, add its origin to this comma-separated setting. Use the origin only: no `/DeFiMon/` path and no trailing slash. This controls browser access; it is not API authentication.

## 3. Connect GitHub Pages to Render

The Pages workflow now defaults to **https://defimon-api.onrender.com**. No repository variable is needed for that service. Pushing to `main` or running **Deploy GitHub Pages** rebuilds the page with this connection. The steps below are only needed to override it with a different server URL.

1. Open [DeFiMon → Settings → Secrets and variables → Actions → Variables](https://github.com/Sberex/DeFiMon/settings/variables/actions).
2. Select **New repository variable**.
3. Name it **`VITE_API_BASE_URL`** and set its value to the Render service's public HTTPS URL. Use only the origin, without `/api`, a path, or a trailing slash. This URL is public and contains no provider key.
4. Run **Deploy GitHub Pages** again. Changing a repository variable alone does not rebuild the page.
5. Visit the public website and check a wallet. Verify positions and recommendations; any failed protocol connection remains explicitly unavailable.

## Future updates

Push to `main`. **Deploy GitHub Pages** runs unit tests, builds the application, runs browser tests, builds the public site under its repository path, checks that artifact, and deploys only if all checks pass. Pull requests run the separate **Tests** workflow. Render's `checksPass` setting waits for GitHub checks before automatically deploying the server. Its dashboard reports server deployment status separately.

The website and server deploy separately. No protocol API keys or `.env` files are uploaded to GitHub Pages; only the built `dist` directory is published. Never add credentials to any `VITE_*` variable because these values appear in the public JavaScript.

## Local development

Existing commands stay the same:

```sh
npm ci
npm run dev
```

Local development forwards `/api` to the local server. Do not set `VITE_STATIC_HOSTING` or `VITE_API_BASE_URL` locally unless intentionally testing a separate server. For a normal self-hosted production server, `npm run build && npm start` serves both the page and API together.

To check the Pages artifact locally:

```sh
VITE_BASE_PATH=/DeFiMon/ VITE_STATIC_HOSTING=true npm run build
npx tsx scripts/check-pages.ts
```

This version intentionally has no live server connection. To check a connected build, set `VITE_API_BASE_URL` while building, then use the same URL as `PAGES_API_BASE_URL` when running the check. The check mocks wallet responses and does not contact live protocols. Install Chromium first with `npx playwright install chromium` if necessary.

If the page has missing assets, check the workflow's **Build public website** step and the repository path. If live requests are blocked, check `VITE_API_BASE_URL`, `FRONTEND_ORIGINS`, and whether the Render service is awake. If publishing fails with a Pages configuration error, verify Step 1 and that GitHub Actions is permitted in the repository settings.
