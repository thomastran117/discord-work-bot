import {test} from "node:test";
import assert from "node:assert/strict";
import {parseAsk,formatSearch,searchJobs,validSnapshot,askCommand} from "../src/services/ask.ts";
import {verifyRequest} from "../src/interactions/handler.ts";
const now=Date.parse("2026-11-17T12:00:00Z");
const firstSeenAt="2026-11-16T12:00:00.000Z";
const job=(company:string,locations:string[],postedAt?:string)=>({company,title:"Engineer",locations,url:"https://example.com/"+encodeURIComponent(company),firstSeenAt,postedAt});
test("structured command defaults and validation",()=>{
  assert.deepEqual(askCommand.options.map(x=>x.name),["company","location","days","page","category"]);
  assert.deepEqual(parseAsk({}),{company:undefined,location:undefined,days:30,page:1});
  assert.deepEqual(parseAsk({company:" RBC ",location:" Ottawa ",days:3,page:2}),{company:"RBC",location:"Ottawa",days:3,page:2});
  for(const days of [0,31,1.5,NaN]) assert.throws(()=>parseAsk({days}));
  for(const page of [0,1.5,100001]) assert.throws(()=>parseAsk({page}));
  assert.throws(()=>parseAsk({company:"!!"})); assert.throws(()=>parseAsk({location:"a".repeat(101)}));
  assert.throws(()=>parseAsk({question:"find jobs"} as any));
});
test("typos, transpositions, partial names and accent handling",()=>{
  const jobs=[job("Nokia",["Ottawa, ON"]),job("Autodesk Inc.",["Toronto, Ontario"]),job("Ciena",["Ottawa, ON"]),job("Example",["Montréal, QC"]),job("SAP",["Vancouver, BC"])];
  const find=(options:Parameters<typeof parseAsk>[0])=>searchJobs(jobs,parseAsk(options),now);
  assert.equal(find({company:"Nokai"}).items[0].job.company,"Nokia");
  assert.equal(find({company:"Autodsk",location:"Tornto"}).items[0].job.company,"Autodesk Inc.");
  assert.deepEqual(find({company:"Autodsk",location:"Tornto"}).fuzzyFields,["company","location"]);
  assert.equal(find({company:"Cien"}).total,1);
  assert.equal(find({location:"Ottwa"}).total,2);
  assert.equal(find({location:"Montreal"}).total,1);
  assert.equal(find({location:"Ontairo"}).total,3);
  assert.equal(find({location:"ON"}).total,3);
  assert.equal(find({company:"SAB"}).total,0);
  assert.equal(find({company:"unrelated"}).total,0);
  assert.match(formatSearch(jobs,parseAsk({company:"Nokai"}),now).content,/Approximate match applied to: company/);
});
test("direct matches take precedence and filters remain conjunctive",()=>{
  const jobs=[job("Nokia",["Ottawa"]),job("Nokio",["Toronto"]),job("Nokian",["Vancouver"]),job("Nokia",["Ottawa"],"2026-09-01T12:00:00.000Z")];
  const found=searchJobs(jobs,parseAsk({company:"Nokia"}),now);
  assert.equal(found.total,2); assert.deepEqual(found.fuzzyFields,[]);
  assert.equal(searchJobs(jobs,parseAsk({company:"Nokia",location:"Toronto"}),now).total,0);
  assert.equal(searchJobs([job("Example",["Toronto"])],parseAsk({location:"on"}),now).total,0);
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
