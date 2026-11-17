import { formatSearch, parseAsk, validSnapshot, ASK_HELP } from "../services/ask.ts";
import type { SearchJob, SearchOptions } from "../services/ask.ts";

export interface Env { DISCORD_PUBLIC_KEY: string; DISCORD_APPLICATION_ID: string; DISCORD_GUILD_ID: string; JOBS_SNAPSHOT_URL: string }
type Defer = (task: () => Promise<void>) => void;
interface Interaction { type: number; application_id?: string; guild_id?: string; token?: string; data?: {name?:string;options?: {name:string;value:unknown}[]} }
const EPHEMERAL = 64;
function hex(value: string, length: number): Uint8Array {
  if (value.length !== length*2 || !/^[0-9a-f]+$/i.test(value)) throw new Error("Invalid hex");
  return Uint8Array.from(value.match(/../g)!, byte => parseInt(byte,16));
}
export async function verifyRequest(key: string, signature: string, timestamp: string, body: string | Uint8Array, now = Date.now()): Promise<boolean> {
  try {
    if (!/^\d{10}$/.test(timestamp) || Math.abs(now - Number(timestamp)*1000) > 300000) return false;
    const publicKey = await crypto.subtle.importKey("raw",hex(key,32),"Ed25519",false,["verify"]);
    return await crypto.subtle.verify("Ed25519",publicKey,hex(signature,64),Buffer.concat([Buffer.from(timestamp), typeof body === "string" ? Buffer.from(body) : body]));
  } catch { return false; }
}
export const MAX_BODY_BYTES = 65536;
const snapshotPattern = /^https:\/\/raw\.githubusercontent\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/bot-state\/jobs\.json$/;
export function askEnv(env: NodeJS.ProcessEnv): Env {
  const { DISCORD_PUBLIC_KEY, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID, JOBS_SNAPSHOT_URL } = env;
  if (!DISCORD_PUBLIC_KEY || !/^[a-f0-9]{64}$/i.test(DISCORD_PUBLIC_KEY) ||
      !DISCORD_APPLICATION_ID || !/^\d{1,20}$/.test(DISCORD_APPLICATION_ID) ||
      !DISCORD_GUILD_ID || !/^\d{1,20}$/.test(DISCORD_GUILD_ID) ||
      !JOBS_SNAPSHOT_URL || !snapshotPattern.test(JOBS_SNAPSHOT_URL))
    throw new Error("Configure DISCORD_PUBLIC_KEY, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID and JOBS_SNAPSHOT_URL");
  return {DISCORD_PUBLIC_KEY,DISCORD_APPLICATION_ID,DISCORD_GUILD_ID,JOBS_SNAPSHOT_URL};
}
export function createInteractionHandler(env: Env, fetcher: typeof fetch = fetch) {
let cached: {url:string; expires:number; jobs:SearchJob[]} | undefined;
let inflight: {url:string; promise:Promise<SearchJob[]>} | undefined;
async function snapshot(url: string): Promise<SearchJob[]> {
  if (!snapshotPattern.test(url)) throw new Error("Invalid snapshot URL");
  if (cached?.url === url && cached.expires > Date.now()) return cached.jobs;
  if (inflight?.url === url) return inflight.promise;
  const promise = (async () => {
    const response = await fetcher(url, {signal:AbortSignal.timeout(10000),redirect:"error"});
    if (!response.ok) throw new Error("Snapshot unavailable");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let size = 0, body = "";
    try {
      for (;;) {
        const {done,value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8_000_000) { await reader.cancel(); throw new Error("Snapshot too large"); }
        body += decoder.decode(value,{stream:true});
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    const jobs = validSnapshot(JSON.parse(body));
    cached = {url,expires:Date.now()+60000,jobs};
    return jobs;
  })();
  inflight = {url,promise};
  try { return await promise; } finally { if (inflight?.promise === promise) inflight = undefined; }
}
const reply = (content: string) => Response.json({type:4,data:{content,flags:EPHEMERAL,allowed_mentions:{parse:[]}}});
async function complete(env: Env, token: string, query: ReturnType<typeof parseAsk>) {
  let data;
  try { data = formatSearch(await snapshot(env.JOBS_SNAPSHOT_URL),query); }
  catch { data = {content:"Job history is unavailable right now. Try again after the next polling run.",allowed_mentions:{parse:[]},embeds:[]}; }
  try {
    const url = "https://discord.com/api/v10/webhooks/"+env.DISCORD_APPLICATION_ID+"/"+encodeURIComponent(token)+"/messages/@original";
    const response = await fetcher(url,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(data),signal:AbortSignal.timeout(8000),redirect:"error"});
    if (!response.ok) console.warn("ask_response_failed",response.status);
  } catch { console.warn("ask_response_failed"); }
}
return async function handle(body: Uint8Array, sig: string, stamp: string, defer: Defer): Promise<Response> {
    if (body.byteLength > MAX_BODY_BYTES || !await verifyRequest(env.DISCORD_PUBLIC_KEY,sig,stamp,body)) return new Response("Unauthorized",{status:401});
    let interaction: Interaction;
    try {
      interaction = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(body));
      if (!interaction || typeof interaction !== "object" || Array.isArray(interaction)) throw new Error("Invalid interaction");
    } catch { return new Response("Bad request",{status:400}); }
    if (interaction.type === 1) return Response.json({type:1});
    if (interaction.type !== 2 || interaction.data?.name !== "ask") return reply(ASK_HELP);
    if (!/^\d+$/.test(env.DISCORD_APPLICATION_ID) || interaction.application_id !== env.DISCORD_APPLICATION_ID ||
        !env.DISCORD_GUILD_ID || interaction.guild_id !== env.DISCORD_GUILD_ID || typeof interaction.token !== "string" || !interaction.token || interaction.token.length > 512) return reply("This command is not available here.");
    let query;
    try {
      const options: SearchOptions = {};
      const seen = new Set<string>();
      for (const option of interaction.data.options ?? []) {
        if (seen.has(option.name)) throw new Error(ASK_HELP);
        seen.add(option.name);
        if (option.name === "days" || option.name === "page") {
          if (typeof option.value !== "number") throw new Error("Invalid numeric option.");
          options[option.name] = option.value;
        } else if (option.name === "company" || option.name === "location") {
          if (typeof option.value !== "string") throw new Error("Invalid text option.");
          options[option.name] = option.value;
        } else throw new Error(ASK_HELP);
      }
      query = parseAsk(options);
    } catch (error) { return reply(error instanceof Error ? error.message : ASK_HELP); }
    const token = interaction.token;
    defer(() => complete(env,token,query));
    return Response.json({type:5,data:{flags:EPHEMERAL}});
  };
}
