# Publish DeFiMon

The public website runs on **GitHub Pages**. Live balances, rates and recommendations run on **Render**. GitHub Pages cannot run the Node server itself. Your Ethereum-provider keys belong only on Render.

Once connected, pushing changes to `main` runs tests and publishes the website automatically. Render also redeploys automatically after GitHub checks pass. Failed checks stop deployment.

## 1. Enable GitHub Pages

1. Open [DeFiMon → Settings → Pages](https://github.com/Sberex/DeFiMon/settings/pages).
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Open [Actions → Deploy GitHub Pages](https://github.com/Sberex/DeFiMon/actions/workflows/pages.yml), choose **Run workflow**, and select `main`.
4. Wait for the workflow to turn green. With the configured custom domain the website address is **https://app.sberex.com/**. Without a custom domain, the repository address is **https://sberex.github.io/DeFiMon/**. The workflow's deployment link is the authoritative address.

The page can publish before Render is ready. It clearly explains that live checks are not configured and offers the illustrative example dashboard.

## 2. Create the Render server

1. Sign into [Render](https://dashboard.render.com/). You can also open the [DeFiMon Blueprint setup](https://render.com/deploy?repo=https://github.com/Sberex/DeFiMon) directly.
2. Select **New → Blueprint** and connect `Sberex/DeFiMon` using branch `main`. Render reads the included `render.yaml`.
3. Enter `ETHEREUM_RPC_URL`: the Ethereum provider URL from your local configuration. Enter it directly in Render, never in GitHub source files or a chat message. No wallet key or seed phrase is needed.
4. Create the service and wait until it is live. Copy the public URL shown by Render, for example `https://defimon-api-xxxx.onrender.com` (your actual name may differ).
5. Open `https://YOUR-ACTUAL-SERVICE.onrender.com/api/health`. It should return JSON containing `"status":"ok"`. This checks the server, not all protocol connections.

The blueprint starts with Render's free plan. Free services sleep when idle, so the first lookup after inactivity can be slow; resource limits can also affect large searches. An always-on paid plan is optional and can be chosen in Render. Render pricing and plan availability may change.

The server uses public Plasma, Arbitrum and Base providers initially. For regular use, replace `PLASMA_RPC_URL`, `ARBITRUM_RPC_URL` and `BASE_RPC_URL` in **Render → service → Environment** with your dedicated providers. Optional CoinGecko/CoinMarketCap keys from `.env.example` also belong there. Render sets `PORT` automatically; do not copy your local port setting.

The server explicitly allows the deployed public domain `https://app.sberex.com`, including when an older Render environment lists only GitHub Pages. `FRONTEND_ORIGINS` adds other allowed frontends; the blueprint sets it to `https://sberex.github.io,https://app.sberex.com`. If you add another custom domain, add its origin to this comma-separated setting. Editing the blueprint does not automatically change a manually created service. Use the origin only: no `/DeFiMon/` path and no trailing slash. This controls browser access; it is not API authentication.

## 3. Connect GitHub Pages to Render

The Pages workflow now defaults to **https://defimon-api.onrender.com**. No repository variable is needed for that service. Pushing to `main` or running **Deploy GitHub Pages** rebuilds the page with this connection. The steps below are only needed to override it with a different server URL.

1. Open [DeFiMon → Settings → Secrets and variables → Actions → Variables](https://github.com/Sberex/DeFiMon/settings/variables/actions).
2. Select **New repository variable**.
3. Name it **`VITE_API_BASE_URL`** and set its value to the Render service's public HTTPS URL. Use only the origin, without `/api`, a path, or a trailing slash. This URL is public and contains no provider key.
4. Run **Deploy GitHub Pages** again. Changing a repository variable alone does not rebuild the page.
5. Visit the public website and check a wallet. Verify positions and recommendations; any failed protocol connection remains explicitly unavailable.

## Future updates

Push to `main`. **Deploy GitHub Pages** runs unit tests, builds the application, runs browser tests, reads the configured Pages URL and builds the public site under the matching path, checks that artifact, and deploys only if all checks pass. Pull requests run the separate **Tests** workflow. Render's `checksPass` setting waits for GitHub checks before automatically deploying the server. Its dashboard reports server deployment status separately.

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

## Duplicate deployment package error

If a deployment says `Multiple artifacts named "github-pages" ... Artifact count is 2`, GitHub found more than one package with the name requested by the publish step. This is a deployment-package selection error; the website build can still have succeeded. The current workflow names packages `github-pages-RUN_ID-ATTEMPT` and passes the name from the build job to deployment. A full rerun creates a new name; rerunning only deployment reuses the exact package output from the successful build. No artifact deletion or additional repository permission is required.

After updating the workflow, use the new run triggered by the update, or **Actions → Deploy GitHub Pages → Run workflow → main**. Rerunning a historical workflow uses its old configuration and will not apply this fix. The workflow also uses pinned action releases verified to run on Node.js 24, including the Pages uploader's nested upload action, instead of deprecated Node.js 20 actions.

## Custom domain asset paths

The workflow reads `base_path` from GitHub's official Pages configuration action before building. With `https://app.sberex.com/`, that output is empty and both the build and artifact check use `/`, producing `/assets/...` links. With a repository URL such as `https://sberex.github.io/DeFiMon/`, both use `/DeFiMon/`. The home link uses the same build base. Changing the custom domain in **Settings → Pages** requires a new workflow run to rebuild these paths. A `CNAME` file is not required for this Actions-based deployment; the domain is configured in Pages settings.

To verify a custom-domain artifact locally, run:

```sh
VITE_BASE_PATH=/ VITE_STATIC_HOSTING=true VITE_API_BASE_URL=https://defimon-api.onrender.com npm run build
PAGES_BASE_PATH=/ PAGES_API_BASE_URL=https://defimon-api.onrender.com npx tsx scripts/check-pages.ts
```
