import {test} from "node:test";
import assert from "node:assert/strict";
import {createAskServer} from "../src/interactions/server.ts";
import {askEnv} from "../src/interactions/handler.ts";
import type {AddressInfo} from "node:net";

test("ask service verifies requests, acknowledges before fetching, and edits the private reply",async()=>{
  const keys=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
  const key=Buffer.from(await crypto.subtle.exportKey("raw",keys.publicKey)).toString("hex");
  const env=askEnv({DISCORD_PUBLIC_KEY:key,DISCORD_APPLICATION_ID:"123",DISCORD_GUILD_ID:"456",JOBS_SNAPSHOT_URL:"https://raw.githubusercontent.com/example/repo/bot-state/jobs.json"});
  let unblock!:()=>void;
  const gate=new Promise<void>(resolve=>{unblock=resolve;});
  let edited!:(value:any)=>void;
  const patch=new Promise<any>(resolve=>{edited=resolve;});
  let reads=0;
  const {server,shutdown}=createAskServer(env,async(input,init)=>{
    if (input===env.JOBS_SNAPSHOT_URL) {
      reads++;
      await gate;
      return Response.json({version:1,jobs:[{company:"Nokia",title:"Engineer",locations:["Ottawa"],url:"https://example.com/job",firstSeenAt:new Date().toISOString()}]});
    }
    assert.equal(input,"https://discord.com/api/v10/webhooks/123/test-token/messages/@original");
    assert.equal(init?.method,"PATCH");
    edited(JSON.parse(String(init?.body)));
    return Response.json({});
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
  async function send(body:string, corrupt=false) {
    const stamp=String(Math.floor(Date.now()/1000));
    const sig=Buffer.from(await crypto.subtle.sign("Ed25519",keys.privateKey,Buffer.from(stamp+body))).toString("hex");
    return fetch(base+"/interactions",{method:"POST",headers:{"X-Signature-Ed25519":corrupt?"0".repeat(128):sig,"X-Signature-Timestamp":stamp},body,signal:AbortSignal.timeout(3000)});
  }
  try {
    assert.equal((await fetch(base+"/health")).status,200);
    assert.equal((await fetch(base+"/unknown")).status,404);
    assert.equal((await send('{"type":1}',true)).status,401);
    assert.deepEqual(await (await send('{"type":1}')).json(),{type:1});
    assert.equal((await send("null")).status,400);
    assert.equal((await send("x".repeat(65537))).status,413);
    const command={type:2,application_id:"123",guild_id:"456",token:"test-token",data:{name:"ask",options:[{name:"company",value:"Nokai"}]}};
    const denied=await (await send(JSON.stringify({...command,guild_id:"999"}))).json();
    assert.equal(denied.type,4);
    assert.equal(reads,0);
    const ack=await (await send(JSON.stringify(command))).json();
    assert.deepEqual(ack,{type:5,data:{flags:64}});
    unblock();
    const data=await Promise.race([patch,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error("No follow-up")),3000);timer.unref();})]);
    assert.match(data.content,/Approximate match/);
    assert.equal(data.embeds[0].title,"Engineer");
    assert.equal(reads,1);
  } finally {unblock();await shutdown();}
});
test("ask startup rejects absent or unsafe configuration",()=>{
  assert.throws(()=>askEnv({}));
  assert.throws(()=>askEnv({DISCORD_PUBLIC_KEY:"a".repeat(64),DISCORD_APPLICATION_ID:"123",DISCORD_GUILD_ID:"456",JOBS_SNAPSHOT_URL:"https://example.com/jobs.json"}));
});
