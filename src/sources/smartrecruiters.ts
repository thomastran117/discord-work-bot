import type { Job } from "../models/job.ts";
import { SourceHttpClient, SourceHttpError, record, rows, str, plain, iso } from "../utils/http.ts";
import { isMechanicalCandidate, hasMechanicalEarlyTitle, isSweCandidateTitle } from "../services/classifier.ts";
import { log } from "../utils/logger.ts";

interface SmartRecruitersBoard {
  company: string;
  tenant: string;
  id: string;
}
const API = "https://api.smartrecruiters.com/v1/companies/";
const JOBS = "https://jobs.smartrecruiters.com/";
const pageSize = 50;
const maxPages = 6;
const maxDetails = 25;
const technical = /\b(?:software|developer|programmer|firmware|embedded|backend|frontend|full[- ]?stack|devops|sre|platform|infrastructure|cloud|machine learning|data engineer|security|systems|swe|sde|développeur|logiciel)\b/i;
const excluded = /\b(?:senior|staff|principal|director|manager|intern(?:ship)?|co[- ]?op|lead|stagiaire)\b/i;
const early = /\b(?:new[- ]grad|junior|early[- ]career|entry[- ]level|associate|engineer i|developer i)\b/i;
const midLevel = /^(?:mid_senior_level|director|executive|not_applicable_senior)$/i;
const internship = /\b(?:intern(?:ship)?|temporary|part[- ]?time|contract)\b/i;

function identifier(value: unknown): string {
  const id = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : str(value);
  return /^\d{1,30}$/.test(id) ? id : "";
}
function countryLocation(value: unknown): string | undefined {
  const location = record(value);
  // Require explicit structured Canadian country evidence even when API
  // filtering is requested; a region named CA can be California.
  if (!/^(?:CA|CAN|Canada)$/i.test((str(location.country) || str(location.countryCode)))) return undefined;
  return [...new Set([str(location.city), str(location.region), "Canada"].filter(Boolean))].join(", ");
}
function titleSlug(title: string): string {
  return title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "job";
}
function jobUrl(board: SmartRecruitersBoard, id: string, title: string): string {
  const slug = encodeURIComponent(board.tenant);
  return JOBS + slug + "/" + id + "-" + titleSlug(title);
}
function isExcluded(row: Record<string, unknown>, mechanicalEnabled = false): boolean {
  const type = record(row.typeOfEmployment);
  const experience = record(row.experienceLevel);
  return internship.test(str(type.label)) || /(?:intern|temporary|part_time|contract)/i.test(str(type.id)) ||
    excluded.test(str(row.name)) ||
    /^(?:director|executive|not_applicable_senior)$/i.test(str(experience.id)) ||
    /\b(?:director|executive)\b/i.test(str(experience.label)) ||
    ((midLevel.test(str(experience.id)) || /\b(?:mid[- ]senior|senior)\b/i.test(str(experience.label))) &&
      !(mechanicalEnabled && isMechanicalCandidate(str(row.name)) && hasMechanicalEarlyTitle(str(row.name))));
}

export function parseSmartRecruitersPage(board: SmartRecruitersBoard, payload: unknown, mechanicalEnabled = false): { total: number; scanned: number; jobs: Job[] } {
  const root = record(payload);
  if (typeof root.totalFound !== "number" || !Number.isSafeInteger(root.totalFound) || root.totalFound < 0)
    throw new Error("Unexpected SmartRecruiters total");
  const postings = rows(root.content);
  const jobs: Job[] = [];
  for (const row of postings) {
    const id = identifier(row.id), title = str(row.name);
    if (!id || !title) throw new Error("Unexpected SmartRecruiters posting shape");
    const location = countryLocation(row.location);
    if (!location || row.active === false || isExcluded(row, mechanicalEnabled) || !(technical.test(title) || isSweCandidateTitle(title) || (mechanicalEnabled && isMechanicalCandidate(title)))) continue;
    const level = record(row.experienceLevel);
    jobs.push({
      source: "smartrecruiters:" + board.id, externalId: id, company: board.company, title,
      locations: [location], url: jobUrl(board, id, title),
      postedAt: iso(row.releasedDate),
      employmentType: str(record(row.typeOfEmployment).label),
      isNewGrad: /^entry_level$/i.test(str(level.id)) || /^entry[- ]level$/i.test(str(level.label))
    });
  }
  return { total: root.totalFound, scanned: postings.length, jobs };
}

export function enrichSmartRecruiters(board: SmartRecruitersBoard, job: Job, payload: unknown, mechanicalEnabled = false): Job | undefined {
  const row = record(payload);
  const title = str(row.name);
  if (identifier(row.id) !== job.externalId || !title) throw new Error("Unexpected SmartRecruiters detail shape");
  if (row.active === false || isExcluded(row, mechanicalEnabled)) return undefined;
  const location = countryLocation(row.location);
  if (!location) return undefined;
  const sections = record(record(row.jobAd).sections);
  // Omit boilerplate company/additional-info sections from classification.
  const description = [record(sections.jobDescription).text, record(sections.qualifications).text]
    .map(plain).filter(Boolean).join(" ");
  const level = record(row.experienceLevel);
  const entry = /^entry_level$/i.test(str(level.id)) || /^entry[- ]level$/i.test(str(level.label));
  return {...job, title, locations: [location], description,
    url: jobUrl(board, job.externalId, title),
    employmentType: str(record(row.typeOfEmployment).label) || job.employmentType,
    isNewGrad: job.isNewGrad || entry,
    postedAt: iso(row.releasedDate) || job.postedAt};
}

export async function fetchSmartRecruiters(board: SmartRecruitersBoard, http = new SourceHttpClient(), signal?: AbortSignal, mechanicalEnabled = false): Promise<Job[]> {
  const endpoint = API + encodeURIComponent(board.tenant) + "/postings";
  const seen = new Map<string, Job>();
  // Preserve the unfiltered pass for SWE and use documented q filters to
  // reach mechanical listings behind the general pagination cap.
  const queries = mechanicalEnabled && board.id !== "sap" ? ["", "mechanical", "mécanique", "manufacturing", "mechatronics", "EIT", "graduate"] : [""];
  for (const query of queries) {
    let offset = 0, candidates = 0, total = 0;
    const pageLimit = query ? 3 : maxPages;
    for (let page = 0; page < pageLimit; page++) {
      const url = new URL(endpoint);
      url.searchParams.set("country", "ca");
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(offset));
      if (query) url.searchParams.set("q", query);
      const result = parseSmartRecruitersPage(board, await http.getJson(url.toString(), signal), mechanicalEnabled);
      total = result.total;
      candidates += result.jobs.length;
      for (const job of result.jobs) seen.set(job.externalId, job);
      offset += result.scanned;
      if (offset >= total) break;
      if (!result.scanned) throw new Error("SmartRecruiters pagination ended before total");
      if (page === pageLimit - 1) log("warn", "career_search_capped", { source: board.id, query: query || "all", total, scanned: offset });
    }
    log("info", "career_search_complete", {source: board.id, query: query || "all", total, scanned: offset, candidates});
  }
  const candidates = [...seen.values()];
  const priority = (job: Job) => Number(!(job.isNewGrad || early.test(job.title) ||
    (mechanicalEnabled && isMechanicalCandidate(job.title) && hasMechanicalEarlyTitle(job.title))));
  candidates.sort((a, b) => priority(a) - priority(b));
  const mechanical = mechanicalEnabled ? candidates.filter(job => isMechanicalCandidate(job.title)) : [];
  const other = candidates.filter(job => !mechanical.includes(job));
  // Keep room for both streams without increasing the detail-request budget.
  const selected = [...other.slice(0, mechanical.length ? Math.ceil(maxDetails / 2) : maxDetails),
    ...mechanical.slice(0, other.length ? Math.floor(maxDetails / 2) : maxDetails)];
  for (const job of candidates) if (selected.length < maxDetails && !selected.includes(job)) selected.push(job);
  if (candidates.length > maxDetails)
    log("warn", "career_detail_capped", {source: board.id, candidates: candidates.length, limit: maxDetails});
  const jobs: Job[] = [];
  for (const job of selected) {
    try {
      // Construct the detail URL from the validated ID, never fetch an
      // upstream-provided ref/applyUrl or follow external redirects.
      const result = enrichSmartRecruiters(board, job, await http.getJson(endpoint + "/" + job.externalId, signal), mechanicalEnabled);
      if (result) jobs.push(result);
    } catch (error) {
      if (error instanceof SourceHttpError && error.status === 404) continue;
      throw error;
    }
  }
  return jobs;
}
