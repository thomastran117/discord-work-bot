# Deployment and operations

[Back to README](../README.md)

## GitHub Actions

The recommended deployment is a GitHub-hosted runner. No server, bot token, paid database or personal access token is normally needed.

1. Enable GitHub Actions on your repository; forks may require enabling scheduled workflows manually.
2. In Discord, go to **Edit Channel → Integrations → Webhooks**, create a webhook and copy its URL.
3. In GitHub, navigate to **Settings → Secrets and variables → Actions → New repository secret**, use the name `DISCORD_WEBHOOK_URL` and paste the URL as the secret value. Do not put it in an Actions variable.
4. Open **Actions → Canadian new-grad job bot → Run workflow** on the default branch. First run `test-webhook` and `preview` to confirm the destination and source health.
5. Select `poll` to start monitoring or `backfill` to queue current matches immediately.

The production workflow runs at minute 17 of every even UTC hour (`17 */2 * * *`). The exact local time changes with daylight saving time. GitHub can delay or drop scheduled runs; schedules run on the default branch. GitHub may disable scheduled workflows in inactive public repositories after 60 days. Check the Actions tab if polling stops.

### Workflow modes

| Mode | Description | Sends Discord messages | Writes state |
| --- | --- | --- | --- |
| `preview` | Fetch and filter live sources | No | No |
| `test-webhook` | Send a clearly labelled fictitious sample card | One test message | No |
| `poll` | Normal incremental poll, also used by the schedule | Pending jobs | Yes |
| `backfill` | Queue current matches previously seeded but not sent, plus new jobs | Pending jobs | Yes |

Only preview can run on non-default branches; the production modes require the default branch. The first successful poll of **each source** defaults to silently seeding existing matches. Changing `FIRST_RUN_MODE` later does not replay previously seeded jobs. Backfill is the explicit way to queue current seeded matches without replaying sent jobs. The default delivery cap is 25 per run and subsequent normal polls drain the remaining pending queue.

Set these optional **repository Actions variables** in Settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `FIRST_RUN_MODE` | `seed` | Use `publish` to queue existing matches for newly initialized sources |
| `MAX_NOTIFICATIONS_PER_RUN` | `25` | Maximum job notifications per poll (1–500) |

Source changes are made in the versioned [configuration files](sources.md). The workflow does not automatically forward other local environment variables.

## Local development and self-hosting

Use Node.js 24.x. Copy [`.env.example`](../.env.example) to `.env` and set the webhook secret for delivery modes. Commands run from the repository root.

| Command | Purpose |
| --- | --- |
| `npm test` | Offline Node test suite |
| `npm run preview` | Live source preview; no database or webhook |
| `npm run test:webhook` | Send a fictional card; no scraping or state changes |
| `npm run once` | One standard poll |
| `npm run backfill` | One poll with backfill |
| `npm start` | Poll immediately and every 120 minutes by default |

The long-running process skips overlapping polls. Use only one deployment per state database and Discord destination to avoid competing notification queues.

### Docker

After creating `.env`:

~~~sh
docker compose up -d --build
docker compose logs -f job-bot
docker compose down
~~~

The named volume `job-data` persists SQLite under `/app/data`. Keep `DATABASE_PATH` inside that directory in Docker. The three source configuration files are mounted read-only; restart the service after editing them. No inbound ports are exposed. Do not use `docker compose down -v` unless intentionally resetting state.

### Environment reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_WEBHOOK_URL` | Required for delivery | Discord webhook secret |
| `DATABASE_PATH` | `./data/jobs.db` | SQLite path; CI sets a temporary path |
| `POLL_INTERVAL_MINUTES` | `120` | Long-running poll interval, 1–1440 |
| `FIRST_RUN_MODE` | `seed` | `seed` or `publish` |
| `MAX_NOTIFICATIONS_PER_RUN` | `25` | Delivery cap, 1–500 |
| `SIMPLIFY_ENABLED` | `true` | Enable SimplifyJobs |
| `SIMPLIFY_URL` | Upstream JSON URL | Override SimplifyJobs feed |
| `BOARDS_PATH` | `./config/boards.json` | Greenhouse, Lever and Ashby boards |
| `FEEDS_PATH` | `./config/feeds.json` | Optional curated feeds |
| `CAREERS_PATH` | `./config/careers.json` | Workday and Oracle career sources |

## State and recovery

GitHub runners are ephemeral. The workflow restores `jobs.db` from a dedicated `bot-state` branch, runs the one-shot bot, and saves a SQLite backup to that branch. It creates the branch on the first successful state save and skips committing unchanged logical state. The workflow grants the built-in `GITHUB_TOKEN` contents write access only for the production job. If a repository policy prevents writing, review the policy rather than committing a personal token.

Do not delete, force-update or manually edit `bot-state`. If restore fails, the workflow aborts rather than silently resetting. Keep a backup if continuity matters. Deleting the branch resets deduplication; already-sent jobs may be published again if using backfill or publish mode.

In a public repository, this branch and its history are public. It contains posting metadata and Discord message IDs, not webhook credentials or full descriptions from the current ingestion pipeline. Do not upload a pre-existing local database that contains private or restricted data. Use a private repository or a private state store if necessary. Preview logs are also public.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Green workflow, no Discord messages | Inspect `delivery_queue` and `no_notifications`. Use backfill for seeded matches and test-webhook for independent connectivity. |
| Webhook test fails | Confirm repository secret, URL, intended channel, webhook permissions and any Discord API error code. Rotate a deleted or exposed webhook. |
| Source HTTP 429 | Respect provider rate limits. Avoid repeated manual retries, wait for subsequent polls, or disable the affected source. Do not bypass blocking. |
| Source HTTP 403 or 404 | Check the provider's public interface, identifier and terms; disable invalid or disallowed sources. |
| Workflow marked failed but messages were sent | One-shot mode returns failure when any source fails, even if other sources and delivery succeed. Review the summary and state-save step. |
| Duplicates after a runner crash | Check whether the state-save step completed. Discord delivery and state persistence are not atomic. |
| State restore/save fails | Inspect workflow permissions, branch health and Git logs. Do not reset state merely to clear an error. |

Useful structured events: `source_complete`, `source_failed`, `delivery_queue`, `notification_sent`, `delivery_deferred`, `poll_complete`, `webhook_test_confirmed` and `webhook_test_failed`.

### Observed deployment issue

In [the Nov 17, 2026 production run](https://github.com/thomastran117/discord-work-bot/actions/runs/44024277333), 13 of 15 sources completed, 19 Discord notifications were delivered, and both Ciena and RBC returned HTTP 429. Nokia returned 70 postings but none passed the classifier. These are run-specific observations, not permanent source health or evidence that all eligible openings were found. Ciena and RBC remain configured; disable them in `config/careers.json` if the rate-limit problem persists.
