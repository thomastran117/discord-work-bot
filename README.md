# Discord Work Bot

[![CI](https://github.com/thomastran117/discord-work-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/thomastran117/discord-work-bot/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-24-339933)
![License](https://img.shields.io/github/license/thomastran117/discord-work-bot)

A lightweight job aggregator that finds Canadian new-grad and early-career software engineering opportunities and posts them to a Discord channel. Runs every two hours as a Railway cron job, with manual polling/backfill in GitHub Actions and no dedicated database.

## Features

- 17 configured sources, including SimplifyJobs and direct employer career boards.
- Canadian location and early-career SWE filtering.
- Clickable Discord job cards with employer, title, location and source.
- Persistent SQLite deduplication, rate-limit-aware source retries and retryable notification delivery.
- Scheduled or manual polling, and bounded 1–30 day backfill.
- Optional Discord `/ask` command with structured filters and typo-tolerant company/location search.

## Quick start

### Railway (recommended)

1. Merge the deployment changes and ensure no old scheduled Actions run is active.
2. Create a Railway service connected to this repository and the default branch.
3. Configure the service to use the Dockerfile, start command `bash scripts/run-job.sh poll`, cron schedule `17 */2 * * *` (UTC), one replica, and restart policy Never. Do not expose a port or add a healthcheck.
4. Set Railway variables `DISCORD_WEBHOOK_URL`, `GH_TOKEN` (a fine-grained GitHub token with Contents read/write for this repository only), and `STATE_REPOSITORY` (owner/repo). See [deployment and operations](docs/operations.md) for details.

### GitHub Actions (manual fallback)

Add `DISCORD_WEBHOOK_URL` as a repository Actions secret. Under **Actions → Canadian new-grad job bot → Run workflow**, select `poll` or `backfill` (1–30 days, default 7). Both execution hosts share the existing state and an exclusive lock. Do not run legacy workflow revisions that bypass the lock.

First normal polls seed existing listings by default; subsequent polls send new jobs. Backfill queues recent dated postings not previously sent.

> In a public repository, the `bot-state` branch and workflow logs are public. Never commit secrets or delete the state branch.

### Interactive search (optional)

Deploy a lightweight Discord interaction endpoint and register `/ask` in your server. The scheduled poller runs on Railway; queries read the same public, bounded job index without polling sources. See [the setup guide](docs/ask.md).

### Local development

Requires Node.js 24. No third-party npm packages are required.

~~~sh
git clone https://github.com/thomastran117/discord-work-bot.git
cd discord-work-bot
cp .env.example .env
npm test
npm run preview
~~~

On PowerShell, use `Copy-Item .env.example .env` instead of `cp`. Set `DISCORD_WEBHOOK_URL` in `.env` before running `npm run test:webhook` or `npm start`.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Deployment and operations](docs/operations.md) | GitHub Actions, Docker, CLI, environment variables and troubleshooting |
| [Job sources](docs/sources.md) | Employer watchlist, curated feeds, source configuration and known limitations |
| [Architecture](docs/architecture.md) | Data flow, classification, deduplication, delivery and persistent state |
| [Contributing](CONTRIBUTING.md) | Development workflow, adapters, tests and PR guidelines |

## License

[MIT](LICENSE).
