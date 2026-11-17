import type { Job, JobSource } from "../models/job.ts";
import { getJson, iso, rows, str, strings } from "../utils/http.ts";

export const SIMPLIFY_URL = "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json";

export function parseSimplify(payload: unknown): Job[] {
  return rows(payload).filter(row => row.active === true && row.is_visible === true)
    .map(row => ({
      source: "simplify",
      externalId: str(row.id),
      title: str(row.title),
      company: str(row.company_name),
      locations: strings(row.locations),
      url: str(row.url),
      isNewGrad: true,
      postedAt: iso(row.date_posted, true),
      startDate: str(row.start_date) || undefined
    }));
}

export function simplifySource(url = SIMPLIFY_URL): JobSource {
  return { name: "simplify", async fetchJobs() { return parseSimplify(await getJson(url)); } };
}
