import { test } from "node:test";
import assert from "node:assert/strict";
import type { Job } from "../src/models/job.ts";
import { classifyJob } from "../src/services/classifier.ts";
import { parseSimplify } from "../src/sources/simplify.ts";
import { runAggregation } from "../src/services/aggregator.ts";
import { backfillWindow } from "../src/services/backfill.ts";
import { JobsRepository } from "../src/repositories/jobs.ts";

const now = Date.parse("2026-11-18T03:24:54.929Z");
const day = 86_400_000;
const google = {
  id: "fc220677-a2f4-4242-869b-bc904b43547f",
  company_name: "Google",
  title: "Software Developer 2 – Early Career",
  locations: ["Montreal, QC, Canada", "Waterloo, ON, Canada"],
  url: "https://www.google.com/about/careers/applications/jobs/results/93868335938052806?utm_source=Simplify&ref=Simplify",
  active: true, is_visible: true,
  date_posted: Math.floor((now - 11 * day) / 1000)
};
const job = parseSimplify([google])[0];

test("SWE level II with explicit early-career title is eligible in Canadian locations", () => {
  for (const title of [
    google.title, "Software Developer II, Early Career", "Software Engineer II - Early Career",
    "SWE II – New Grad", "SDE 2, Entry-Level"
  ]) {
    assert.equal(classifyJob({...job,title,isNewGrad:undefined}),"swe",title);
  }
  for (const title of [
    "Software Developer II", "Software Engineer 2", "Senior Software Engineer II - Early Career",
    "Software Engineer III - Early Career", "Software Developer 4 - New Grad",
    "Software Engineer II Intern - Early Career", "Software Engineer II - Mid-Level",
    "Intermediate Software Engineer II - Early Career", "Mechanical Engineer II - Early Career"
  ]) assert.equal(classifyJob({...job,title,isNewGrad:true}),undefined,title);
  assert.equal(classifyJob({...job,locations:["Seattle, WA"]}),undefined);
  assert.equal(classifyJob({...job,description:"3+ years of software development experience required"}),undefined);
  assert.equal(classifyJob({...job,description:"1–3 years of software development experience"}),"swe");
  assert.equal(classifyJob({...job,employmentType:"Internship"}),undefined);
});

test("Simplify Google level-II fixture is recovered by 30-day backfill but not 7-day backfill", async () => {
  const db = new JobsRepository(":memory:");
  const sent: Job[] = [];
  const rows = [google,
    {...google,id:"old",url:"https://example.com/jobs/old",date_posted:Math.floor((now-31*day)/1000)},
    {...google,id:"senior",title:"Senior Software Developer II – Early Career",url:"https://example.com/jobs/senior"},
    {...google,id:"closed",active:false,url:"https://example.com/jobs/closed"},
    {...google,id:"us",locations:["Mountain View, CA"],url:"https://example.com/jobs/us"}];
  const source = {name:"simplify",async fetchJobs(){return parseSimplify(rows)}};
  const options = {repository:db,seedFirst:true,maxNotifications:25,
    publish:async(item:Job)=>{sent.push(item);return "42";}};
  try {
    const seven = await runAggregation([source],{...options,backfill:backfillWindow(7,now)});
    assert.equal(seven.delivered,0);
    const thirty = await runAggregation([source],{...options,backfill:backfillWindow(30,now)});
    assert.equal(thirty.delivered,1);
    assert.equal(sent[0].company,"Google");
    assert.equal(sent[0].title,google.title);
    assert.equal(sent[0].category,"swe");
    assert.equal((await runAggregation([source],{...options,backfill:backfillWindow(30,now)})).delivered,0);
    assert.equal((await runAggregation([source],options)).delivered,0);
  } finally {db.close();}
});

test("normal polling shares the classifier; a newly seen early-career II job is delivered once",async()=>{
  const db=new JobsRepository(":memory:");
  const source={name:"simplify",async fetchJobs(){return [job]}};
  try{
    const options={repository:db,seedFirst:false,maxNotifications:25,publish:async()=>"42"};
    assert.equal((await runAggregation([source],options)).delivered,1);
    assert.equal((await runAggregation([source],options)).delivered,0);
  }finally{db.close();}
});
