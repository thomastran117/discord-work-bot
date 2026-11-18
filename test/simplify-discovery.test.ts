import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSimplify, simplifySource } from "../src/sources/simplify.ts";
import { parseBoard } from "../src/sources/ats.ts";
import { classifyJob, isCanadian } from "../src/services/classifier.ts";
import { normalizeJob, urlIdentity } from "../src/services/identity.ts";
import { backfillWindow } from "../src/services/backfill.ts";
import { runAggregation } from "../src/services/aggregator.ts";
import { JobsRepository } from "../src/repositories/jobs.ts";
import { SourceHttpClient } from "../src/utils/http.ts";

const now = Date.parse("2026-11-17T22:00:00Z");
const day = 86400000;
const row = { id: "stripe-fixture", company_name: "Stripe", title: "Software Engineer, New Grad",
  locations: ["Seattle, WA", "Toronto, ON"], active: true,
  date_posted: (now - 30 * day) / 1000,
  url: "https://stripe.com/careers/listing/software-engineer-new-grad/1234567" };

test("Canadian location variants and foreign lookalikes", () => {
  for (const location of ["Toronto, ON", "Toronto ON", "Toronto, on", "Toronto - ON", "Toronto, ON, CAN",
    "Yellowknife, NT", "Whitehorse YT", "Iqaluit, NU", "London, ON", "Seattle, WA; Toronto, ON",
    "St. John's, NL", "Remote (Canada)", "ON"])
    assert.equal(isCanadian(location), true, location);
  for (const location of ["Vancouver, WA", "Vancouver WA", "Waterloo, IA", "Ontario, CA",
    "London, UK", "Remote", "On site", "San Francisco, CA"])
    assert.equal(isCanadian(location), false, location);
});

test("Simplify reports missing metadata, accepts active unmarked visibility and excludes closed/hidden rows", () => {
  let stats: Record<string, number> = {};
  const jobs = parseSimplify([row, {...row, active:false}, {...row,is_visible:false},
    {...row,active:undefined}, {...row,id:""}, {...row,id:"us",locations:["Seattle, WA"]},
    {...row,id:"string",locations:"Toronto ON"}], result => { stats = result; });
  assert.equal(jobs.length, 3);
  assert.equal(classifyJob(normalizeJob(jobs[0])), "swe");
  assert.equal(classifyJob(normalizeJob(jobs[2])), "swe");
  assert.equal(stats.fetched, 7);
  assert.equal(stats.inactive, 1);
  assert.equal(stats.hidden, 1);
  assert.equal(stats.invalidStatus, 1);
  assert.equal(stats.missingFields, 1);
  assert.equal(stats.canadianMatches, 2);
  assert.equal(stats.locationRejected, 1);
});

test("Simplify fetch filters global rows locally before the aggregation limit", async () => {
  const payload = [...Array.from({length:10001}, (_, i) => ({...row,id:String(i),locations:["Seattle, WA"]})), row];
  const http = new SourceHttpClient({request: (async () => Response.json(payload)) as typeof fetch});
  assert.equal((await simplifySource(undefined,http).fetchJobs()).length, 1);
});

test("Stripe board first-published date and custom application URL deduplicate during 30-day backfill", async () => {
  const board = {provider:"greenhouse" as const, company:"Stripe", board:"stripe"};
  const direct = parseBoard(board, {jobs:[{id:1234567,title:row.title,location:{name:"Toronto"},
    absolute_url:"https://job-boards.greenhouse.io/stripe/jobs/1234567",
    first_published:new Date(now-30*day).toISOString(), updated_at:new Date(now).toISOString()}]})[0];
  assert.equal(direct.postedAt,new Date(now-30*day).toISOString());
  assert.equal(urlIdentity(row.url),urlIdentity(direct.url));
  const noDate = parseBoard(board,{jobs:[{id:3,title:row.title,location:{name:"Toronto"},absolute_url:row.url,updated_at:new Date(now).toISOString()}]})[0];
  assert.equal(noDate.postedAt,undefined);
  const db = new JobsRepository(":memory:");
  const delivered:string[] = [];
  try {
    const simplify = parseSimplify([row,{...row,id:"old",url:row.url.replace("1234567","1234568"),date_posted:row.date_posted-1}]);
    const result = await runAggregation([{name:"simplify",async fetchJobs(){return simplify;}},
      {name:direct.source,async fetchJobs(){return [direct];}}],{
      repository:db,seedFirst:true,maxNotifications:20,backfill:backfillWindow(30,now),
      publish:async job=>{delivered.push(job.title);return "42";}
    });
    assert.equal(result.delivered,1);
    assert.deepEqual(delivered,[row.title]);
  } finally { db.close(); }
});
