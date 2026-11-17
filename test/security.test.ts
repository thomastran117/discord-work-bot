import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("build and workflow dependencies use immutable references", () => {
  const workflows = [".github/workflows/ci.yml", ".github/workflows/job-bot.yml"]
    .map(path => readFileSync(path, "utf8")).join("\n");
  const actions = [...workflows.matchAll(/uses:\s+([^\s#]+)/g)].map(match => match[1]);
  assert.ok(actions.length > 0);
  for (const action of actions) assert.match(action, /^[^@]+@[0-9a-f]{40}$/);
  assert.doesNotMatch(workflows, /runs-on:\s+ubuntu-latest/);

  const dockerfile = readFileSync("Dockerfile", "utf8");
  assert.match(dockerfile, /^FROM\s+node:24-bookworm-slim@sha256:[0-9a-f]{64}$/m);
});

test("container runtime is read-only and drops privileges", () => {
  const compose = readFileSync("docker-compose.yml", "utf8");
  assert.match(compose, /read_only:\s+true/);
  assert.match(compose, /cap_drop:\s*\r?\n\s+- ALL/);
  assert.match(compose, /no-new-privileges:true/);
});
