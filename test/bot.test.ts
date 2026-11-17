import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job, JobSource } from "../src/models/job.ts";
import { eligible, isCanadian } from "../src/services/classifier.ts";
import { extractStartDate } from "../src/services/enrichment.ts";
import { normalizeUrl, urlIdentity, normalizeJob } from "../src/services/identity.ts";
import { parseSimplify } from "../src/sources/simplify.ts";
import { parseBoard, boardUrl } from "../src/sources/ats.ts";
import { JobsRepository } from "../src/repositories/jobs.ts";
import { buildPayload, publishJob, webhookUrl, testWebhook } from "../src/services/discord.ts";
import { runAggregation } from "../src/services/aggregator.ts";

const job: Job = { source: "alpha", externalId: "1", title: "Software Engineer - New Grad", company: "Example", locations: ["Toronto, ON"], url: "https://job-boards.greenhouse.io/example/jobs/123" };
test("classifies Canadian SWE roles without generic remote or senior/intern roles", () => {
  assert.equal(eligible(job), true);
  assert.equal(eligible({ ...job, locations: ["Remote"] }), false);
  assert.equal(eligible({ ...job, title: "Senior Software Engineer", isNewGrad: true }), false);
  assert.equal(eligible({ ...job, title: "Software Engineer Intern", isNewGrad: true }), false);
  assert.equal(eligible({ ...job, title: "Backend Engineer", description: "0-2 years of professional experience" }), true);
  assert.equal(eligible({ ...job, title: "Backend Engineer", description: "New graduates welcome; 5 years of professional experience required" }), false);
  assert.equal(isCanadian("Vancouver, WA"), false);
  assert.equal(isCanadian("Remote - Canada"), true);
  assert.equal(isCanadian("Montréal, QC"), true);
});
test("start dates require context", () => {
  assert.equal(extractStartDate({ ...job, title: "Software Engineer - Summer 2027 Start" }), "Summer 2027");
  assert.equal(extractStartDate({ ...job, description: "Graduation by May 2027; start date: August 15, 2027" }), "August 15, 2027");
  assert.equal(extractStartDate({ ...job, description: "Must graduate in May 2027" }), undefined);
  assert.equal(extractStartDate({ ...job, description: "Flexible start date" }), "Flexible");
});
test("normalizes tracking parameters and ATS URLs while retaining job IDs", () => {
  assert.equal(normalizeUrl("https://example.com/apply?utm_source=a&job=3#x"), "https://example.com/apply?job=3");
  assert.equal(urlIdentity(job.url), urlIdentity("https://boards.greenhouse.io/example/jobs/123?gh_src=a"));
  assert.throws(() => normalizeUrl("javascript:alert(1)"));
  assert.deepEqual(normalizeJob({ ...job, locations: ["Toronto, ON", "Seattle, WA"] }).locations, ["Toronto, ON"]);
});
test("Simplify parser includes only visible active rows", () => {
  const row = { id: "1", company_name: "Example", title: job.title, locations: job.locations, url: job.url, active: true, is_visible: true, date_posted: 1700000000 };
  const parsed = parseSimplify([row, { ...row, active: false }, { ...row, is_visible: false }]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].isNewGrad, true);
  assert.equal(parsed[0].postedAt, "2023-11-14T22:13:20.000Z");
  assert.throws(() => parseSimplify({ error: true }));
});
test("ATS adapters normalize provider shapes", () => {
  const gh = { provider: "greenhouse" as const, company: "Example", board: "example" };
  assert.equal(parseBoard(gh, { jobs: [{ id: 123, title: job.title, location: { name: "Toronto" }, absolute_url: job.url, content: "&lt;p&gt;start&lt;/p&gt;" }] })[0].description, "start");
  const lever = { ...gh, provider: "lever" as const, region: "eu" as const };
  assert.match(boardUrl(lever), /api\.eu\.lever\.co/);
  assert.deepEqual(parseBoard(lever, [{ id:"l", text: job.title, categories: { location: "Toronto", allLocations: ["Ottawa"] }, hostedUrl: job.url }])[0].locations, ["Ottawa", "Toronto"]);
  const ashby = { ...gh, provider: "ashby" as const };
  assert.equal(parseBoard(ashby, { jobs: [{ id: "a", title: job.title, location: "Toronto", jobUrl: job.url, isListed: false }] }).length, 0);
});
test("SQLite persists deduplication and per-source initial seeding", () => {
  const dir = mkdtempSync(join(tmpdir(), "discord-work-test-"));
  const path = join(dir, "jobs.db");
  let db = new JobsRepository(path);
  try {
    assert.equal(db.ingest("alpha", [job], true).seeded, 1);
    assert.equal(db.pending(10).length, 0);
    const second = { ...job, externalId: "2", url: "https://boards.greenhouse.io/example/jobs/456" };
    assert.equal(db.ingest("alpha", [second], true).seeded, 0);
    assert.equal(db.ingest("beta", [{ ...second, source: "beta", externalId: "x", url: "https://job-boards.greenhouse.io/example/jobs/456" }], true).duplicates, 1);
    db.close();
    db = new JobsRepository(path);
    const pending = db.pending(10);
    assert.equal(pending.length, 1);
    db.markSent(pending[0].id, "message-id");
    assert.equal(db.pending(10).length, 0);
    assert.equal(db.ingest("alpha", [second], false).duplicates, 1);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("webhook payload includes required fields and disables mentions", async () => {
  const payload = buildPayload(job);
  assert.equal(payload.embeds[0].fields[1].value, "Not specified");
  assert.deepEqual(payload.allowed_mentions.parse, []);
  assert.throws(() => webhookUrl("https://example.com/api/webhooks/1/token"));
  const request = async (_url: URL | RequestInfo, init?: RequestInit) => {
    assert.equal(init?.method, "POST");
    return Response.json({ id: "42" });
  };
  assert.equal(await publishJob(webhookUrl("https://discord.com/api/webhooks/1/test-token"), job, request as typeof fetch), "42");
});
test("pipeline isolates source failures and retries persisted undelivered jobs", async () => {
  const db = new JobsRepository(":memory:");
  const sources: JobSource[] = [
    { name: "broken", async fetchJobs() { throw new Error("offline"); } },
    { name: "alpha", async fetchJobs() { return [job]; } }
  ];
  try {
    const options = { repository: db, seedFirst: false, maxNotifications: 10 };
    const first = await runAggregation(sources, { ...options, publish: async () => { throw new Error("unavailable"); } });
    assert.equal(first.failed, 1);
    assert.equal(first.deliveryFailed, true);
    assert.equal(db.pending(10).length, 1);
    const second = await runAggregation(sources, { ...options, publish: async () => "42" });
    assert.equal(second.delivered, 1);
    assert.equal(db.pending(10).length, 0);
    const preview = await runAggregation([sources[1]], { dryRun: true, seedFirst: false, maxNotifications: 10 });
    assert.equal(preview.matched, 1);
  } finally { db.close(); }
});

test("backfill queues current seeded jobs without replaying sent or absent jobs", async () => {
  const db = new JobsRepository(":memory:");
  const absent = { ...job, externalId: "absent", url: "https://example.com/absent" };
  const sent = { ...job, externalId: "sent", url: "https://example.com/sent" };
  try {
    db.ingest("alpha", [job, absent], true);
    db.ingest("alpha", [sent], true);
    db.markSent(db.pending(1)[0].id, "previous-message");
    assert.deepEqual(db.counts(), { pending: 0, seeded: 2, sent: 1 });
    const sources: JobSource[] = [{ name: "alpha", async fetchJobs() { return [job, sent]; } }];
    const delivered: string[] = [];
    const options = { repository: db, seedFirst: true, backfill: true, maxNotifications: 25,
      publish: async (item: Job) => { delivered.push(item.externalId); return "new-message"; } };
    assert.equal((await runAggregation(sources, options)).delivered, 1);
    assert.deepEqual(delivered, [job.externalId]);
    assert.deepEqual(db.counts(), { pending: 0, seeded: 1, sent: 2 });
    assert.equal((await runAggregation(sources, options)).delivered, 0);
  } finally { db.close(); }
});

test("backfill bypasses first-run seeding and honours the delivery cap", async () => {
  const db = new JobsRepository(":memory:");
  try {
    const other = { ...job, externalId: "other", url: "https://example.com/other" };
    const sources: JobSource[] = [{ name: "alpha", async fetchJobs() { return [job, other]; } }];
    const options = { repository: db, seedFirst: true, backfill: true, maxNotifications: 1, publish: async () => "42" };
    assert.equal((await runAggregation(sources, options)).delivered, 1);
    assert.equal(db.counts().pending, 1);
    assert.equal((await runAggregation(sources, { ...options, backfill: false })).delivered, 1);
    assert.deepEqual(db.counts(), { pending: 0, seeded: 0, sent: 2 });
  } finally { db.close(); }
});

test("webhook test sends one harmless message and reports safe API errors", async () => {
  const webhook = webhookUrl("https://discord.com/api/webhooks/1/test-token");
  const request = async (_url: URL | RequestInfo, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.match(body.content, /webhook test/);
    assert.deepEqual(body.allowed_mentions.parse, []);
    return Response.json({ id: "43" });
  };
  assert.equal(await testWebhook(webhook, request as typeof fetch), "43");
  await assert.rejects(testWebhook(webhook, (async () =>
    Response.json({ code: 10015, message: "Unknown Webhook" }, { status: 404 })) as typeof fetch), /Discord HTTP 404 \(API code 10015\)/);
});
