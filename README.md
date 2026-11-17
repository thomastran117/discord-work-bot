# Discord Work Bot

[![CI](https://github.com/thomastran117/discord-work-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/thomastran117/discord-work-bot/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-24-339933)
![License](https://img.shields.io/github/license/thomastran117/discord-work-bot)

A lightweight job aggregator that finds Canadian new-grad and early-career software engineering opportunities and posts them to a Discord channel. Runs every two hours on GitHub Actions, with no dedicated server or external database.

## Features

- 17 configured sources, including SimplifyJobs and direct employer career boards.
- Canadian location and early-career SWE filtering.
- Clickable Discord job cards with employer, title, location and source.
- Persistent SQLite deduplication, rate-limit-aware source retries and retryable notification delivery.
- Scheduled or manual polling, and bounded 1–30 day backfill.

## Quick start

### GitHub Actions (recommended)

1. Fork or use your own copy of this repository. Enable Actions if necessary.
2. Create a Discord webhook via **Edit Channel → Integrations → Webhooks**.
3. Add the webhook URL as the repository Actions secret `DISCORD_WEBHOOK_URL` under **Settings → Secrets and variables → Actions**.
4. Open **Actions → Canadian new-grad job bot → Run workflow** on your default branch. Use `poll` (default) to start monitoring, or select `backfill` with `backfill_days` set to 1–30 (default 7).

Scheduled runs execute automatically every two hours (best effort). First normal polls seed existing listings by default; subsequent polls send new jobs. Backfill only queues recent dated postings that have not been sent.

> **Important:** In a public repository, the `bot-state` branch and workflow logs are public. Never commit webhook secrets or delete the state branch. Review source terms before enabling collection.

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
