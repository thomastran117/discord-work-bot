# Contributing

Thank you for helping improve Discord Work Bot. The project focuses on useful Canadian early-career software engineering opportunities, minimal operational overhead and respectful source access.

## Development

Use Node.js 24.x. No third-party packages are required. Run commands from the repository root:

~~~sh
npm test
npm run preview
~~~

The tests run offline; preview performs live read-only source searches but neither sends Discord messages nor modifies SQLite. On Linux or macOS with Bash, Git and Python 3, also run:

~~~sh
bash test/workflow-state.test.sh
~~~

Never commit `.env`, webhook URLs, database files or private source data. Use fictional fixtures and mocked requests in tests. A real webhook should not be needed for CI.

## Adding a source

1. Check that the provider permits access and the intended reuse of its listings.
2. For an existing Greenhouse, Lever or Ashby provider, prefer adding a board to `config/boards.json`.
3. For a new provider, implement the `JobSource` contract in `src/sources/`, receive the shared SourceHttpClient and validate upstream formats. Never create a separate retry loop to bypass host cooldowns.
4. Return stable source and external identifiers, real HTTPS application URLs and location metadata. Application links must use public hostnames rather than localhost, IP literals, credentials or custom ports. Do not invent dates or classify every generic role as new grad.
5. Keep pagination, response sizes, request budgets and retries bounded; do not circumvent redirect, rate-limit or access controls.
6. Add offline tests for valid, empty, malformed and closed/ineligible listings where applicable, and document new configuration in [the source guide](docs/sources.md).
7. Run preview and inspect counts and error logs before enabling production monitoring.

## Pull requests

Create a focused branch from the default branch. Include the purpose, changes, relevant tests, live verification status and any risks. Keep new sources configurable and preserve existing notification state. The CI workflow runs the Node tests plus a local Git/SQLite state test.

Avoid making live webhook requests in tests or resetting the shared state branch. If a feature requires a live sample, use a dedicated test channel or the local `npm run test:webhook` command. See [operations](docs/operations.md) for deployment and [architecture](docs/architecture.md) for the pipeline.
