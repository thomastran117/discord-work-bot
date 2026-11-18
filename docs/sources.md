# Job sources

[Back to README](../README.md)

The default configuration contains 18 sources: SimplifyJobs, 12 public ATS employer boards and five direct employer career sites. With the mechanical webhook enabled, AECOM, CIMA+, LAPORTE, Promise Robotics, Elk Valley Resources, DIALOG and Systemex are also polled (25 default sources). There are three optional curated adapters (28 supported in total). These are configuration counts, not a guarantee that every integration is reachable or has current vacancies.

## Default sources

| Provider | Employers / feed |
| --- | --- |
| SimplifyJobs | [New-Grad Positions / Coder Quad](https://github.com/SimplifyJobs/New-Grad-Positions) |
| [Greenhouse](https://developers.greenhouse.io/job-board.html) | Affirm, DoorDash Canada board, Faire, Robinhood, Stripe; [LAPORTE](https://job-boards.greenhouse.io/englishcanada) (mechanical opt-in) |
| [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api) | Cerebras, Cohere, Wealthsimple, Zip |
| [Lever](https://github.com/lever/postings-api) | Achievers, Apply Digital, Waabi; [Promise Robotics](https://jobs.lever.co/promiserobotics), [Elk Valley Resources](https://jobs.lever.co/evr), [DIALOG](https://jobs.lever.co/dialogdesign), [Systemex](https://jobs.lever.co/systemex) (mechanical opt-in) |
| Workday | [Ciena](https://ciena.wd5.myworkdayjobs.com/Careers), [RBC](https://rbc.wd3.myworkdayjobs.com/RBCGLOBAL1), [Autodesk](https://autodesk.wd1.myworkdayjobs.com/Ext) |
| Oracle Recruiting Cloud | [Nokia](https://jobs.nokia.com/en/sites/CX_1/jobs) |
| [SmartRecruiters](https://developers.smartrecruiters.com/docs/endpoints) | [SAP](https://jobs.sap.com/en/jobs/) |

SimplifyJobs is read from the upstream public JSON feed, not the Simplify dashboard. The feed is filtered locally by Canadian geography; explicit inactive/hidden rows are excluded, while active rows with absent visibility metadata remain eligible. The `simplify_discovery` event shows raw/status/location counts before classification, with date-window breakdowns logged by the aggregator. Dashboard-only jobs may be absent from this feed. Stripe is also polled through its public Greenhouse board. Greenhouse uses `first_published` when supplied; missing dates remain unknown and `updated_at` is never used as a publication date. The ATS integrations use public job-board endpoints, not browsing or login automation. Source requests must use HTTPS and do not follow redirects. Upstream schemas, job availability, and access policies can change.

### Configure public ATS boards

Edit [`config/boards.json`](../config/boards.json). Each entry represents a separate source. Copy an entry and replace the provider, display name and actual board identifier; a company display name is not necessarily its board identifier.

~~~json
[
  { "provider": "greenhouse", "company": "Affirm", "board": "affirm" },
  { "provider": "ashby", "company": "Wealthsimple", "board": "wealthsimple" },
  { "provider": "lever", "company": "Waabi", "board": "waabi", "region": "global" }
]
~~~

The example is a subset of the current configuration, not a replacement for the full file. Valid providers are `greenhouse`, `ashby` and `lever`; for Lever use `region: "eu"` when applicable. Remove unwanted boards from the array. Verify board availability and permissions before adding one.

### Direct employer career sites

Edit [`config/careers.json`](../config/careers.json).

~~~json
[
  { "id": "ciena", "enabled": true },
  { "id": "rbc", "enabled": true },
  { "id": "nokia", "enabled": true },
  { "id": "sap", "enabled": true },
  { "id": "autodesk", "enabled": true },
  { "id": "aecom", "enabled": true },
  { "id": "cima", "enabled": true }
]
~~~

- Workday uses a read-only search POST (never an application submission) and GET detail requests. The search is limited to six keywords (ten when mechanical is enabled), ten pages of up to 20 results per keyword, and 36 detail requests per employer. Results may be incomplete; RBC targets the main external board, not a separate early-talent board. Autodesk uses the external Workday `Ext` site; its explicit `CAN` location markers are normalized before classification.
- Nokia uses the Oracle Candidate Experience Canada location filter and paginated requisition summaries (up to 12 search pages). Missing location or experience evidence can exclude relevant roles.
- SAP uses the documented SmartRecruiters public Posting API for the `SAPITBusinessSysteme` tenant, identified from SAP's current careers application links. It requests Canadian postings (up to six pages of 50), retrieves details for up to 25 technical candidates, and uses structured country, employment and experience metadata. SAP is migrating career sites; roles present only on its [legacy site](https://careers.sap.com/go/Canada/8806801/) or other tenants are not covered. The live API request has not been verified end-to-end.
- AECOM and CIMA+ reuse the bounded SmartRecruiters adapter (configured tenants `AECOM2` and `CIMA2`). Both boards responded in the Nov 17, 2026 backfills, but yielded no eligible mechanical jobs; the CIMA+ general listing reported 559 postings and reached its 300-row cap. When mechanical is enabled, these two boards use six additional documented keyword queries (up to three pages each), deduplicate candidates before detail fetches and reserve detail capacity for both streams. These boards are skipped when the mechanical webhook is unset (except preview). Disable either in careers.json if incompatible or blocked.
- Workday has a 240-second per-employer deadline; Oracle and SmartRecruiters have 120 seconds. The shared HTTP policy spaces requests and respects throttling across all providers. These browser-facing services are not stable, supported third-party API contracts. Ciena and RBC have returned HTTP 429 in GitHub Actions; Nokia's search has returned results, though no roles matched in that run. See [operations](operations.md#observed-deployment-issue).

Do not bypass access restrictions. Set `enabled: false` on a career source if it is blocked, not permitted or needs investigation.

## Optional community feeds

These adapters are disabled by default. Enable only after reviewing the upstream licence, terms and permission to redistribute job metadata. Edit [`config/feeds.json`](../config/feeds.json).

| Feed ID | Upstream list |
| --- | --- |
| `vansh-canada` | [Vansh New-Grad 2027 Canada](https://github.com/vanshb03/New-Grad-2027/blob/dev/Canada.md) |
| `grind-canada` | [Grind Canadian new-grad SWE](https://github.com/grind-fyi/Software-NewGrad-Canada) |
| `intern-radar` | [Intern Radar Canadian new-grad roles](https://github.com/Francklin9999/canada-internship/blob/master/NEW_GRAD.md) |

~~~json
[
  { "id": "vansh-canada", "enabled": false },
  { "id": "grind-canada", "enabled": false },
  { "id": "intern-radar", "enabled": false }
]
~~~

The parser reads raw Markdown tables, recognizes closed listings and handles provider-specific link formats. Vansh and Grind use intermediary links, which may prevent cross-source URL deduplication. No redirects are resolved for enrichment. Application links must use HTTPS and their destination hostname is shown on each Discord card; this makes source provenance visible but does not guarantee that a third-party destination is trustworthy. Grind is rebuilt daily; polling every two hours will not make it real-time. Its rows require explicit early-career title evidence rather than assuming every row is appropriate.

## Matching policy

All sources pass a shared Canadian location and discipline classifier. Mechanical assessment recognizes EIT, graduate, trainee, French/abbreviated titles and experience ranges; ambiguous engineering roles still require mechanical degree evidence. Mechanical-focused public ATS boards use `mechanicalFocus: true` to activate only when the mechanical feed is enabled (or in preview). Their live API availability has not been verified, even where public career pages are visible. Curated feeds can supply an early-career signal; direct employers also use titles and description evidence. Internships, co-ops, explicitly senior and other excluded roles are rejected. SWE level II/2 titles are accepted with an explicitly early-career title (e.g. Google Software Developer 2 – Early Career) or an available description stating a 0–2 year experience minimum. Generic level II roles lacking this evidence, higher levels and mechanical level II remain excluded. SWE matching also covers developer/programmer, software test automation, SDET, data/ML engineering and scientist roles; ambiguous QA/testing/data analyst titles require technical description evidence. Generic business roles remain excluded. Experience ranges use the lower endpoint; an explicit minimum of three or more years in the available description is excluded conservatively (including preferred requirements that cannot reliably be distinguished). This same policy applies to normal polls and backfills. Ambiguous locations and generic remote roles are conservatively filtered. This is heuristic: some suitable positions will be missed, and some non-target positions may pass. Full-time status is not guaranteed when employment type is absent.

Adding a source initializes its own seed history. Preview locally first, then use poll or explicit bounded backfill (1–60 days). Sources without reliable posting dates are excluded from backfill, not ordinary incremental discovery. Existing deduplication history is preserved. The bot does not verify closures for queued jobs, contact application forms or submit applications.

## Use and attribution

Use only sources that permit your intended collection and redistribution, especially where the repository state is public. Links and source attribution are included on Discord cards. Full job descriptions are used for classification but omitted from newly persisted records. No authentication or CAPTCHA bypass is supported. If a provider rejects requests, stop or disable the relevant source instead of circumventing restrictions.
