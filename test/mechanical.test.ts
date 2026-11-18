import { test } from "node:test";
import assert from "node:assert/strict";
import type { Job } from "../src/models/job.ts";
import { classifyJob } from "../src/services/classifier.ts";
import { JobsRepository } from "../src/repositories/jobs.ts";
import { runAggregation } from "../src/services/aggregator.ts";
import { buildPayload, testWebhook, webhookUrl } from "../src/services/discord.ts";
import { parseSmartRecruitersPage } from "../src/sources/smartrecruiters.ts";
import { CAREERS } from "../src/sources/careers.ts";
import { searchJobs, parseAsk, validSnapshot } from "../src/services/ask.ts";
import { backfillWindow } from "../src/services/backfill.ts";

const swe: Job = { source:"test", externalId:"swe", title:"Software Engineer - New Grad", company:"Example", locations:["Ottawa, ON"], url:"https://example.com/swe" };
const mech: Job = {...swe, externalId:"mech", title:"Mechanical Engineer-in-Training", url:"https://example.com/mech"};

test("classifies Canadian mechanical engineering new-grad roles", () => {
  for (const title of ["Mechanical Engineer-in-Training","Mechanical Design Engineer - New Grad","Junior Manufacturing Engineer","HVAC Engineer I","Mechanical Engineering Graduate","Graduate Engineer - Mechanical","Ingénieur mécanique junior","Junior Mechatronics Engineer"])
    assert.equal(classifyJob({...mech,title}),"mechanical",title);
  assert.equal(classifyJob({...mech,title:"Junior Robotics Engineer",description:"Mechanical engineering degree required"}),"mechanical");
  assert.equal(classifyJob({...mech,title:"Junior Robotics Software Engineer"}),"swe");
  assert.equal(classifyJob({...mech,title:"Junior Process Engineer"}),undefined);
  assert.equal(classifyJob({...mech,title:"Mechanical Engineer",description:"0-2 years of experience"}),"mechanical");
  assert.equal(classifyJob({...mech,title:"Mechanical Engineer",description:"5 years of experience required",isNewGrad:true}),undefined);
  for (const title of ["Senior Mechanical Engineer","Mechanical Engineer II","Mechanical Engineering Intern","Civil Engineering Graduate"])
    assert.equal(classifyJob({...mech,title,isNewGrad:true}),undefined,title);
  assert.equal(classifyJob({...mech,locations:["Seattle, WA"]}),undefined);
  assert.equal(classifyJob(swe),"swe");
});

test("opt-in seeding and bounded backfill preserve legacy SWE state", async () => {
  const db = new JobsRepository(":memory:");
  try {
    const dated = {...mech,postedAt:"2026-11-16T12:00:00Z"};
    db.ingest("test",[swe],true);
    const sources=[{name:"test",async fetchJobs(){return [swe,dated];}}];
    const delivered:string[]=[];
    const opts={repository:db,seedFirst:true,maxNotifications:10,publish:async(job:Job)=>{delivered.push(job.category ?? "swe");return "id";}};
    await runAggregation(sources,opts);
    assert.equal(db.counts().seeded,1);
    await runAggregation(sources,{...opts,mechanicalEnabled:true});
    assert.equal(db.counts().seeded,2);
    assert.deepEqual(delivered,[]);
    await runAggregation(sources,{...opts,mechanicalEnabled:true,backfill:backfillWindow(7,Date.parse("2026-11-17T00:00:00Z"))});
    assert.deepEqual(delivered,["mechanical"]);
    await runAggregation(sources,{...opts,mechanicalEnabled:true});
    assert.deepEqual(delivered,["mechanical"]);
  } finally {db.close();}
});

test("separate queues isolate delivery errors and disabled mechanical jobs remain pending",async()=>{
  const db=new JobsRepository(":memory:");
  try{
    const sources=[{name:"test",async fetchJobs(){return [swe,mech];}}];
    const got:string[]=[];
    const opts={repository:db,seedFirst:false,mechanicalEnabled:true,maxNotifications:1,publish:async(job:Job)=>{
      if(job.category==="swe")throw Error("offline");
      got.push(job.category!);return "id";
    }};
    const result=await runAggregation(sources,opts);
    assert.equal(result.deliveryFailed,true);
    assert.deepEqual(got,["mechanical"]);
    assert.equal(db.pending(10,undefined,"swe").length,1);
    db.ingest("mechanical:test",[{...mech,category:"mechanical",externalId:"other",url:"https://example.com/other"}],false);
    await runAggregation(sources,{...opts,mechanicalEnabled:false,publish:async(job)=>{got.push(job.category ?? "swe");return "id";}});
    assert.deepEqual(got,["mechanical","swe"]);
    assert.equal(db.pending(10,undefined,"mechanical").length,1);
  }finally{db.close();}
});

test("mechanical cards have their own accent and test card",async()=>{
  assert.notEqual(buildPayload({...mech,category:"mechanical"}).embeds[0].color,buildPayload(swe).embeds[0].color);
  await testWebhook(webhookUrl("https://discord.com/api/webhooks/1/test-token"),(async(_url,init)=>{
    assert.match(JSON.parse(String(init?.body)).embeds[0].title,/Mechanical Engineer/);
    return Response.json({id:"42"});
  }) as typeof fetch,"mechanical");
});

test("new employer boards have independent source identities",()=>{
  for(const board of [CAREERS.aecom,CAREERS.cima]){
    const page=parseSmartRecruitersPage(board,{totalFound:1,content:[{id:"744000000000001",name:"Mechanical Engineering Graduate",location:{city:"Ottawa",country:"CA"},experienceLevel:{id:"entry_level"}}]},true);
    assert.equal(page.jobs[0].source,"smartrecruiters:"+board.id);
    assert.equal(classifyJob(page.jobs[0]),"mechanical");
  }
});

test("ask filters by discipline while accepting legacy records",()=>{
  const now=Date.parse("2026-11-17T00:00:00Z"),firstSeenAt="2026-11-16T00:00:00Z";
  const jobs=validSnapshot({version:1,jobs:[{...swe,firstSeenAt},{...mech,category:"mechanical",firstSeenAt}]});
  assert.equal(searchJobs(jobs,parseAsk({}),now).total,2);
  assert.equal(searchJobs(jobs,parseAsk({category:"mechanical"}),now).items[0].job.title,mech.title);
  assert.equal(searchJobs(jobs,parseAsk({category:"swe"}),now).items[0].job.title,swe.title);
  assert.throws(()=>parseAsk({category:"other"}));
});
