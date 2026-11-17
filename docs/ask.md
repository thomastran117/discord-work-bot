# Interactive search (/ask)

Railway cron and manual GitHub Actions use the same exclusive writer lock. On save it exports the last 30 days of public job metadata to jobs.json alongside jobs.db in the bot-state branch, atomically. It includes seeded, pending and sent jobs; delivery is independent of search. No descriptions, Discord message IDs or secrets are exported. An old state branch is automatically upgraded on the next successful save, even if no jobs change.

## Deployment on Railway

1. Run the Railway poller once or manually dispatch the poll workflow on the default branch after merging. Confirm bot-state contains jobs.json.
2. In the Discord Developer Portal, use your existing application or create one, install it in your server with the applications.commands scope, and copy the Application ID, Public Key and server ID (Developer Mode). An existing app does not need reinstalling.
3. In the same Railway project as the poller, add a second GitHub service from the same repository/default branch. Name it ask-service. Use the repository Dockerfile and override its start command with `npm run start:ask`. Leave Cron Schedule empty, keep one replica, disable Serverless/sleeping, and set restart policy On Failure or Always.
4. Set these variables on ask-service only:

| Variable | Value |
| --- | --- |
| DISCORD_PUBLIC_KEY | Discord application public key (64 hex characters) |
| DISCORD_APPLICATION_ID | Discord application ID |
| DISCORD_GUILD_ID | Allowed Discord server ID |
| JOBS_SNAPSHOT_URL | https://raw.githubusercontent.com/thomastran117x/discord-work-bot/bot-state/jobs.json |

Railway injects PORT; the server binds 0.0.0.0. Set the healthcheck path to /health, generate a public domain in Networking, and deploy. Verify HTTPS GET /health returns an OK response. Do not set GH_TOKEN, DISCORD_WEBHOOK_URL or DISCORD_BOT_TOKEN here. Do not configure a cron schedule on this service.

5. In Discord's application General Information settings, replace the Interactions Endpoint URL with the Railway public HTTPS domain followed by /interactions. Discord sends a signed PING to validate it. If migrating an existing command, test /ask before deleting the old Cloudflare Worker; no re-registration is necessary if the application, guild and command options are unchanged.
6. For first-time registration only, put DISCORD_APPLICATION_ID, DISCORD_GUILD_ID and DISCORD_BOT_TOKEN in your untracked local .env, then run:

~~~sh
npm run register:ask
~~~

For local endpoint development, add DISCORD_PUBLIC_KEY and JOBS_SNAPSHOT_URL to .env and run `npm run start:ask` (default port 8080). Discord needs a public HTTPS endpoint for real interactions. The ordinary unit tests do not require Discord credentials.

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
- A one-minute in-memory snapshot cache and per-service request coalescing reduce raw GitHub requests. Invalid or unavailable indexes yield a clear error, not an empty result. The ask service has no write permissions and does not need the bot token.
- The snapshot is public, like the existing bot-state branch. Private repositories are not supported by this deployment. Search uses a bounded index, not a managed database. Git retains old snapshots in branch history.
- If registration succeeds but no results appear, check the index and the poll logs; the first saved poll after merge creates the index. A new source may not have historical data. If Discord rejects the endpoint, verify the key and URL.
- Railway and Discord configuration must be completed by an operator. The service remains running so hosting usage is continuous; Railway plan quotas apply. It acknowledges commands before fetching and bounds request bodies, concurrent deferred searches and upstream timeouts. Healthchecks test HTTP availability, not upstream index freshness.
