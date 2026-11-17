# Interactive search (/ask)

Railway cron and manual GitHub Actions use the same exclusive writer lock. On save it exports the last 30 days of public job metadata to jobs.json alongside jobs.db in the bot-state branch, atomically. It includes seeded, pending and sent jobs; delivery is independent of search. No descriptions, Discord message IDs or secrets are exported. An old state branch is automatically upgraded on the next successful save, even if no jobs change.

## Deployment

1. Run the Railway cron once or manually dispatch the poll workflow on the default branch after merging. Confirm bot-state contains jobs.json. The index reflects the last saved data, not a live employer search.
2. Create an application in the Discord Developer Portal. Copy its Application ID and Public Key, and create a bot token. Enable Guild Install with the applications.commands scope (and bot if required by your install configuration); install the app in your server. No privileged gateway intents or webhook changes are needed. Enable Developer Mode in Discord and copy your server ID.
3. Sign in to Cloudflare and run the following from the repository root. For a fork, update JOBS_SNAPSHOT_URL in wrangler.toml to that public repository's bot-state/jobs.json URL. The Worker only accepts public raw.githubusercontent.com snapshot URLs.

~~~sh
npx wrangler login
npx wrangler deploy
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_GUILD_ID
~~~

4. Set the Discord application's Interactions Endpoint URL to the deployed Worker HTTPS URL followed by /interactions. Discord verifies it with a signed PING. The public key must be configured before this step.
5. Put DISCORD_APPLICATION_ID, DISCORD_GUILD_ID and DISCORD_BOT_TOKEN in your local untracked .env (never commit it), then run:

~~~sh
npm run register:ask
~~~

The command is guild-scoped. The bot token is needed only for registration; do not put it in the Worker or GitHub Actions. The existing DISCORD_WEBHOOK_URL continues to deliver automatic notifications. Redeploy the Worker and re-register if command options change.

## Usage

| Command | Result |
| --- | --- |
| /ask | All collected matches in 30 days |
| /ask days:7 | All collected matches in 7 days |
| /ask company:RBC days:3 | RBC matches in 3 days |
| /ask company:Nokia | Nokia matches in 30 days |
| /ask location:Ottawa | Ottawa matches in 30 days |
| /ask company:Ciena location:Ottawa days:7 | Combined filters |
| /ask company:SAP page:2 | Next page of the same search |

All four fields (company, location, days, page) are optional Discord slash-command options. Free-form questions are not accepted. Default is 30 rolling 24-hour days; allowed range 1–30. Results are private (ephemeral), newest first, five per page, with direct application links. Repeat the search with the same filters and the next page number.

Company and location are limited to 100 characters. Matching ignores case, accents and punctuation; direct partial matches and supported aliases take precedence. If no direct match exists for a field within the selected date range, the closest fuzzy matches are used (one edit for 4–7 characters, up to two for eight or more, including adjacent letter swaps). Short acronyms and province codes are matched directly, not fuzzily. Examples: Nokai → Nokia, Ottwa → Ottawa, Autodsk → Autodesk. Aliases include RBC / Royal Bank of Canada and Canadian province/territory abbreviations. Combined filters must both match; fuzzy matches are labelled in the response. Location matching is textual, not geocoding, and approximations can be ambiguous.

Publication dates are used where available. Undated jobs are included by first discovery time and explicitly labelled first seen; these are not evidence of an employer publishing within the window. Historical collection can be incomplete, jobs can close, and the bot only stores eligible Canadian early-career SWE roles. No result means no recorded match, not proof that a company has not posted. Queries never scrape sources or publish notification cards.

## Operations and security

- Discord signatures and timestamp freshness are verified before processing; only the configured guild can search. The command acknowledges immediately with a deferred private response, then edits it.
- A one-minute in-memory snapshot cache and per-isolate request coalescing reduce raw GitHub requests. Invalid or unavailable indexes yield a clear error, not an empty result. The Worker has no write permissions and does not need the bot token.
- The snapshot is public, like the existing bot-state branch. Private repositories are not supported by this deployment. Search uses a bounded index, not a managed database. Git retains old snapshots in branch history.
- If registration succeeds but no results appear, check the index and the poll logs; the first saved poll after merge creates the index. A new source may not have historical data. If Discord rejects the endpoint, verify the key and URL.
- Cloudflare account, Discord application configuration, and deployment must be done by an operator. Worker platform quotas apply.
