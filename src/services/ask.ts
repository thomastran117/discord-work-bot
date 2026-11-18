import type { JobCategory } from "../models/job.ts";
import { postedTime, backfillWindow, MAX_BACKFILL_DAYS } from "./backfill.ts";

export interface SearchJob {
  company: string; title: string; locations: string[]; url: string;
  postedAt?: string; firstSeenAt: string; category?: JobCategory;
}
export interface SearchOptions {
  company?: string; location?: string; days?: number; page?: number; category?: string;
}
export interface SearchQuery { company?: string; location?: string; days: number; page: number; category?: JobCategory }
export const PAGE_SIZE = 5;
export const ASK_HELP = "Use /ask with optional company, location, days (1–30), page and category (swe or mechanical). Example: /ask company:Nokia location:Ottawa days:7.";
const FILTER_MAX = 100;

function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > FILTER_MAX || !folded(value)) throw new Error("Company and location must contain letters or numbers and be at most 100 characters.");
  return value.trim();
}
export function parseAsk(options: SearchOptions): SearchQuery {
  if (Object.keys(options).some(key => !["company","location","days","page","category"].includes(key)))
    throw new Error(ASK_HELP);
  const company = clean(options.company), location = clean(options.location);
  let days = options.days;
  days ??= MAX_BACKFILL_DAYS;
  backfillWindow(days);
  const page = options.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new Error("Page must be a positive whole number (max 100000).");
  const category = options.category;
  if (category !== undefined && category !== "swe" && category !== "mechanical") throw new Error("Invalid job category.");
  return { company, location, days, page, ...(category ? { category } : {}) };
}
// Normalization is shared by direct, alias and fuzzy matching.
function folded(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
type Field = "company" | "location";
const aliases: Record<Field, string[][]> = {
  company: [["rbc","royal bank of canada"]],
  location: [
    ["on","ontario"], ["qc","quebec"], ["bc","british columbia"],
    ["ab","alberta"], ["mb","manitoba"], ["sk","saskatchewan"],
    ["ns","nova scotia"], ["nb","new brunswick"], ["nl","newfoundland and labrador"],
    ["pe","prince edward island"], ["nt","northwest territories"], ["nu","nunavut"], ["yt","yukon"]
  ]
};
function exactMatch(value: string, term: string): boolean {
  if (term.length <= 3) return (" "+value+" ").includes(" "+term+" ");
  return value.includes(term);
}

// Optimal string alignment (restricted Damerau-Levenshtein): adjacent
// transpositions count as one edit. Only calculate the bounded diagonal.
function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length-b.length) > limit) return limit+1;
  const inf=limit+1;
  let older: number[] = [], previous = Array.from({length:b.length+1},(_,i)=>Math.min(i,inf));
  for (let i=1;i<=a.length;i++) {
    const row=Array(b.length+1).fill(inf);
    row[0]=Math.min(i,inf);
    for (let j=Math.max(1,i-limit);j<=Math.min(b.length,i+limit);j++) {
      row[j]=Math.min(previous[j]+1,row[j-1]+1,previous[j-1]+Number(a[i-1]!==b[j-1]));
      if (i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1])
        row[j]=Math.min(row[j],older[j-2]+1);
    }
    older=previous; previous=row;
  }
  return previous[b.length];
}
function fuzzyDistance(value: string, term: string): number {
  // Keep short acronyms exact. Compare contiguous words, rather than
  // full employer/location strings (e.g. "Ottwa" vs "Ottawa, ON").
  if (term.length<4) return Infinity;
  const limit=term.length>=8 ? 2 : 1;
  const words=value.split(" ");
  const count=term.split(" ").length;
  let best=Infinity;
  for(let i=0;i<words.length;i++) {
    for(let n=Math.max(1,count-1);n<=count+1 && i+n<=words.length;n++) {
      const candidate=words.slice(i,i+n).join(" ");
      if(candidate.length<4 || Math.abs(candidate.length-term.length)>limit) continue;
      const edits=distance(term,candidate,limit);
      if(edits<=limit) best=Math.min(best,edits);
    }
  }
  return best;
}
function resolveFilter(values: string[], filter: string | undefined, field: Field) {
  if (!filter) return { matches: (_:string)=>true, fuzzy:false };
  const term=folded(filter);
  const group=aliases[field].find(names=>names.includes(term));
  const terms=group ?? [term];
  const unique=[...new Set(values.map(folded))];
  const direct=unique.filter(value=>terms.some(t=>exactMatch(value,t)));
  if (direct.length) {
    const accepted=new Set(direct);
    return { matches:(value:string)=>accepted.has(folded(value)),fuzzy:false };
  }
  // A typo in a long-form alias may match a short stored code, but
  // never edit the short code itself. Use only the closest candidates.
  let best=Infinity;
  let accepted=new Set<string>();
  for (const value of unique) {
    const expanded=[value,...aliases[field].filter(names=>names.some(name=>exactMatch(value,name))).flat()];
    let score=Infinity;
    for (const candidate of expanded) for (const t of terms) score=Math.min(score,fuzzyDistance(candidate,t));
    if (!Number.isFinite(score)) continue;
    if (score<best) { accepted=new Set(); best=score; }
    if (score===best) accepted.add(value);
  }
  return { matches:(value:string)=>accepted.has(folded(value)),fuzzy:accepted.size>0 };
}
export function searchJobs(jobs: SearchJob[], query: SearchQuery, now = Date.now()) {
  const window = backfillWindow(query.days, now);
  const dated = jobs.flatMap(job => {
    if (query.category && (job.category ?? "swe") !== query.category) return [];
    const published = postedTime(job.postedAt);
    const seen = postedTime(job.firstSeenAt);
    const at = published ?? seen;
    if (at === undefined || at < window.from || at > window.through) return [];
    return [{ job, at, dateKind: published === undefined ? "First seen" : "Posted" }];
  });
  const company=resolveFilter(dated.map(x=>x.job.company),query.company,"company");
  const location=resolveFilter(dated.flatMap(x=>x.job.locations),query.location,"location");
  const matchesList=dated.filter(({job})=>company.matches(job.company) &&
    (!query.location || job.locations.some(location.matches)))
    .sort((a,b) => b.at - a.at || a.job.company.localeCompare(b.job.company) || a.job.title.localeCompare(b.job.title) || a.job.url.localeCompare(b.job.url));
  const total = matchesList.length, pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (query.page - 1) * PAGE_SIZE;
  const fuzzyFields = total ? [company.fuzzy ? "company" : "",location.fuzzy ? "location" : ""].filter(Boolean) : [];
  return { total, pages, page: query.page, known: matchesList.filter(x => x.dateKind === "Posted").length, fuzzyFields, items: matchesList.slice(start, start + PAGE_SIZE) };
}
export function validSnapshot(input: unknown): SearchJob[] {
  const snapshot = input as { version?: unknown; jobs?: unknown };
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.jobs) || snapshot.jobs.length > 50000) throw new Error("Invalid search snapshot.");
  return snapshot.jobs.map(row => {
    if (!row || typeof row.company !== "string" || row.company.length > 256 || typeof row.title !== "string" || row.title.length > 256 ||
        !Array.isArray(row.locations) || row.locations.length > 20 || !row.locations.every((x: unknown) => typeof x === "string" && x.length <= 256) ||
        typeof row.url !== "string" || row.url.length > 2048 || postedTime(row.firstSeenAt) === undefined ||
        (row.postedAt !== undefined && postedTime(row.postedAt) === undefined) ||
        (row.category !== undefined && row.category !== "swe" && row.category !== "mechanical")) throw new Error("Invalid search row.");
    const url = new URL(row.url);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid search URL.");
    return row as SearchJob;
  });
}
function display(value: string, max: number): string {
  return value.replace(/[\r\n\t]/g, " ").replace(/[\u202a-\u202e\u2066-\u2069]/g, "").slice(0,max).replace(/[\\*_\x60~|[\]<>]/g, "\\$&");
}
export function formatSearch(jobs: SearchJob[], query: SearchQuery, now = Date.now()) {
  const result = searchJobs(jobs, query, now);
  const scope = "Last " + query.days + " days" + (query.category ? " · " + (query.category === "swe" ? "Software engineering" : "Mechanical engineering") : "") + (query.company ? " · " + display(query.company,100) : "") + (query.location ? " · " + display(query.location,100) : "");
  const header = scope + "\n" + result.total + " collected match(es): " + result.known + " dated, " + (result.total-result.known) + " first seen (publication date unknown).";
  const note = (result.fuzzyFields.length ? "\nApproximate match applied to: " + result.fuzzyFields.join(", ") + ". Check the names on the cards." : "") + "\nSearches monitored sources only; availability is not rechecked.";
  const page = result.total === 0 ? "" : result.page > result.pages ? "\nPage not found. Use a page from 1 to " + result.pages + "." : "\nPage " + result.page + " of " + result.pages + (result.page < result.pages ? " · repeat /ask with page:" + (result.page+1) : "");
  return { content: header + page + note, allowed_mentions: { parse: [] }, embeds: result.items.map(({job,at,dateKind}) => ({
    title: display(job.title,120).slice(0,240), url: job.url, color: job.category === "mechanical" ? 0x0f9d86 : 0x5865f2,
    description: "**" + display(job.company,100) + "** · " + display(job.locations.join(" / "),180) + "\n" + dateKind + ": " + new Date(at).toISOString().slice(0,10)
  })) };
}
export const askCommand = {
  name: "ask", description: "Search collected job postings from the last 30 days", type: 1,
  options: [
    {type:3,name:"company",description:"Company name (typos tolerated)",max_length:FILTER_MAX},
    {type:3,name:"location",description:"City, province or location (typos tolerated)",max_length:FILTER_MAX},
    {type:4,name:"days",description:"Lookback days (default 30)",min_value:1,max_value:30},
    {type:4,name:"page",description:"Results page (default 1)",min_value:1,max_value:100000},
    {type:3,name:"category",description:"Engineering discipline (default both)",choices:[{name:"Software engineering",value:"swe"},{name:"Mechanical engineering",value:"mechanical"}]}
  ]
};
