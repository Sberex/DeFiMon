# Free external scheduler for DeFiMon alerts

Use [cron-job.org](https://cron-job.org/en/) to send a GitHub workflow dispatch every five minutes. GitHub Actions still executes both trackers, and all preferences, baselines and notifications remain in the existing `analysis/*.json` files in Sberex/DeFiMon. No database or always-running Render process is required. This improves trigger frequency; it does not guarantee GitHub runner availability or immediate job starts.

## 1. Create a GitHub dispatch token

In [GitHub fine-grained tokens](https://github.com/settings/personal-access-tokens/new), create a dedicated token:

- Resource owner: **Sberex**.
- Repository access: **Only select repositories → Sberex/DeFiMon**.
- Repository permissions: **Actions → Read and write**. Metadata read access is automatic. No Contents write permission is needed for this external token.
- Choose an expiration date and replace the cron-job.org header before it expires.

Enter this dedicated token only in the cron job's Authorization header. Do not put it in the URL, GitHub JSON files, frontend configuration or a chat message. The workflow uses its own built-in `GITHUB_TOKEN` to write results. Your existing `COOKBOOK_GITHUB_TOKEN` does not need to change.

## 2. Create the cron job

After creating a free [cron-job.org account](https://console.cron-job.org/), choose **Create cronjob** and enter:

| Setting | Value |
| --- | --- |
| Title | DeFiMon alert trackers |
| URL | `https://api.github.com/repos/Sberex/DeFiMon/actions/workflows/market-liquidity-monitor.yml/dispatches` |
| Enabled | On |
| Schedule | Every 5 minutes (`*/5 * * * *`) |
| Time zone | UTC (every-five-minute cadence is unchanged in Kyiv) |
| Request method (Advanced) | POST |
| Request body (Advanced) | `{"ref":"main","inputs":{"source":"external-scheduler"}}` |

Add these custom request headers in the Advanced settings:

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer YOUR_DEDICATED_GITHUB_TOKEN` |
| `Accept` | `application/vnd.github+json` |
| `Content-Type` | `application/json` |
| `X-GitHub-Api-Version` | `2022-11-28` |
| `User-Agent` | `DeFiMon-External-Scheduler` |

Replace `YOUR_DEDICATED_GITHUB_TOKEN` with your token. Keep the token in the header, not HTTP Basic authentication. The request body contains normal JSON quotes, not escaped quotes. Request logs should not expose the Authorization header.

## 3. Test and activate

1. Run **Test run** in cron-job.org. GitHub normally returns **204 No Content** when it accepts a dispatch; an empty response body is expected.
2. Check [DeFiMon monitoring runs](https://github.com/Sberex/DeFiMon/actions/workflows/market-liquidity-monitor.yml). The run appears as `workflow_dispatch`. Open it and confirm both the liquidity and utilization steps pass.
3. Check `analysis/liquidity-alert-state.json` and `analysis/utilization-alert-state.json`. For metrics with enabled watches, `lastRunEvent` becomes `external_scheduler` and `lastExternalRunAt` advances. `lastScheduledRunAt` continues to mean GitHub's native cron only.
4. Save/enable the cron job, then verify **at least two unattended runs about five minutes apart**. One Test run confirms dispatch compatibility, not a working recurring schedule.
5. In **Wallet Overview → Alerts**, each enabled metric displays its latest external-triggered check. It warns if neither GitHub cron nor an external-triggered check has been recorded for 15 minutes, or if an enabled position could not be checked.

The `source` input is trigger attribution supplied by the caller. It is not proof that cron-job.org is configured or that a request came from a particular vendor. Normal manual dispatch defaults to `manual` and never refreshes the external or native-cron heartbeat.

## Storage and coexistence

Existing files are unchanged:

- `analysis/wallet-history.json`: saved alert preferences.
- `analysis/liquidity-alert-state.json` and `analysis/utilization-alert-state.json`: baselines and heartbeat metadata.
- `analysis/liquidity-alert-notifications.json` and `analysis/utilization-alert-notifications.json`: alert notifications.

GitHub's native cron remains enabled as a fallback. Workflow concurrency serializes native and external executions. Baselines and deterministic notification IDs avoid duplicate notifications from overlapping triggers. A 204 response means GitHub accepted the trigger, not that the tracker finished successfully; use the Actions result and JSON timestamps to verify completion.

## Troubleshooting

- **401:** token expired or copied incorrectly.
- **403:** token is missing Actions write access, needs organization approval, or repository policy blocks it.
- **404:** wrong URL/repository selection, or the token cannot access the repository.
- **422:** use `main` and the exact JSON body above; verify the workflow's `source` input is deployed on main.
- **204 but no fresh readings:** check Actions queue/run logs and that at least one alert is enabled for that metric. No enabled watches means no RPC checks or repeated empty commits.

The repository is ready for external dispatch. Creating/enabling the cron-job.org account/job is a separate user setup step; deploying this code does not create that external job.
