import type { Job, JobSource } from "../models/job.ts";
import { getText, plain } from "../utils/http.ts";
import { normalizeUrl } from "../services/identity.ts";

export const FEEDS = {
  "vansh-canada": {
    url: "https://raw.githubusercontent.com/vanshb03/New-Grad-2027/dev/Canada.md",
    label: "Vansh New-Grad Canada"
  },
  "grind-canada": {
    url: "https://raw.githubusercontent.com/grind-fyi/Software-NewGrad-Canada/master/README.md",
    label: "Grind"
  },
  "intern-radar": {
    url: "https://raw.githubusercontent.com/Francklin9999/canada-internship/master/NEW_GRAD.md",
    label: "Intern Radar"
  }
} as const;
export type FeedId = keyof typeof FEEDS;

function cells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return [];
  return trimmed.slice(1).replace(/\|\s*(?:<!--.*?-->)?\s*$/, "")
    .split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
}

function clean(value: string): string {
  return plain(value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*|~~|__|<img\b[^>]*>/gi, "")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")).trim();
}

function link(value: string): string | undefined {
  const candidate = value.match(/\bhref\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1]
    ?? value.match(/\]\((https?:\/\/[^\s]+)\)/i)?.[1];
  if (!candidate) return undefined;
  try { return normalizeUrl(candidate.replace(/&amp;/gi, "&")); }
  catch { return undefined; }
}

function locations(value: string): string[] {
  return value.split(/<\s*\/?br\s*\/?\s*>|;/i).map(clean).filter(Boolean);
}

/**
 * The three upstream Markdown layouts are deliberately handled by header,
 * not by fixed line numbers. No pages, tracking redirects or application
 * systems are requested beyond the configured raw feed.
 */
export function parseCurated(id: FeedId, markdown: string): Job[] {
  const jobs: Job[] = [];
  let header: string[] = [];
  let found = false;
  let previousCompany = "";
  for (const line of markdown.split(/\r?\n/)) {
    const cols = cells(line);
    if (!cols.length) {
      if (line.trim()) { header = []; previousCompany = ""; }
      continue;
    }
    const lower = cols.map(cell => clean(cell).toLowerCase());
    const isHeader = lower.includes("company") && lower.includes("role") && lower.includes("location") &&
      (id === "grind-canada" ? lower.includes("extracted") :
        id === "intern-radar" ? lower.includes("apply") && lower.includes("posted") :
        lower.includes("application/link") && lower.includes("date posted"));
    if (isHeader) { header = lower; found = true; previousCompany = ""; continue; }
    if (lower.includes("company") || cols.every(cell => /^:?-+:?$/.test(cell))) continue;
    if (!header.length || cols.length !== header.length) continue;
    const cell = (name: string) => cols[header.indexOf(name)] ?? "";
    const companyCell = cell("company");
    const roleCell = cell("role");
    const linkCell = id === "grind-canada" ? roleCell : cell(id === "intern-radar" ? "apply" : "application/link");
    const closed = /🔒|~~|^\s*(?:closed|expired|inactive)\s*$/i;
    if (closed.test(companyCell) || closed.test(roleCell) || closed.test(linkCell)) continue;
    let company = clean(companyCell);
    if (/^(?:↳|〃|↑|ditto)$/i.test(company) || !company) company = previousCompany;
    else previousCompany = company;
    const title = clean(roleCell).replace(/^NEW\s+/i, "");
    const url = link(linkCell);
    const jobLocations = locations(cell("location"));
    if (!company || !title || !url || !jobLocations.length) continue;
    // Avoid treating detection dates as employer posting dates. Intern Radar
    // supplies an explicit full date; Vansh omits the year.
    const posted = id === "intern-radar" ? clean(cell("posted").split(/<br\s*\/?>/i)[0]) : "";
    const parsedDate = posted ? Date.parse(posted + " UTC") : NaN;
    jobs.push({
      source: id, externalId: url, company, title, locations: jobLocations, url,
      isNewGrad: id !== "grind-canada",
      postedAt: Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : undefined
    });
  }
  if (!found) throw new Error("Curated feed format changed: expected job table not found");
  return jobs;
}

export function curatedSource(id: FeedId): JobSource {
  return { name: id, async fetchJobs() { return parseCurated(id, await getText(FEEDS[id].url)); } };
}
