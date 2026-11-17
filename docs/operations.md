# Deployment and operations

[Back to README](../README.md)

## GitHub Actions

The recommended deployment is a GitHub-hosted runner. No server, bot token, paid database or personal access token is normally needed.

1. Enable GitHub Actions on your repository; forks may require enabling scheduled workflows manually.
2. In Discord, go to **Edit Channel → Integrations → Webhooks**, create a webhook and copy its URL.
3. In GitHub, navigate to **Settings → Secrets and variables → Actions → New repository secret**, use the name `DISCORD_WEBHOOK_URL` and paste the URL as the secret value. Do not put it in an Actions variable.
4. Open **Actions → Canadian new-grad job bot → Run workflow** on the default branch.
5. Select `poll` (default) for normal monitoring or `backfill` with a lookback of 1–30 days (default 7).

The production workflow runs at minute 17 of every even UTC hour (`17 */2 * * *`). The exact local time changes with daylight saving time. GitHub can delay or drop scheduled runs; schedules run on the default branch. GitHub may disable scheduled workflows in inactive public repositories after 60 days. Check the Actions tab if polling stops.

For a forum or media channel, append `?thread_id=<thread snowflake>` to the webhook URL stored in `DISCORD_WEBHOOK_URL`. Discord requires a thread destination for those channel types; without it, delivery is deferred with API error `220001` and jobs remain pending.

### Workflow modes

| Mode | Description |
| --- | --- |
| `poll` (default) | Normal incremental poll, also used by the schedule. The first successful poll seeds existing matches per source by default. |
| `backfill` | Fetch current matches and queue unsent postings dated within the requested lookback. |

Both modes run on the default branch and restore/save SQLite. Manual backfill accepts a whole number of days from 1 to 30 (default 7); scheduled and manual poll ignore this input. Both GitHub Actions and the CLI validate the bound. Changing `FIRST_RUN_MODE` later does not replay previously seeded jobs.

### Backfill rules

The lookback is an inclusive rolling UTC window from run start minus X × 24 hours to run start. The bot uses the source-provided normalized posting timestamp (or an earlier known date on a matched alias), not the discovery time, employment start date or last-updated timestamp. Date-only values use midnight UTC. Missing, invalid, future and older dates are not backfilled; newly discovered out-of-window or undated jobs are recorded as seeded to avoid flooding the next poll. A wider later backfill can recover a still-eligible, dated seed record.

Already sent or quarantined jobs are not requeued. Each run observes the live source snapshots rather than recovering historical closed postings. Previously pending jobs outside the window stay pending for normal polling; the current backfill delivery pass selects only pending jobs dated inside the window. The normal 25-message default delivery cap applies; queued jobs can drain on subsequent normal polls. Because normal polling has no age restriction, its previously queued or newly discovered jobs can include older or undated postings.

Date coverage varies by source. Greenhouse's existing adapter does not expose a posting date (an update timestamp is not a publication date); some community lists have no full publication date. Lever's creation timestamp and other providers' published/released dates are the available source signals and may differ from an original publication date. Unknown dates are skipped rather than guessed; this is a safety limit, not a guarantee of complete historical coverage.

Preview and webhook-test diagnostics are intentionally CLI-only; use `npm run preview` and `npm run test:webhook` locally. The latter sends one labelled example card and does not scrape or write job state.

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
| `npm run preview` | Live source preview; reads saved cooldowns if available, no state writes or webhook |
| `npm run test:webhook` | Send a fictional card; no scraping or state changes |
| `npm run once` | One standard poll |
| `npm run backfill -- 14` | One bounded backfill (1–30 days; omit argument for 7) |
| `npm start` | Poll immediately and every 120 minutes by default |

The long-running process skips overlapping polls. Use only one deployment per state database and Discord destination to avoid competing notification queues.

### Docker

After creating `.env`:

~~~sh
docker compose up -d --build
docker compose logs -f job-bot
docker compose down
~~~

The named volume `job-data` persists SQLite under `/app/data`. Keep `DATABASE_PATH` inside that directory in Docker. The container root filesystem and three source configuration mounts are read-only, Linux capabilities are dropped, and privilege escalation is disabled. Restart the service after editing configuration. No inbound ports are exposed. Do not use `docker compose down -v` unless intentionally resetting state.

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

## Source retry and rate-limit policy

All configured sources share one read-only HTTP client. Requests must use HTTPS and redirects are rejected so a configured origin cannot redirect the runner to another network destination. Responses are streamed with a 16 MiB decoded-body limit and may contain at most 25,000 raw rows; after filtering historical or inactive data, an adapter may return at most 10,000 jobs per poll. Requests are sequential; minimum start-to-start spacing is one second per hostname, or two seconds for Workday hosts. A request may be attempted up to four times (one initial request and three retries), with a 20-second timeout per attempt.

| Condition | Behaviour |
| --- | --- |
| Network failure, timeout, HTTP 408/425/500/502/503/504 | Exponential waits starting at 2 seconds (2, 4, 8), plus up to 25% jitter |
| HTTP 429 | Slower exponential waits starting at 15 seconds (15, 30, 60), plus jitter |
| Retry-After on retryable response | Honour seconds or HTTP date, never wait less than the header or the backoff |
| Required wait exceeds 60 seconds, or rate-limit attempts exhausted | Defer the affected host; repeated 429s open at least a 30-minute cooldown |
| Permanent HTTP errors, invalid JSON or incompatible schema | Fail without retry |
| Redirect or oversized response | Reject immediately without following or retrying |

An active host cooldown prevents new requests to that host, even across employer boards sharing it. Production cooldowns are saved as hostnames and expiry timestamps in SQLite and restored on later workflow runs. Local preview reads saved cooldowns if a database is available but does not persist new observations; do not repeatedly run previews to probe a throttled provider. Workday has a four-minute per-employer deadline, and Oracle/SmartRecruiters two minutes; deadline cancellation stops both HTTP requests and retry sleeps. These are conservative local limits, not a claim that providers allow this traffic. Disable persistently blocked sources rather than using alternate endpoints or attempting to circumvent restrictions.

## State and recovery

GitHub runners are ephemeral. The workflow restores `jobs.db` from a dedicated `bot-state` branch, runs the one-shot bot, and saves a SQLite backup to that branch. It creates the branch on the first successful state save and skips committing unchanged logical state. The workflow grants the built-in `GITHUB_TOKEN` contents write access only for the production job. If a repository policy prevents writing, review the policy rather than committing a personal token.

Do not delete, force-update or manually edit `bot-state`. If restore fails, the workflow aborts rather than silently resetting. Keep a backup if continuity matters. Deleting the branch resets deduplication; already-sent jobs may be published again if using backfill or publish mode.

In a public repository, this branch and its history are public. It contains posting metadata and Discord message IDs, not webhook credentials or full descriptions from the current ingestion pipeline. Do not upload a pre-existing local database that contains private or restricted data. Use a private repository or a private state store if necessary. Preview logs are also public.

Normalized posting fields are bounded before persistence. Discord payloads show the destination hostname and accept only HTTPS application links. Local validation, HTTP 413, and Discord payload error codes `40005` or `50035` identify a permanently invalid job payload; the job is recorded in `delivery_rejections` and later queued jobs continue. Other failures—including forum/media destination error `220001`—remain pending and stop the current delivery pass so transient outages and webhook, permission, channel or thread configuration problems can be fixed without losing notifications.

## Poll outcomes

A successful empty poll emits a warning (including a GitHub Actions warning annotation) and exits with code 0. Partial source outages also warn and exit with code 0 if delivery succeeds; this does not imply complete coverage. If all sources fail, or a Discord delivery, configuration or database operation fails, one-shot execution exits nonzero. Existing pending notifications can still be processed when sources fail. Invalid notification payloads are quarantined and warned about, rather than blocking the rest of the queue. Local preview uses the same partial-source policy but does not issue an empty-notification warning. State restore and save failures remain fatal.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Green workflow, no Discord messages | Inspect `delivery_queue` and `no_notifications`. Use bounded backfill for recent seeded matches and the local test:webhook command for independent connectivity. |
| Webhook test fails | Confirm repository secret, URL, intended channel, webhook permissions and any Discord API error code. Rotate a deleted or exposed webhook. |
| Source HTTP 429 | Check source_http_retry, source_http_deferred and source_http_cooldown. Honour the logged retry time; disable the affected source if throttling persists. |
| Source HTTP 403 or 404 | Check the provider's public interface, identifier and terms; disable invalid or disallowed sources. |
| Workflow succeeds with warnings | No new notifications, partial source failures/cooldowns or quarantined payloads are non-fatal. Inspect `poll_warning` and source logs for incomplete coverage. |
| Workflow marked failed | All sources failed, Discord delivery failed, or configuration/database/state persistence failed. Inspect `poll_error`, source logs and the state-save step. |
| Rejected count increases | Inspect `notification_rejected`; the posting was quarantined after local payload validation or Discord rejected it as permanently invalid. |
| Duplicates after a runner crash | Check whether the state-save step completed. Discord delivery and state persistence are not atomic. |
| State restore/save fails | Inspect workflow permissions, branch health and Git logs. Do not reset state merely to clear an error. |

Useful structured events: `poll_warning`, `poll_error`, `no_notifications`, `source_http_retry`, `source_http_deferred`, `source_http_cooldown`, `source_complete`, `source_failed`, `delivery_queue`, `notification_sent`, `notification_rejected`, `delivery_deferred`, `poll_complete`, `webhook_test_confirmed` and `webhook_test_failed`.

### Observed deployment issue

In [the Nov 17, 2026 production run](https://github.com/thomastran117/discord-work-bot/actions/runs/44024277333), 13 of 15 sources completed, 19 Discord notifications were delivered, and both Ciena and RBC returned HTTP 429. Nokia returned 70 postings but none passed the classifier. These are run-specific observations, not permanent source health or evidence that all eligible openings were found. Ciena and RBC remain configured; disable them in `config/careers.json` if the rate-limit problem persists.
