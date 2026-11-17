# Discord Work Bot

A small Node.js 24/TypeScript service for Canadian full-time new-grad and early-career software engineering roles. No bot token, database server or third-party npm packages are required.

## Quick start

Prerequisites: Node.js 24 or Docker Compose.

1. Copy .env.example to .env (PowerShell: Copy-Item .env.example .env).
2. In Discord, open channel settings → Integrations → Webhooks, create a webhook, and set DISCORD_WEBHOOK_URL in .env. Treat it as a secret.
3. Run the commands below from the repository root.

~~~sh
npm test
npm run preview
npm run once
npm start
~~~

Preview performs real source GET requests but never sends messages or writes SQLite. The first normal run defaults to seeding existing eligible jobs silently, separately for each source. New jobs are sent on later polls. Set FIRST_RUN_MODE=publish **before the first normal run** to announce existing jobs instead. Changing it later does not replay seeded jobs. Notifications are capped at 25 per run by default. The service polls immediately, then every 120 minutes while running, skipping overlapping runs.

Docker: after creating .env, run `docker compose up --build -d`; inspect logs with `docker compose logs -f job-bot`. SQLite persists in a named volume. Run only one instance against each database/webhook. Set DATABASE_PATH to a location under /app/data for Docker persistence. No ports are exposed.

## GitHub Actions (recommended hosted deployment)

No VPS, Docker service or always-running process is needed. Merge the workflow into the default branch, then navigate to **Settings → Secrets and variables → Actions → New repository secret** and create `DISCORD_WEBHOOK_URL` with your Discord webhook. Never add the webhook to a repository variable or workflow file.

1. Open **Actions → Canadian new-grad job bot → Run workflow** on the default branch. Keep **preview** checked for a read-only live-source check.
2. Run the workflow again with **preview** unchecked. The first normal poll creates the state branch and seeds existing postings by default.
3. The scheduled workflow runs at minute 17 of every even UTC hour (`17 */2 * * *`). GitHub can delay scheduled jobs; exact two-hour delivery is not guaranteed.

Optional repository Actions variables: `FIRST_RUN_MODE` (seed or publish, default seed) and `MAX_NOTIFICATIONS_PER_RUN` (default 25). Enable publishing existing jobs before the initial run if desired. Scheduled runs use the default branch's board configuration. Do not run the production workflow and a local bot against the same Discord channel independently.

### Persistent state

GitHub-hosted runners are ephemeral, so each production run restores `jobs.db` from an automatically created, dedicated `bot-state` Git branch, invokes `npm run once`, and saves the SQLite snapshot even if the polling command reports a partial failure. The branch contains only the database snapshot, not application code. The workflow uses the built-in GITHUB_TOKEN with contents write permission for the production job; preview and CI are read-only. No personal token is required unless repository policy prevents the normal token from writing. The workflow serializes production runs and avoids force-overwriting an existing state branch.

**Public repository:** the state branch and its history are public, as are workflow logs. The bot persists job metadata and Discord message IDs, not the webhook or full description text. Enable only sources whose terms permit this public storage and redistribution; use a private repository or external private state store if that is unsuitable. Do not copy a pre-existing local database with descriptions into this public branch.

Do not delete or manually edit the state branch. Deleting it resets deduplication and causes a fresh seed (or backfill if configured). If restoring an existing state branch fails, the workflow stops rather than using an empty database. The database is persisted after a completed polling step, including ordinary failures, but a runner crash or cancellation before persistence can cause duplicates or lost state changes. There is no atomic transaction spanning Discord and Git. Back up the state branch if continuity is important.

The separate CI workflow runs offline tests and a local bare-Git persistence test on pull requests and pushes to main. It does not access the webhook. Scheduled workflows in inactive public repositories may be disabled by GitHub after 60 days without activity; check the Actions tab if the bot stops.

## Sources

SimplifyJobs is enabled by default. The adapter reads the public New-Grad-Positions repository's JSON list, not its rendered README. Attribution: [SimplifyJobs / Coder Quad](https://github.com/SimplifyJobs/New-Grad-Positions). Verify source terms and permission for your use before operating; disable with SIMPLIFY_ENABLED=false if necessary. Upstream schema and availability may change.

Optional employer boards: edit config/boards.json (empty by default) with objects of the following form. Replace example board slugs with actual employer board identifiers; these examples are not real registrations.

~~~json
[
  {"provider":"greenhouse","company":"Example Tech","board":"example-tech"},
  {"provider":"lever","company":"Example Cloud","board":"example-cloud","region":"global"},
  {"provider":"ashby","company":"Example Data","board":"example-data"}
]
~~~

Official public endpoints: [Greenhouse](https://developers.greenhouse.io/job-board.html), [Lever](https://github.com/lever/postings-api), [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api). Only enable boards whose terms permit your use. No login bypass, browser automation, or private data access. Each board is a separate source, fetched sequentially with timeouts and bounded retries.

## Behaviour and limitations

- Discord embeds show title (clickable application link), employer, Canadian locations, starting term and source. Missing start dates show "Not specified"; posting and graduation dates are not treated as start dates.
- Canadian locations and early-career SWE roles are identified by conservative rules. Generic remote jobs, internships/co-ops and senior titles are excluded. City-only ambiguity and false negatives remain possible.
- Simplify has no full descriptions by default, so term extraction is limited to its title and any explicit structured date. Employer-board descriptions improve coverage. Date extraction is heuristic.
- SQLite stores pending, seeded and sent jobs; source IDs, canonical URLs and known ATS URL identities prevent many duplicates. Different employer URLs for the same role may still duplicate. No fuzzy deduplication or closed-role reconciliation in v0.1.
- On failed Discord delivery, pending jobs remain queued for the next poll. If Discord accepts a request but the service does not record its message ID, the next poll can duplicate it. Pending jobs are not revalidated for closure before sending.
- An empty successful first poll initializes that source. To avoid missed initial jobs, inspect preview before seeding. The default seed policy is per source, not per process.
- Source failures are logged without stopping the remaining sources. One-shot runs exit nonzero on failures. Logs contain posting URLs in preview, never the Discord webhook.
- Development uses native TypeScript type stripping (Node 24); the prototype has no separate TypeScript compiler or type-checking step. SQLite uses Node's built-in node:sqlite API.

## Structure

~~~text
src/
  models/        Normalized job and source contracts
  sources/       SimplifyJobs and employer ATS adapters
  services/      Classification, term extraction, identity, Discord and orchestration
  repositories/  SQLite persistence
  utils/         HTTP and logging
  config.ts      Environment and board config
  index.ts       CLI, scheduler and lifecycle
test/            Offline unit/integration tests
~~~

## Environment

See .env.example. POLL_INTERVAL_MINUTES defaults to 120. MAX_NOTIFICATIONS_PER_RUN defaults to 25. FIRST_RUN_MODE defaults to seed. Use npm run preview for a safe first check; use npm run once for a single real poll.

## Next steps

Add additional Canadian-specific sources after verifying their schemas and terms, improve bilingual/location classification, enrich linked descriptions only where permitted, add source health alerts and closure reconciliation, and add static type checking.
