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

Preview performs real source GET requests but never sends messages or writes SQLite. The first normal run defaults to seeding existing eligible jobs silently, separately for each source. New jobs are sent on later polls. Set FIRST_RUN_MODE=publish **before the first normal run** to announce existing jobs instead. Changing it later does not replay seeded jobs; use `npm run backfill` to queue currently eligible seeded jobs without replaying sent jobs. Use `npm run test:webhook` to send one clearly labelled sample job card without scraping or modifying state. Notifications are capped at 25 per run by default. The service polls immediately, then every 120 minutes while running, skipping overlapping runs.

Docker: after creating .env, run `docker compose up --build -d`; inspect logs with `docker compose logs -f job-bot`. SQLite persists in a named volume. Run only one instance against each database/webhook. Set DATABASE_PATH to a location under /app/data for Docker persistence. No ports are exposed.

## GitHub Actions (recommended hosted deployment)

No VPS, Docker service or always-running process is needed. Merge the workflow into the default branch, then navigate to **Settings → Secrets and variables → Actions → New repository secret** and create `DISCORD_WEBHOOK_URL` with your Discord webhook. Never add the webhook to a repository variable or workflow file.

1. Open **Actions → Canadian new-grad job bot → Run workflow** on the default branch. Select `preview` for a read-only live-source check.
2. Select `test-webhook` to send one clearly labelled sample card (not a real job) and confirm that the webhook targets the expected channel. This does not read or modify SQLite.
3. Select `backfill` to queue and deliver currently eligible seeded jobs and newly discovered jobs. Already-sent jobs are not requeued. Delivery respects the per-run cap; remaining pending jobs are delivered on subsequent normal polls.
4. Select `poll` for normal delivery; the first normal poll seeds existing jobs by default.
5. The scheduled workflow runs at minute 17 of every even UTC hour (`17 */2 * * *`). GitHub can delay scheduled jobs; exact two-hour delivery is not guaranteed.

Optional repository Actions variables: `FIRST_RUN_MODE` (seed or publish, default seed) and `MAX_NOTIFICATIONS_PER_RUN` (default 25). Enable publishing existing jobs before the initial run if desired, or use the explicit backfill mode after seeding. A normal run with zero pending jobs is successful and logs `no_notifications`; the webhook is not contacted. Use the test mode to distinguish an empty queue from a webhook failure. Scheduled runs use the default branch's board configuration. Do not run the production workflow and a local bot against the same Discord channel independently.

### Persistent state

GitHub-hosted runners are ephemeral, so each production run restores `jobs.db` from an automatically created, dedicated `bot-state` Git branch, invokes `npm run once`, and saves the SQLite snapshot even if the polling command reports a partial failure. The branch contains only the database snapshot, not application code. The workflow uses the built-in GITHUB_TOKEN with contents write permission for the production job; preview, webhook test and CI have read-only repository permissions. No personal token is required unless repository policy prevents the normal token from writing. The workflow serializes production runs and avoids force-overwriting an existing state branch.

**Public repository:** the state branch and its history are public, as are workflow logs. The bot persists job metadata and Discord message IDs, not the webhook or full description text. Enable only sources whose terms permit this public storage and redistribution; use a private repository or external private state store if that is unsuitable. Do not copy a pre-existing local database with descriptions into this public branch.

Do not delete or manually edit the state branch. Deleting it resets deduplication and causes a fresh seed (or backfill if configured). If restoring an existing state branch fails, the workflow stops rather than using an empty database. The database is persisted after a completed polling step, including ordinary failures, but a runner crash or cancellation before persistence can cause duplicates or lost state changes. There is no atomic transaction spanning Discord and Git. Back up the state branch if continuity is important.

The separate CI workflow runs offline tests and a local bare-Git persistence test on pull requests and pushes to main. It does not access the webhook. Scheduled workflows in inactive public repositories may be disabled by GitHub after 60 days without activity; check the Actions tab if the bot stops.

## Sources

SimplifyJobs is enabled by default. The adapter reads the public New-Grad-Positions repository's JSON list, not its rendered README. Attribution: [SimplifyJobs / Coder Quad](https://github.com/SimplifyJobs/New-Grad-Positions). Verify source terms and permission for your use before operating; disable with SIMPLIFY_ENABLED=false if necessary. Upstream schema and availability may change.

Eleven employer boards are configured by default in `config/boards.json`, bringing the default total to 15 including SimplifyJobs and the three direct employer career integrations below. Board identifiers were checked against employer posting pages or public API responses. The list is a watchlist, not a guarantee of current new-grad openings or permission to redistribute. Remove boards from the file if they are unsuitable or their terms do not permit use.

| ATS | Employer watchlist |
| --- | --- |
| Greenhouse | Affirm, DoorDash Canada, Faire, Robinhood |
| Ashby | Cerebras, Cohere, Wealthsimple, Zip |
| Lever | Achievers, Apply Digital, Waabi |

Add or remove employer boards in `config/boards.json` with objects of the following form. Replace example board slugs with actual employer board identifiers; these examples are not real registrations.

~~~json
[
  {"provider":"greenhouse","company":"Example Tech","board":"example-tech"},
  {"provider":"lever","company":"Example Cloud","board":"example-cloud","region":"global"},
  {"provider":"ashby","company":"Example Data","board":"example-data"}
]
~~~

Official public endpoints: [Greenhouse](https://developers.greenhouse.io/job-board.html), [Lever](https://github.com/lever/postings-api), [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api). Only enable boards whose terms permit your use. No login bypass, browser automation, or private data access. Each board is a separate source, fetched sequentially with timeouts and bounded retries. A source error does not prevent the other sources from being ingested.

### Ciena, RBC and Nokia direct career pages

Three further sources are enabled in `config/careers.json` (override the path with `CAREERS_PATH`):

| Employer | Career interface |
| --- | --- |
| Ciena | [Workday Careers](https://ciena.wd5.myworkdayjobs.com/Careers) |
| RBC | [Workday RBCGLOBAL1](https://rbc.wd3.myworkdayjobs.com/RBCGLOBAL1) ([RBC careers](https://jobs.rbc.com/ca/en)) |
| Nokia | [Oracle Candidate Experience, Canada](https://jobs.nokia.com/en/sites/CX_1/jobs?location=Canada&locationId=300000000471544&locationLevel=country&mode=location) |

Workday uses a read-only search POST, followed by GET details for technical roles in Canada or with multiple/unknown locations. Search keywords, pagination (10 pages per keyword), detail requests (36 per employer) and a per-employer network deadline are bounded; caps can miss postings. RBC's main external board is used, not a separate early-talent board. Nokia uses the public candidate site search's Canada location identifier and paginated requisition summaries; insufficient description/location metadata can cause matches to be missed. Workday and Nokia identifiers improve cross-source duplicate detection, but older stored URL identities may only be linked when the original source sees the same job again.

These are browser-facing career services rather than guaranteed third-party integration contracts. The exact live JSON requests and RBC board coverage have not been confirmed end-to-end. Review employer terms before use, run preview, and disable an employer by setting enabled to false if blocked, unsupported or not permitted. No CAPTCHA, authentication or access-control bypass is implemented.

### Optional Canadian curated feeds

Three additional adapters read the upstream Markdown tables, not their rendered websites:

| Feed ID | Public list |
| --- | --- |
| vansh-canada | [Vansh / New-Grad-2027 Canada](https://github.com/vanshb03/New-Grad-2027/blob/dev/Canada.md) |
| grind-canada | [Grind Canadian new-grad SWE](https://github.com/grind-fyi/Software-NewGrad-Canada) |
| intern-radar | [Intern Radar Canadian new-grad roles](https://github.com/Francklin9999/canada-internship/blob/master/NEW_GRAD.md) |

They are disabled by default because the upstream lists or linked listings may have reuse restrictions. After checking permission, set the corresponding `enabled` property to true in `config/feeds.json` (override path with `FEEDS_PATH`). Vansh and Grind use intermediary links, so cross-source duplicates may escape exact URL matching; no redirect requests or downstream scraping are performed. Grind is rebuilt daily, so polling it every two hours does not make that source real-time. The Grind parser requires explicit early-career evidence in the title because the upstream feed can include other levels. Other curated entries still pass SWE, Canada and senior/intern exclusions. Markdown table changes can require adapter maintenance.

A newly enabled source is seeded quietly on its first successful normal run (default `FIRST_RUN_MODE=seed`); other sources keep their existing state. Use preview to check counts first. Explicit backfill queues eligible seeded jobs and respects the existing notification cap. Do not delete the state branch.

## Behaviour and limitations

- Discord job cards use a blue accent, prominent employer and clickable job title, a full-width Canadian location field, a friendly source footer and a native View posting link button. Very long application URLs use the clickable title only. Start dates are intentionally omitted from cards; existing start-date metadata remains available internally and in dry-run logs.
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
  sources/       SimplifyJobs, employer ATS and curated Markdown adapters
  services/      Classification, term extraction, identity, Discord and orchestration
  repositories/  SQLite persistence
  utils/         HTTP and logging
  config.ts      Environment and board config
  index.ts       CLI, scheduler and lifecycle
test/            Offline unit/integration tests
~~~

## Environment

See .env.example. BOARDS_PATH and FEEDS_PATH select employer and curated-feed configuration. POLL_INTERVAL_MINUTES defaults to 120. MAX_NOTIFICATIONS_PER_RUN defaults to 25. FIRST_RUN_MODE defaults to seed. Use npm run preview for a safe first check; use npm run once for a single real poll.

## Next steps

Add more employer sources (e.g. additional Workday tenants or other approved APIs) after verifying their schemas and terms, improve bilingual/location classification, enrich linked descriptions only where permitted, add source health alerts and closure reconciliation, and add static type checking.
