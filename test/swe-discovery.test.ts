import {test} from "node:test";
import assert from "node:assert/strict";
import type {Job} from "../src/models/job.ts";
import {assessSwe,classifyJob} from "../src/services/classifier.ts";
import {runAggregation} from "../src/services/aggregator.ts";
import {backfillWindow} from "../src/services/backfill.ts";
import {JobsRepository} from "../src/repositories/jobs.ts";

const base:Job={source:"example",externalId:"1",title:"Software Engineer",company:"Example",locations:["Toronto, ON"],url:"https://example.com/jobs/1"};
test("recognizes technical early career roles and reasonable experience requirements",()=>{
  for(const title of ["Junior Developer","Junior Programmer","Graduate Python Developer","Junior SDET","Junior QA Automation Engineer","Junior Data Scientist","Entry-Level AI Engineer","Junior Analytics Engineer","Junior Cybersecurity Engineer","Junior Programmer Analyst"]){
    assert.equal(classifyJob({...base,title}),"swe",title);
  }
  for(const description of ["2 years of experience","2+ years of software development experience","1–3 years of relevant experience","0 to 3 years of experience","2 years of Python experience"]){
    assert.equal(classifyJob({...base,description}),"swe",description);
    assert.equal(classifyJob({...base,title:"Software Engineer II",description}),"swe",description);
  }
  assert.equal(classifyJob({...base,title:"Junior QA Engineer",description:"Test automation with Python"}),"swe");
  assert.equal(classifyJob({...base,title:"Junior Data Analyst",description:"Experience with SQL and Python"}),"swe");
});

test("preserves geography, seniority, discipline and evidence guardrails",()=>{
  for(const title of ["Senior Python Developer","Junior Software Developer III","SDET Intern","Intermediate Data Scientist","Junior Marketing Analyst","Junior Data Analyst","Junior QA Engineer","Mechanical Engineer II"]){
    assert.equal(classifyJob({...base,title,isNewGrad:true}),undefined,title);
  }
  assert.equal(classifyJob({...base,title:"Mechanical Engineer",description:"1–3 years of experience"}),"mechanical");
  assert.equal(classifyJob({...base,title:"Junior Test Engineer",description:"Mechanical engineering degree and test automation"}),"mechanical");
  assert.equal(classifyJob({...base,title:"Software Engineer II",isNewGrad:true}),undefined);
  assert.equal(classifyJob({...base,title:"Software Engineer II",description:"1–3 years of relevant experience and 5 years of programming experience"}),undefined);
  assert.equal(classifyJob({...base,title:"Junior Software Engineer",description:"4+ years of experience required"}),undefined);
  assert.equal(assessSwe({...base,locations:["Seattle, WA"]}),"location");
  assert.equal(assessSwe({...base,title:"Software Engineer"}),"early_career_evidence");
  assert.equal(assessSwe({...base,title:"Junior QA Engineer"}),"discipline_evidence");
});

test("broadened SWE discovery retains 30-day boundaries, delivery cap and dedup",async()=>{
  const db=new JobsRepository(":memory:");
  const now=Date.parse("2026-11-18T04:00:00Z");
  const day=86400000;
  const make=(id:string,title:string,age:number,description?:string):Job=>({...base,externalId:id,url:"https://example.com/jobs/"+id,title,postedAt:new Date(now-age*day).toISOString(),description});
  const jobs=[make("1","Junior SDET",3),make("2","Software Engineer II",11,"1–3 years of experience"),make("3","Junior Data Scientist",20),make("4","Junior Programmer",31),make("5","Senior Software Engineer",1)];
  const source={name:"example",async fetchJobs(){return jobs;}};
  const delivered:string[]=[];
  const options={repository:db,seedFirst:true,maxNotifications:2,backfill:backfillWindow(30,now),publish:async(j:Job)=>{delivered.push(j.externalId);return "42";}};
  try{
    assert.equal((await runAggregation([source],options)).delivered,2);
    assert.equal(db.counts().pending,1);
    assert.equal((await runAggregation([source],options)).delivered,1);
    assert.deepEqual(delivered.sort(),["1","2","3"]);
    assert.equal(db.counts().seeded,1);
    assert.equal((await runAggregation([source],options)).delivered,0);
  }finally{db.close();}
});
