import { test } from "node:test";
import assert from "node:assert/strict";
import { CAREERS, careerSource } from "../src/sources/careers.ts";
import { fetchSmartRecruiters, parseSmartRecruitersPage, enrichSmartRecruiters } from "../src/sources/smartrecruiters.ts";
import { SourceHttpClient, SourceCooldownError } from "../src/utils/http.ts";
import { eligible, classifyJob } from "../src/services/classifier.ts";
import { urlIdentity } from "../src/services/identity.ts";

const board = CAREERS.sap;
const row = { id: "744000000000001", name: "Software Engineer", location: { city: "Vancouver", region: "British Columbia", country: "ca" }, experienceLevel: {id:"entry_level",label:"Entry Level"}, typeOfEmployment:{id:"permanent",label:"Full-time"}, releasedDate:"2026-11-17T00:00:00Z" };
const detail = {...row, active: true, jobAd: {sections:{jobDescription:{text:"<p>Build software</p>"},qualifications:{text:"<p>0-2 years of experience</p>"},companyDescription:{text:"Unrelated boilerplate"}}}};

function mocked(request: typeof fetch) {
  let now = 1_800_000_000_000;
  return new SourceHttpClient({request, now:()=>now, sleep:async ms=>{now+=ms}, random:()=>0,event:()=>{}});
}

test("SAP parser uses explicit Canadian country, experience and employment signals", () => {
  const data = {totalFound: 5,content:[row,
    {...row,id:"2",location:{city:"Vancouver",region:"WA",country:"us"}},
    {...row,id:"3",name:"SAP iXp Intern - Software Engineer"},
    {...row,id:"4",experienceLevel:{id:"mid_senior_level"}},
    {...row,id:"5",active:false}]};
  const parsed = parseSmartRecruitersPage(board,data);
  assert.equal(parsed.scanned,5);
  assert.equal(parsed.jobs.length,1);
  assert.equal(parsed.jobs[0].source,"smartrecruiters:sap");
  assert.equal(parsed.jobs[0].company,"SAP");
  assert.deepEqual(parsed.jobs[0].locations,["Vancouver, British Columbia, Canada"]);
  assert.ok(eligible(parsed.jobs[0]));
  assert.throws(()=>parseSmartRecruitersPage(board,{content:[]}));
  const enriched=enrichSmartRecruiters(board, parsed.jobs[0], detail)!;
  assert.equal(enriched.description,"Build software 0-2 years of experience");
  assert.equal(enrichSmartRecruiters(board,parsed.jobs[0],{...detail,active:false}),undefined);
});

test("SAP pagination accounts for filtered rows and reads only fixed-host details",async()=>{
  const calls:string[]=[];
  const http=mocked(async input=>{
    const url=new URL(String(input));calls.push(url.toString());
    assert.equal(url.hostname,"api.smartrecruiters.com");
    assert.match(url.pathname,/^\/v1\/companies\/SAPITBusinessSysteme\/postings/);
    if(url.pathname.endsWith("/postings")){
      assert.equal(url.searchParams.get("country"),"ca");
      return Response.json({totalFound:2,content:[url.searchParams.get("offset")==="0" ? {...row,id:"2",name:"Senior Software Engineer"} : {...row,ref:"https://evil.example/ignored"}]});
    }
    assert.ok(url.pathname.endsWith("/"+row.id));
    return Response.json(detail);
  });
  const jobs=await fetchSmartRecruiters(board,http);
  assert.equal(calls.length,3);
  assert.match(calls[1],/offset=1/);
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].url,"https://jobs.smartrecruiters.com/SAPITBusinessSysteme/744000000000001-software-engineer");
  assert.equal(urlIdentity(jobs[0].url),urlIdentity("https://jobs.sap.com/en/jobs/744000000000001/software-engineer/"));
  assert.equal(urlIdentity(jobs[0].url),urlIdentity("https://jobs.smartrecruiters.com/sapitbusinesssysteme/744000000000001-different-slug"));
});

test("SAP source uses shared cooldown and does not retry early or switch hosts",async()=>{
  let calls=0;
  const http=mocked(async()=>{calls++;return new Response(null,{status:429,headers:{"Retry-After":"7200"}})});
  const source=careerSource("sap",http);
  assert.equal(source.name,"smartrecruiters:sap");
  await assert.rejects(source.fetchJobs(),SourceCooldownError);
  await assert.rejects(source.fetchJobs(),SourceCooldownError);
  assert.equal(calls,1);
});

test("targeted query reaches mechanical jobs beyond the capped general listing and enriches once",async()=>{
  const queries:string[]=[];
  let detailCalls=0;
  const mechanical={...row,id:"744000000000009",name:"Mechanical Buildings Jr Eng. Prof.",experienceLevel:{id:"mid_senior_level"},location:{city:"Edmonton",country:"ca"}};
  const http=mocked(async input=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith("/postings")){
      const q=url.searchParams.get("q") ?? "";
      queries.push(q);
      if(!q){
        const offset=Number(url.searchParams.get("offset"));
        return Response.json({totalFound:559,content:Array.from({length:50},(_,i)=>({...row,id:String(offset+i+100),name:"Senior Civil Engineer"}))});
      }
      return Response.json({totalFound:q==="mechanical"||q==="EIT"?1:0,content:q==="mechanical"||q==="EIT"?[mechanical]:[]});
    }
    detailCalls++;
    return Response.json({...mechanical,jobAd:{sections:{qualifications:{text:"University degree in mechanical engineering. 1–2 years of experience."}}}});
  });
  const jobs=await fetchSmartRecruiters(CAREERS.cima,http,undefined,true);
  assert.equal(queries.filter(x=>!x).length,6);
  assert.ok(queries.includes("mechanical"));
  assert.equal(detailCalls,1);
  assert.equal(jobs.length,1);
  assert.equal(classifyJob(jobs[0]),"mechanical");
});
