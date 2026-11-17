import { test } from "node:test";
import assert from "node:assert/strict";
import type { Job, JobSource } from "../src/models/job.ts";
import { backfillFromArgs, backfillWindow, parseBackfillDays, postedTime, withinBackfill } from "../src/services/backfill.ts";
import { runAggregation } from "../src/services/aggregator.ts";
import { JobsRepository } from "../src/repositories/jobs.ts";

const now = Date.parse("2026-11-17T12:00:00.000Z");
const window = backfillWindow(7, now);
const day = 86_400_000;
const at = (days: number) => new Date(now - days * day).toISOString();
const make = (id: string, postedAt?: string): Job => ({
  source: "alpha", externalId: id, company: "Example", title: "Software Engineer - New Grad",
  locations: ["Toronto, ON"], url: "https://example.com/job/" + id, postedAt
});
const source = (jobs: Job[]): JobSource => ({ name: "alpha", async fetchJobs() { return jobs; } });

test("CLI defaults to seven days and rejects all values outside integer 1–30", () => {
  assert.equal(backfillFromArgs([]), undefined);
  assert.equal(backfillFromArgs(["--backfill"])?.days, 7);
  assert.equal(backfillFromArgs(["--backfill", "1"])?.days, 1);
  assert.equal(backfillFromArgs(["--backfill", "30"])?.days, 30);
  for (const invalid of ["0", "31", "-5", "1.5", "NaN", "Infinity", "", "1e1", " 7", "7 "]) {
    assert.throws(() => parseBackfillDays(invalid), /1 to 30/);
    assert.throws(() => backfillFromArgs(["--backfill", invalid]), /1 to 30/);
  }
  assert.throws(() => backfillWindow(31));
  assert.throws(() => backfillFromArgs(["--backfill","7","30"]));
  assert.throws(() => backfillFromArgs(["--dry-run","--backfill","7"]));
});
test("posting date window is inclusive, excludes future, unknown and malformed dates", () => {
  assert.equal(withinBackfill(at(7), window), true);
  assert.equal(withinBackfill(at(0), window), true);
  assert.equal(withinBackfill(new Date(window.from - 1).toISOString(), window), false);
  assert.equal(withinBackfill(at(-1), window), false);
  assert.equal(withinBackfill(undefined, window), false);
  assert.equal(postedTime("2026-11-16"), Date.parse("2026-11-16T00:00:00Z"));
  for (const bad of ["2026-02-30","2026-11-16T25:00:00Z","Today","Posted 2 days ago","2026-11-16T10:00:00"])
    assert.equal(postedTime(bad), undefined);
});
test("bounded backfill seeds old and undated discoveries, queues recent jobs only, and preserves future normal polling", async () => {
  const db = new JobsRepository(":memory:");
  const entries = [make("recent",at(1)),make("boundary",at(7)),make("old",at(8)),make("unknown"),make("future",at(-1)),make("invalid","2026-02-30")];
  const sent: string[] = [];
  const options = { repository: db, seedFirst: true, backfill: window, maxNotifications: 25,
    publish: async (job: Job) => {sent.push(job.externalId);return "42";} };
  try {
    assert.equal((await runAggregation([source(entries)],options)).delivered,2);
    assert.deepEqual(sent.sort(),["boundary","recent"]);
    assert.deepEqual(db.counts(),{pending:0,seeded:4,sent:2,rejected:0});
    assert.equal((await runAggregation([source(entries)],options)).delivered,0);
    const next = make("new-undated");
    assert.equal((await runAggregation([source([...entries,next])],{...options,backfill:undefined})).delivered,1);
    assert.ok(sent.includes("new-undated"));
  } finally {db.close();}
});
test("backfill respects earliest known dates across aliases and upgrades previously undated seed records", async () => {
  const db = new JobsRepository(":memory:");
  const original = make("previously-undated");
  const older = make("known-old",at(10));
  try {
    db.ingest("alpha",[original,older],true);
    const current = [{...original,postedAt:at(2)},{...older,postedAt:at(1)}];
    const sent:string[]=[];
    const result=await runAggregation([source(current)],{repository:db,seedFirst:true,backfill:window,maxNotifications:25,
      publish:async job=>{sent.push(job.externalId);return "42";}});
    assert.equal(result.delivered,1);
    assert.deepEqual(sent,["previously-undated"]);
    assert.equal(db.counts().seeded,1);
  } finally {db.close();}
});
test("backfill delivery excludes previously pending jobs outside window and honours cap", async () => {
  const db=new JobsRepository(":memory:");
  const old=make("pending-old",at(8)), undated=make("pending-unknown"), recent=make("pending-recent",at(1)), other=make("pending-other",at(2));
  const sent:string[]=[];
  try {
    db.ingest("alpha",[old,undated,recent,other],false);
    const options={repository:db,seedFirst:true,backfill:window,maxNotifications:1,
      publish:async(job:Job)=>{sent.push(job.externalId);return "42";}};
    assert.equal((await runAggregation([source([old,undated,recent,other])],options)).delivered,1);
    assert.equal((await runAggregation([source([old,undated,recent,other])],options)).delivered,1);
    assert.deepEqual(sent.sort(),["pending-other","pending-recent"]);
    assert.equal(db.counts().pending,2);
    assert.equal((await runAggregation([source([])],options)).delivered,0);
    assert.equal((await runAggregation([source([])],{...options,backfill:undefined,maxNotifications:25})).delivered,2);
  } finally {db.close();}
});
test("a wider allowed backfill can recover an older seed without replaying sent jobs", async () => {
  const db=new JobsRepository(":memory:");
  const older=make("older",at(20)),recent=make("recent",at(1));
  const sent:string[]=[];
  try {
    const options={repository:db,seedFirst:true,backfill:window,maxNotifications:25,
      publish:async(job:Job)=>{sent.push(job.externalId);return "42";}};
    await runAggregation([source([older,recent])],options);
    await runAggregation([source([older,recent])],{...options,backfill:backfillWindow(30,now)});
    assert.deepEqual(sent,["recent","older"]);
  } finally {db.close();}
});
