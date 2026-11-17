import { test } from "node:test";
import assert from "node:assert/strict";
import type { Job, JobSource } from "../src/models/job.ts";
import { runAggregation } from "../src/services/aggregator.ts";
import { pollOutcome } from "../src/services/poll-outcome.ts";
import { JobsRepository } from "../src/repositories/jobs.ts";

const job: Job = {source:"test", externalId:"1", company:"Example", title:"Software Engineer - New Grad", locations:["Toronto, ON"], url:"https://example.com/job/1"};
const empty: JobSource = {name:"empty", async fetchJobs() {return [];}};
const valid: JobSource = {name:"test", async fetchJobs() {return [job];}};
const failed: JobSource = {name:"failed", async fetchJobs() {throw new Error("Source unavailable");}};

test("empty successful poll exits zero and warns without calling Discord", async () => {
  const db = new JobsRepository(":memory:");
  try {
    const result = await runAggregation([empty], {repository:db,seedFirst:false,maxNotifications:25,publish:async()=>{assert.fail("No Discord request expected");}});
    assert.equal(result.selected,0);
    assert.deepEqual(pollOutcome(result,1),{exitCode:0,warnings:["No new jobs to post."],errors:[]});
  } finally {db.close();}
});

test("partial source failures with empty queue or successful delivery are warnings", async () => {
  const db=new JobsRepository(":memory:");
  try {
    const options={repository:db,seedFirst:false,maxNotifications:25,publish:async()=>"42"};
    const noJobs=await runAggregation([failed,empty],options);
    assert.equal(pollOutcome(noJobs,2).exitCode,0);
    assert.equal(pollOutcome(noJobs,2).warnings.length,2);
    const published=await runAggregation([failed,valid],options);
    assert.equal(published.delivered,1);
    assert.equal(pollOutcome(published,2).exitCode,0);
    assert.equal(pollOutcome(published,2).warnings.length,1);
    const duplicate=await runAggregation([valid],options);
    assert.equal(duplicate.selected,0);
    assert.match(pollOutcome(duplicate,1).warnings[0],/No new jobs/);
  } finally {db.close();}
});

test("total source failure and unconfirmed Discord delivery remain fatal", async () => {
  const db=new JobsRepository(":memory:");
  try {
    const options={repository:db,seedFirst:false,maxNotifications:25,publish:async()=>{throw new Error("Discord unavailable");}};
    const unavailable=await runAggregation([failed],options);
    assert.equal(pollOutcome(unavailable,1).exitCode,1);
    assert.equal(pollOutcome(unavailable,1).warnings.length,0);
    const delivery=await runAggregation([valid],options);
    assert.equal(pollOutcome(delivery,1).exitCode,1);
    assert.equal(db.counts().pending,1);
  } finally {db.close();}
});

test("normal delivered runs and diagnostic preview do not warn about an empty queue", () => {
  const result={failed:0,delivered:1,rejected:0,selected:1,deliveryFailed:false};
  assert.deepEqual(pollOutcome(result,1),{exitCode:0,warnings:[],errors:[]});
  assert.deepEqual(pollOutcome({...result,selected:0,delivered:0},1,true),{exitCode:0,warnings:[],errors:[]});
  assert.match(pollOutcome({...result,delivered:0,rejected:1},1).warnings[0],/quarantined/);
});

test("database ingestion and confirmation failures are not suppressed as partial source warnings", async () => {
  const db=new JobsRepository(":memory:");
  try {
    const options={repository:db,seedFirst:false,maxNotifications:25,publish:async()=>"42"};
    const ingest=db.ingest.bind(db);
    db.ingest=()=>{throw new Error("SQLite write failed");};
    await assert.rejects(runAggregation([valid,empty],options),/SQLite write failed/);
    db.ingest=ingest;
    db.markSent=()=>{throw new Error("SQLite confirmation failed");};
    await assert.rejects(runAggregation([valid],options),/SQLite confirmation failed/);
  } finally {db.close();}
});
