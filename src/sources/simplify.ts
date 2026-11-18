import type { Job, JobSource } from "../models/job.ts";
import { SourceHttpClient, iso, rows, str, strings } from "../utils/http.ts";
import { isCanadian } from "../services/classifier.ts";
import { log } from "../utils/logger.ts";

export const SIMPLIFY_URL = "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json";

export function parseSimplify(payload: unknown, report?: (stats: Record<string, number>) => void): Job[] {
  const input = rows(payload);
  const stats = { fetched: input.length, inactive: 0, hidden: 0, invalidStatus: 0,
    missingVisibility: 0, missingFields: 0, missingDate: 0, canadianMatches: 0,
    locationRejected: 0, parsed: 0 };
  const jobs: Job[] = [];
  for (const row of input) {
    // Keep explicitly closed/hidden jobs excluded. A missing visibility flag
    // is not evidence of closure; active status must still be affirmative.
    if (row.active === false) { stats.inactive++; continue; }
    if (row.is_visible === false) { stats.hidden++; continue; }
    if (row.active !== true || (row.is_visible !== undefined && row.is_visible !== null && row.is_visible !== true)) {
      stats.invalidStatus++; continue;
    }
    if (row.is_visible == null) stats.missingVisibility++;
    const externalId = str(row.id), title = str(row.title), company = str(row.company_name), url = str(row.url);
    if (!externalId || !title || !company || !url) { stats.missingFields++; continue; }
    const locations = Array.isArray(row.locations) ? strings(row.locations) : [str(row.locations)].filter(Boolean);
    const postedAt = iso(row.date_posted, true);
    if (!postedAt) stats.missingDate++;
    if (locations.some(isCanadian)) stats.canadianMatches++;
    else stats.locationRejected++;
    jobs.push({ source: "simplify", externalId, title, company, locations, url,
      isNewGrad: true, postedAt, startDate: str(row.start_date) || undefined });
  }
  stats.parsed = jobs.length;
  report?.(stats);
  return jobs;
}

export function simplifySource(url = SIMPLIFY_URL, http = new SourceHttpClient()): JobSource {
  return { name: "simplify", async fetchJobs() {
    const jobs = parseSimplify(await http.getJson(url), stats => log("info", "simplify_discovery", stats));
    // Reduce global feed volume before the aggregator's per-source job limit.
    // Geography is decided locally, not by an upstream Canada search filter.
    return jobs.filter(job => job.locations.some(isCanadian));
  } };
}
