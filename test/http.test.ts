import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SourceHttpClient, SourceCooldownError, retryAfterMs, retryableStatus } from "../src/utils/http.ts";
import { JobsRepository, readSourceCooldowns } from "../src/repositories/jobs.ts";
import { atsSource } from "../src/sources/ats.ts";
import { curatedSource } from "../src/sources/curated.ts";
import { simplifySource } from "../src/sources/simplify.ts";
import { runAggregation } from "../src/services/aggregator.ts";

const epoch = Date.parse("2026-11-17T00:00:00Z");
const url = "https://example.com/jobs";
function fixture(responses: (Response | Error)[], extra: ConstructorParameters<typeof SourceHttpClient>[0] = {}) {
  let now = epoch;
  const waits: number[] = [];
  const calls: { url: string; init?: RequestInit }[] = [];
  const events: string[] = [];
  const http = new SourceHttpClient({
    now: () => now, random: () => 0,
    sleep: async ms => { waits.push(ms); now += ms; },
    event: (_level, name) => { events.push(name); },
    request: async (input, init) => {
      calls.push({url: String(input), init});
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error("Unexpected request");
      return response;
    },
    ...extra
  });
  return {http, waits, calls, events, now: () => now};
}
const status = (code: number, retryAfter?: string) =>
  new Response(null, {status: code, headers: retryAfter === undefined ? {} : {"Retry-After": retryAfter}});
const ok = () => Response.json({ok: true});

test("retry-after accepts seconds and HTTP dates without interpreting invalid numerics as dates", () => {
  assert.equal(retryAfterMs("12", epoch), 12_000);
  assert.equal(retryAfterMs("0.25", epoch), 250);
  assert.equal(retryAfterMs("Tue, 17 Nov 2026 00:00:30 GMT", epoch), 30_000);
  assert.equal(retryAfterMs("Mon, 16 Nov 2026 00:00:00 GMT", epoch), 0);
  for (const invalid of ["", "-1", "0x10", "bad", "1e3"]) assert.equal(retryAfterMs(invalid, epoch), undefined);
  assert.ok(retryAfterMs("999999999999999999999", epoch)! > 60_000);
});

test("network errors, 408 and transient 5xx retry with exponential waits", async () => {
  const f = fixture([new TypeError("network"), status(408), status(503), ok()]);
  assert.deepEqual(await f.http.getJson(url), {ok: true});
  assert.deepEqual(f.waits, [2000, 4000, 8000]);
  assert.equal(f.calls.length, 4);
});
test("positive jitter varies retry delay without shortening it", async () => {
  const f = fixture([status(500), ok()], {random: () => 0.8});
  await f.http.getJson(url);
  assert.deepEqual(f.waits, [2400]);
});
test("429 and Retry-After are never retried before the advertised time", async () => {
  const f = fixture([status(429, "25"), status(429, "3"), ok()]);
  await f.http.getJson(url);
  assert.deepEqual(f.waits, [25_000, 30_000]);
});
test("long Retry-After is persisted and suppresses other boards on the same host", async () => {
  const blocked = new Map<string, number>();
  const store = {getCooldown: (host: string) => blocked.get(host) ?? 0,
    setCooldown: (host: string, until: number) => { blocked.set(host, until); }};
  const f = fixture([status(503, "10800"), ok()], {cooldowns: store});
  await assert.rejects(f.http.getJson(url), SourceCooldownError);
  assert.equal(blocked.get("example.com"), epoch + 10_800_000);
  await assert.rejects(f.http.getText("https://example.com/other"), SourceCooldownError);
  assert.equal(f.calls.length, 1);
  const next = fixture([ok()], {cooldowns: store, now: () => epoch + 7_200_000});
  await assert.rejects(next.http.getJson(url), SourceCooldownError);
  assert.equal(next.calls.length, 0);
  assert.deepEqual(await f.http.getJson("https://another.example/jobs"), {ok: true});
});
test("repeated 429s open a conservative cooldown; no extra request to that host", async () => {
  const f = fixture([status(429), status(429), status(429), status(429)]);
  await assert.rejects(f.http.getJson(url), SourceCooldownError);
  assert.deepEqual(f.waits, [15_000, 30_000, 60_000]);
  await assert.rejects(f.http.getJson(url), SourceCooldownError);
  assert.equal(f.calls.length, 4);
});
test("permanent HTTP errors and invalid JSON do not retry", async () => {
  for (const code of [400, 401, 403, 404, 501]) {
    const f = fixture([status(code)]);
    await assert.rejects(f.http.getJson(url), new RegExp("Source HTTP " + code));
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.waits, []);
    assert.equal(retryableStatus(code), false);
  }
  const f = fixture([new Response("not json")]);
  await assert.rejects(f.http.getJson(url), /Invalid source response body/);
  assert.equal(f.calls.length, 1);
});
test("network retry cap and parent abort prevent endless retries", async () => {
  const f = fixture(Array.from({length: 4}, () => new TypeError("offline")));
  await assert.rejects(f.http.getJson(url), /network request failed/);
  assert.equal(f.calls.length, 4);
  const controller = new AbortController();
  controller.abort();
  const cancelled = fixture([]);
  await assert.rejects(cancelled.http.getJson(url, controller.signal), /deadline exceeded/);
  assert.equal(cancelled.calls.length, 0);
});
test("outer deadline cancels retry sleep and preserves received cooldown", async () => {
  const controller = new AbortController();
  const f = fixture([status(429, "20")], {sleep: async (_ms, signal) => {
    assert.equal(signal, controller.signal); controller.abort(); signal?.throwIfAborted();
  }});
  await assert.rejects(f.http.getJson(url, controller.signal), /deadline exceeded/);
  await assert.rejects(f.http.getJson(url), SourceCooldownError);
  assert.equal(f.calls.length, 1);
});
test("same-host pacing covers both read-only search POST and GET detail", async () => {
  const f = fixture([ok(), ok(), ok(), ok()]);
  const workday = "https://example.wd5.myworkdayjobs.com";
  await f.http.postSearchJson(workday + "/jobs", {offset: 0});
  await f.http.getJson(workday + "/job/1");
  await f.http.getJson(url);
  await f.http.getJson(url + "/2");
  assert.deepEqual(f.waits, [2_000, 1_000]);
  assert.equal(f.calls[0].init?.method, "POST");
  assert.equal(f.calls[0].init?.body, '{"offset":0}');
});
test("persistent cooldowns survive database reopen and preview reads without creating state", () => {
  const dir = mkdtempSync(join(tmpdir(), "source-http-"));
  const path = join(dir, "jobs.db");
  try {
    assert.deepEqual(readSourceCooldowns(path), new Map());
    const db = new JobsRepository(path);
    db.setCooldown("example.com", epoch + 100_000);
    db.setCooldown("example.com", epoch + 50_000);
    db.close();
    const reopened = new JobsRepository(path);
    assert.equal(reopened.getCooldown("example.com"), epoch + 100_000);
    reopened.close();
    assert.equal(readSourceCooldowns(path).get("example.com"), epoch + 100_000);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
test("source adapters share client and keep unrelated providers working after rate limit", async () => {
  const db = new JobsRepository(":memory:");
  const f = fixture([status(429, "7200"), Response.json({jobs: []})], {cooldowns: db});
  try {
    const sources = [
      simplifySource(undefined, f.http),
      curatedSource("grind-canada", f.http),
      atsSource({provider:"greenhouse",company:"Example",board:"example"}, f.http)
    ];
    const result = await runAggregation(sources, {repository: db, seedFirst: true, maxNotifications: 25,publish: async () => "never"});
    assert.equal(result.failed, 2);
    assert.equal(f.calls.length, 2);
    assert.equal(f.events.includes("source_http_cooldown"), true);
  } finally { db.close(); }
});
