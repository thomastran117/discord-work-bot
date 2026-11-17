import {test} from "node:test";
import assert from "node:assert/strict";
import {parseAsk,formatSearch,searchJobs,validSnapshot} from "../src/services/ask.ts";
import {verifyRequest} from "../src/interactions/worker.ts";
const now=Date.parse("2026-11-17T12:00:00Z");
const firstSeenAt="2026-11-16T12:00:00.000Z";
const job=(company:string,locations:string[],postedAt?:string)=>({company,title:"Engineer",locations,url:"https://example.com/"+encodeURIComponent(company),firstSeenAt,postedAt});
test("question patterns and structured filters",()=>{
  assert.deepEqual(parseAsk({question:"Did RBC posted in the last 3 days?"}),{company:"RBC",location:undefined,days:3,page:1});
  assert.equal(parseAsk({question:"Give me the postings from the past 7 days"}).days,7);
  assert.equal(parseAsk({question:"Find all Nokia postings in the max window"}).company,"Nokia");
  assert.equal(parseAsk({question:"Find postings in Ottawa"}).location,"Ottawa");
  assert.equal(parseAsk({company:"SAP",location:"Toronto",days:14,page:2}).page,2);
  assert.throws(()=>parseAsk({days:31})); assert.throws(()=>parseAsk({days:0}));
  assert.throws(()=>parseAsk({question:"hello"})); assert.throws(()=>parseAsk({question:"find jobs",company:"SAP"}));
});
test("dates, aliases and all locations",()=>{
  const jobs=[job("Royal Bank of Canada",["Toronto, ON","Ottawa, ON"],"2026-11-14T12:00:00.000Z"),job("RBC",["Ottawa, Ontario"]),job("RBC",["Ottawa"],"2026-10-01T12:00:00.000Z"),job("RBC",["Vancouver"]),"bad"].slice(0,4) as ReturnType<typeof job>[];
  const found=searchJobs(jobs,parseAsk({company:"rbc",location:"ottawa",days:3}),now);
  assert.equal(found.total,2); assert.equal(found.known,1); assert.equal(found.items[0].dateKind,"First seen");
  assert.equal(searchJobs(jobs,parseAsk({location:"Ontario"}),now).total,2);
  assert.match(formatSearch(jobs,parseAsk({company:"RBC",days:3}),now).content,/publication date unknown/);
});
test("pagination, no results and snapshot validation",()=>{
  const jobs=Array.from({length:12},(_,i)=>job("Example "+i,["Ottawa"]));
  assert.equal(searchJobs(jobs,parseAsk({page:2}),now).items.length,5);
  assert.match(formatSearch(jobs,parseAsk({page:4}),now).content,/Page not found/);
  assert.equal(searchJobs(jobs,parseAsk({company:"missing"}),now).total,0);
  assert.equal(validSnapshot({version:1,jobs}).length,12);
  assert.throws(()=>validSnapshot({version:2,jobs})); assert.throws(()=>validSnapshot({version:1,jobs:[{...jobs[0],url:"javascript:alert(1)"}]}));
});
test("Discord signatures and timestamp",async()=>{
  const key=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
  const hex=(data:ArrayBuffer)=>Buffer.from(data).toString("hex");
  const pub=hex(await crypto.subtle.exportKey("raw",key.publicKey));
  const stamp=String(now/1000),body='{"type":1}';
  const sig=hex(await crypto.subtle.sign("Ed25519",key.privateKey,new TextEncoder().encode(stamp+body)));
  assert.equal(await verifyRequest(pub,sig,stamp,body,now),true);
  assert.equal(await verifyRequest(pub,sig,stamp,body+" ",now),false);
  assert.equal(await verifyRequest(pub,sig,stamp,body,now+301000),false);
});
