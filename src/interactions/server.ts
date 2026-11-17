import {createServer} from "node:http";
import type {IncomingMessage, ServerResponse} from "node:http";
import {createInteractionHandler, MAX_BODY_BYTES} from "./handler.ts";
import type {Env} from "./handler.ts";

export function createAskServer(env: Env, fetcher: typeof fetch = fetch) {
  const handle = createInteractionHandler(env,fetcher);
  const active = new Set<Promise<void>>();
  let stopping = false;
  const server = createServer({requestTimeout:10000,headersTimeout:5000,maxHeaderSize:8192}, (req,res) => {
    void route(req,res).catch(() => {
      if (!res.headersSent) res.writeHead(500,{"Connection":"close"}).end("Internal error");
      else res.destroy();
      console.warn("ask_request_failed");
    });
  });
  server.setTimeout(10000, socket => socket.destroy());
  async function route(req: IncomingMessage,res: ServerResponse) {
    if (stopping) { res.writeHead(503,{"Connection":"close"}).end(); return; }
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200,{"Content-Type":"application/json"}).end('{"status":"ok"}'); return;
    }
    if (req.method !== "POST" || req.url !== "/interactions") {
      res.writeHead(404,{"Connection":"close"}).end("Not found"); return;
    }
    const sig=req.headers["x-signature-ed25519"], stamp=req.headers["x-signature-timestamp"];
    if (typeof sig !== "string" || !/^[a-f0-9]{128}$/i.test(sig) || typeof stamp !== "string" || !/^\d{10}$/.test(stamp)) {
      res.writeHead(401,{"Connection":"close"}).end("Unauthorized"); return;
    }
    if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) {
      res.writeHead(413,{"Connection":"close"}).end("Request too large"); return;
    }
    const chunks: Buffer[] = [];
    let size=0;
    for await (const chunk of req.iterator({destroyOnReturn:false})) {
      const bytes=Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size+=bytes.length;
      if (size>MAX_BODY_BYTES) {
        res.writeHead(413,{"Connection":"close"}).end("Request too large"); return;
      }
      chunks.push(bytes);
    }
    let deferred: (()=>Promise<void>) | undefined;
    const response=await handle(Buffer.concat(chunks,size),sig,stamp,task=>{deferred=task;});
    const body=await response.text();
    // Schedule potentially slow network I/O only after writing the initial ACK.
    if (deferred && (stopping || active.size>=64)) {
      res.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify({type:4,data:{content:"Search is busy. Please retry shortly.",flags:64,allowed_mentions:{parse:[]}}}));
      return;
    }
    res.writeHead(response.status,Object.fromEntries(response.headers));
    if (!deferred) { res.end(body); return; }
    const task=deferred;
    let finish!: ()=>void;
    const pending=new Promise<void>(resolve=>{finish=resolve;});
    active.add(pending);
    res.once("close",()=>{if (!res.writableFinished) finish();});
    res.end(body,()=>{
      void Promise.resolve().then(task).catch(()=>console.warn("ask_response_failed")).finally(finish);
    });
    void pending.finally(()=>active.delete(pending));
  }
  async function shutdown() {
    stopping=true;
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await Promise.allSettled([...active]);
  }
  return {server,shutdown};
}
