import { postedTime, backfillWindow, MAX_BACKFILL_DAYS } from "./backfill.ts";

export interface SearchJob {
  company: string; title: string; locations: string[]; url: string;
  postedAt?: string; firstSeenAt: string;
}
export interface SearchOptions {
  question?: string; company?: string; location?: string; days?: number; page?: number;
}
export interface SearchQuery { company?: string; location?: string; days: number; page: number }
export const PAGE_SIZE = 5;
export const ASK_HELP = "Try: Did RBC post in the last 3 days? | Give me postings from the past 7 days | Find all Nokia postings | Find postings in Ottawa. Or use company, location and days filters.";

function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 200 || !value.trim()) throw new Error("Invalid search text.");
  return value.trim();
}
export function parseAsk(options: SearchOptions): SearchQuery {
  let company = clean(options.company), location = clean(options.location), days = options.days;
  const question = clean(options.question);
  if (question) {
    if (company || location || days !== undefined) throw new Error("Use either question or structured filters, not both.");
    let q = question.replace(/[?!.]+$/, "").trim();
    const window = q.match(/\s+(?:from\s+|in\s+|during\s+|over\s+|within\s+)?(?:the\s+)?(?:last|past)\s+(\d+)\s+days?$/i);
    if (window) { days = Number(window[1]); q = q.slice(0, window.index).trim(); }
    else q = q.replace(/\s+in\s+(?:the\s+)?(?:max(?:imum)?|full)\s+window$/i, "");
    const did = q.match(/^(?:did|has|have)\s+(.+?)\s+(?:post(?:ed)?|publish(?:ed)?|list(?:ed)?)(?:\s+(?:any\s+)?(?:jobs|postings|roles))?$/i);
    if (did) company = clean(did[1]);
    else {
      const list = q.match(/^(?:(?:give me|show me|find|list)\s+)?(?:all\s+)?(?:the\s+)?(?:(.+?)\s+)?(?:job\s+)?(?:postings?|jobs?|roles?)(?:\s+(?:in|at|from|for)\s+(.+))?$/i);
      if (!list) throw new Error(ASK_HELP);
      company = clean(list[1]); location = clean(list[2]);
      if (location && /\s(?:at|from|for)\s/i.test(q)) { company = location; location = undefined; }
    }
  }
  days ??= MAX_BACKFILL_DAYS;
  backfillWindow(days);
  const page = options.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new Error("Page must be a positive whole number (max 100000).");
  return { company, location, days, page };
}
function folded(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
}
function matches(value: string, filter?: string): boolean {
  if (!filter) return true;
  const aliases: Record<string, string[]> = {
    "rbc": ["royal bank of canada", "rbc"], "royal bank of canada": ["royal bank of canada", "rbc"],
    "ontario": ["ontario", "on"], "quebec": ["quebec", "qc"], "british columbia": ["british columbia", "bc"]
  };
  const term = folded(filter), haystack = folded(value);
  return (aliases[term] ?? [term]).some(alias => {
    if (alias.length <= 3) return haystack.split(/[^\p{L}\p{N}]+/u).includes(alias);
    return haystack.includes(alias);
  });
}
export function searchJobs(jobs: SearchJob[], query: SearchQuery, now = Date.now()) {
  const window = backfillWindow(query.days, now);
  const matchesList = jobs.flatMap(job => {
    const published = postedTime(job.postedAt);
    const seen = postedTime(job.firstSeenAt);
    const at = published ?? seen;
    if (at === undefined || at < window.from || at > window.through ||
        !matches(job.company, query.company) ||
        (query.location && !job.locations.some(location => matches(location, query.location)))) return [];
    return [{ job, at, dateKind: published === undefined ? "First seen" : "Posted" }];
  }).sort((a,b) => b.at - a.at || a.job.company.localeCompare(b.job.company) || a.job.title.localeCompare(b.job.title) || a.job.url.localeCompare(b.job.url));
  const total = matchesList.length, pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (query.page - 1) * PAGE_SIZE;
  return { total, pages, page: query.page, known: matchesList.filter(x => x.dateKind === "Posted").length, items: matchesList.slice(start, start + PAGE_SIZE) };
}
export function validSnapshot(input: unknown): SearchJob[] {
  const snapshot = input as { version?: unknown; jobs?: unknown };
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.jobs) || snapshot.jobs.length > 50000) throw new Error("Invalid search snapshot.");
  return snapshot.jobs.map(row => {
    if (!row || typeof row.company !== "string" || row.company.length > 256 || typeof row.title !== "string" || row.title.length > 256 ||
        !Array.isArray(row.locations) || row.locations.length > 20 || !row.locations.every((x: unknown) => typeof x === "string" && x.length <= 256) ||
        typeof row.url !== "string" || row.url.length > 2048 || postedTime(row.firstSeenAt) === undefined ||
        (row.postedAt !== undefined && postedTime(row.postedAt) === undefined)) throw new Error("Invalid search row.");
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
  const scope = "Last " + query.days + " days" + (query.company ? " · " + display(query.company,100) : "") + (query.location ? " · " + display(query.location,100) : "");
  const header = scope + "\n" + result.total + " collected match(es): " + result.known + " dated, " + (result.total-result.known) + " first seen (publication date unknown).";
  const note = "\nSearches monitored sources only; availability is not rechecked.";
  const page = result.total === 0 ? "" : result.page > result.pages ? "\nPage not found. Use a page from 1 to " + result.pages + "." : "\nPage " + result.page + " of " + result.pages + (result.page < result.pages ? " · repeat /ask with page:" + (result.page+1) : "");
  return { content: header + page + note, allowed_mentions: { parse: [] }, embeds: result.items.map(({job,at,dateKind}) => ({
    title: display(job.title,120).slice(0,240), url: job.url, color: 0x5865f2,
    description: "**" + display(job.company,100) + "** · " + display(job.locations.join(" / "),180) + "\n" + dateKind + ": " + new Date(at).toISOString().slice(0,10)
  })) };
}
export const askCommand = {
  name: "ask", description: "Search collected job postings from the last 30 days", type: 1,
  options: [
    {type:3,name:"question",description:"Ask about jobs, a company, location or date window",max_length:200},
    {type:3,name:"company",description:"Company name (case-insensitive)",max_length:200},
    {type:3,name:"location",description:"City, province or location",max_length:200},
    {type:4,name:"days",description:"Lookback days (default 30)",min_value:1,max_value:30},
    {type:4,name:"page",description:"Results page (default 1)",min_value:1,max_value:100000}
  ]
};
