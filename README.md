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

Add additional Canadian-specific sources after verifying their schemas and terms, improve bilingual/location classification, enrich linked descriptions only where permitted, add source health alerts and closure reconciliation, and add CI/type checking.
