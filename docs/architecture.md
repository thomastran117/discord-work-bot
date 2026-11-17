# Architecture

[Back to README](../README.md)

The application is a modular Node.js 24/TypeScript service with native fetch, node:sqlite and the Node test runner. It runs as a one-shot process in GitHub Actions or as a long-running local/Docker service. There is no dedicated HTTP server or Discord gateway connection.

## Data flow

~~~mermaid
flowchart TD
    A[GitHub Actions or local scheduler] --> B[Load source configuration]
    B --> C[Fetch and normalize postings]
    C --> D[Filter Canadian early-career SWE roles]
    D --> E[Extract metadata]
    E --> F{Preview?}
    F -- Yes --> G[Log matches]
    F -- No --> H[Ingest and deduplicate in SQLite]
    H --> I[Read pending notification queue]
    I --> J[Publish Discord webhook card]
    J --> K[Record confirmed message ID]
    K --> L[Close database and save state in Actions]
~~~

The webhook-test mode skips this pipeline entirely and sends one fictional sample card.

## Modules

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | CLI modes, configuration assembly, scheduler and graceful shutdown |
| `src/config.ts` | Environment parsing and source configuration validation |
| `src/models/job.ts` | Normalized job, board and source contracts |
| `src/sources/` | SimplifyJobs, public ATS, curated and career-site adapters |
| `src/services/classifier.ts` | Canadian location, technical role and experience heuristics |
| `src/services/enrichment.ts` | Extract explicit start-date metadata |
| `src/services/identity.ts` | URL normalization and provider-specific identities |
| `src/services/aggregator.ts` | Source isolation, ingestion, preview and delivery orchestration |
| `src/services/discord.ts` | Webhook validation, embed construction and delivery |
| `src/repositories/jobs.ts` | SQLite schema, transactions and notification queue |
| `src/utils/` | HTTP retries, parsing helpers and structured JSON logs |
| `scripts/workflow-state.sh` | Restore and save the Git-backed database snapshot |
| `test/` | Offline fixture, pipeline and workflow-state regression tests |

## Normalized model

Adapters implement `JobSource` with a stable name and `fetchJobs(): Promise<Job[]>`. They provide an external ID, title, company, locations and application URL; optional fields include description, employment type, early-career signal, posted date, start date and requisition key.

Jobs are normalized and bounded before classification. Application links must use HTTPS, cannot contain credentials or custom ports, and cannot target literal IP or localhost addresses. Bidirectional text controls are removed from display metadata. The classifier runs before full descriptions are removed from normalized records. Start-date metadata is kept internally but intentionally omitted from Discord cards. A job card displays its employer, clickable role, Canadian locations, destination hostname, source and a native View posting link (when the URL fits the button limit).

## Persistence and identity

SQLite contains five main tables:

| Table | Purpose |
| --- | --- |
| `jobs` | Canonical notification payload, first seen time, state and delivery confirmation |
| `identities` | Unique source IDs, normalized URL identities and optional requisition keys mapped to jobs |
| `sources` | Initialized source names, enabling per-source first-run behaviour |
| `source_cooldowns` | Per-host retry-not-before timestamps (additive migration) |
| `delivery_rejections` | Permanently invalid Discord payloads excluded from later queue reads |

Ingestion is transactional. The system prefers known identifiers, strips common tracking parameters and normalizes recognized ATS URL aliases. It does not merge ambiguous matches based on company and role alone. Aliases introduced after a job was stored may not be linked until the original posting is observed again.

~~~mermaid
stateDiagram-v2
    [*] --> seeded: First source poll in seed mode
    [*] --> pending: New job or publish mode
    seeded --> pending: Explicit backfill sees recent dated eligible job
    pending --> pending: Delivery fails or is deferred
    pending --> sent: Discord confirms message ID
    pending --> rejected: Discord rejects payload permanently
~~~

An empty but successful source response can initialize that source. A failed source does not initialize its first-run history. Backfill only requeues seeded jobs observed as eligible during the run with a known posting date in the 1–30 day window. Newly observed out-of-window or undated jobs are seeded. Already-sent records remain sent; existing pending jobs outside the window are deferred to ordinary polling. No schema migration is required. See [backfill rules](operations.md#backfill-rules).

## Delivery and reliability

Each poll fetches sources sequentially to limit load. Individual source failures are isolated. Source responses are restricted to 16 MiB and 25,000 raw rows, adapters may return at most 10,000 jobs, redirects are rejected, and normalized fields have explicit size and count limits. A shared source HTTP client paces requests per host, uses bounded exponential retry with jitter and honours Retry-After. Long waits or exhausted rate limits defer a host, with cooldown state saved to SQLite between production runs. See [operations](operations.md#source-retry-and-rate-limit-policy). The maximum number of pending jobs delivered per run is configurable. Discord uses `wait=true` to obtain a message ID before recording success; rate-limit responses and ambiguous network failures are deferred. Local payload validation failures and narrowly identified job-payload errors are quarantined so a single bad posting cannot block the queue. Destination, permission, webhook and thread-configuration errors remain pending and stop the pass so configuration fixes can recover delivery.

GitHub Actions serializes runs and restores SQLite from `bot-state` before executing the one-shot command. A final save step runs even after ordinary partial failures, uses SQLite backup and integrity checking, and does not overwrite divergent state. A runner crash, cancellation or failed save can still lose confirmations. Discord and SQLite/Git cannot participate in one atomic transaction, so exactly-once delivery is not guaranteed.

## Limitations and future work

- Heuristic filtering, incomplete employment type/location metadata and bounded career searches can miss or misclassify openings.
- Different application URLs for identical requisitions can evade deduplication; no fuzzy matching or general redirect resolution.
- No stale-pending expiry, closed-job reconciliation, rejected-job repair UI or automatic source-health alerts.
- No separate static TypeScript compiler/type-checking step; tests run with native Node type stripping.
- Git-backed state history can grow as jobs accumulate. Public state must remain free of secrets and restricted data.

Future improvements may include reliable employer interfaces with permission, bilingual matching, richer source-level health diagnostics, closure detection and static type checking.
