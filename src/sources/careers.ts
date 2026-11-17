import type { Job, JobSource } from "../models/job.ts";
import { SourceHttpClient, SourceHttpError, record, rows, str, strings, plain, iso } from "../utils/http.ts";
import { isCanadian } from "../services/classifier.ts";
import { log } from "../utils/logger.ts";
import { fetchSmartRecruiters } from "./smartrecruiters.ts";

export const CAREERS = {
  ciena: { provider: "workday", company: "Ciena", origin: "https://ciena.wd5.myworkdayjobs.com", tenant: "ciena", site: "Careers" },
  rbc: { provider: "workday", company: "RBC", origin: "https://rbc.wd3.myworkdayjobs.com", tenant: "rbc", site: "RBCGLOBAL1" },
  nokia: { provider: "oracle", company: "Nokia", origin: "https://fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com", site: "CX_1", canadaId: "300000000471544" },
  sap: { provider: "smartrecruiters", company: "SAP", tenant: "SAPITBusinessSysteme" },
  autodesk: { provider: "workday", company: "Autodesk", origin: "https://autodesk.wd1.myworkdayjobs.com", tenant: "autodesk", site: "Ext" }
} as const;
export type CareerId = keyof typeof CAREERS;
type WorkdayBoard = Extract<typeof CAREERS[CareerId], { provider: "workday" }>;
type OracleBoard = typeof CAREERS.nokia;

const workdayBase = (board: WorkdayBoard) => board.origin + "/wday/cxs/" + board.tenant + "/" + board.site;
const technical = /\b(?:software|developer|programmer|firmware|embedded|backend|frontend|full[- ]?stack|devops|sre|systems|platform|cloud|infrastructure|machine learning|data engineer|security|network engineer|test engineer|swe|sde|développeur|logiciel)\b/i;
const excluded = /\b(?:senior|staff|principal|director|manager|intern(?:ship)?|co[- ]?op|lead|stagiaire)\b/i;
const multiLocation = /^\s*\d+\s+locations?\s*$/i;
const keywords = ["software", "developer", "firmware", "engineering", "new grad", "early career"];
const pageSize = 20;
const maxPages = 10;
const maxDetails = 36;

function workdayPath(value: unknown): string {
  const path = str(value);
  return /^\/job\/[^?#]+$/.test(path) && !path.includes("\\") && !path.split("/").includes("..") ? path : "";
}
function stringId(value: unknown): string {
  return typeof value === "number" && Number.isSafeInteger(value) ? String(value) : str(value);
}

// Autodesk uses explicit ISO alpha-3 markers such as "Toronto-ON-CAN".
// Do not interpret the ambiguous US/Canada abbreviation CA as Canada.
function workdayLocation(company: string, label: string): string {
  if (company === "Autodesk" && /(?:^|[\s,-])CAN(?=$|[\s,-])/.test(label))
    return label.replace(/(?:,\s*|\s*-\s*|\s+)CAN(?=$|[\s,-])/, ", Canada").replace(/^CAN$/, "Canada");
  return label;
}

export function parseWorkdayList(board: WorkdayBoard, payload: unknown): { total: number; jobs: Job[] } {
  const root = record(payload);
  if (typeof root.total !== "number" || !Number.isSafeInteger(root.total) || root.total < 0)
    throw new Error("Unexpected Workday total");
  const list = rows(root.jobPostings);
  const jobs = list.map(row => {
    const path = workdayPath(row.externalPath);
    const title = str(row.title);
    const req = strings(row.bulletFields)[0];
    if (!path || !title) throw new Error("Unexpected Workday posting shape");
    return {
      source: "workday:" + board.tenant, company: board.company,
      externalId: req || path, title, locations: [workdayLocation(board.company, str(row.locationsText))].filter(Boolean),
      url: board.origin + "/" + board.site + path,
      requisitionKey: req ? board.company.toLowerCase() + ":" + req : undefined
    };
  });
  return { total: root.total, jobs };
}

export function enrichWorkday(job: Job, payload: unknown): Job {
  const info = record(record(payload).jobPostingInfo);
  if (!str(info.title)) throw new Error("Unexpected Workday detail shape");
  const req = str(info.jobReqId);
  const location = workdayLocation(job.company, str(info.location));
  const country = str(record(record(info.jobRequisitionLocation).country).alpha2Code);
  const primary = country === "CA" && location && !isCanadian(location) ? location + ", Canada" : location;
  const locations = [primary, ...strings(info.additionalLocations).map(value => workdayLocation(job.company, value))].filter(Boolean);
  return { ...job, title: str(info.title), locations: locations.length ? locations : job.locations,
    description: plain(info.jobDescription), employmentType: str(info.timeType),
    // Workday's startDate is a posting date, not a candidate's start date.
    postedAt: iso(info.startDate),
    requisitionKey: req ? job.company.toLowerCase() + ":" + req : job.requisitionKey };
}

export async function fetchWorkday(board: WorkdayBoard, http = new SourceHttpClient(), signal?: AbortSignal): Promise<Job[]> {
  const seen = new Map<string, Job>();
  for (const keyword of keywords) {
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const raw = await http.postSearchJson(workdayBase(board) + "/jobs", {
        appliedFacets: {}, limit: pageSize, offset, searchText: keyword
      }, signal);
      const { total, jobs } = parseWorkdayList(board, raw);
      for (const job of jobs) seen.set(job.url, job);
      offset += jobs.length;
      if (offset >= total) break;
      if (!jobs.length) throw new Error("Workday pagination ended before total");
      if (page === maxPages - 1) log("warn", "career_search_capped", { source: board.tenant, keyword, total, scanned: offset });
    }
  }
  const candidates = [...seen.values()].filter(job => technical.test(job.title) && !excluded.test(job.title) &&
    (job.locations.some(isCanadian) || job.locations.some(value => multiLocation.test(value)) || !job.locations.length));
  // Prefer explicit early-career roles when the per-source detail budget is reached.
  const priority = (job: Job) => /\b(new[- ]grad|junior|early[- ]career|entry[- ]level|associate|engineer i|developer i)\b/i.test(job.title) ? 0 : 1;
  candidates.sort((a,b) => priority(a) - priority(b));
  if (candidates.length > maxDetails) log("warn", "career_detail_capped", { source: board.tenant, candidates: candidates.length, limit: maxDetails });
  const result: Job[] = [];
  for (const job of candidates.slice(0, maxDetails)) {
    const path = new URL(job.url).pathname.slice(board.site.length + 1);
    try {
      const detail = await http.getJson(workdayBase(board) + path, signal);
      result.push(enrichWorkday(job, detail));
    } catch (error) {
      // A posting can close between list and detail. For an HTTP 404, skip it.
      if (error instanceof SourceHttpError && error.status === 404) continue;
      throw error;
    }
  }
  return result;
}

function oracleLocation(value: unknown): string {
  const row = record(value);
  if (typeof value === "string") return str(value);
  const label = str(row.Name) || str(row.LocationName) || str(row.Location) || str(row.TownOrCity);
  const country = str(row.Country) || str(row.CountryCode);
  return /^(?:CA|CAN|Canada)$/i.test(country) && !isCanadian(label) ? [label, "Canada"].filter(Boolean).join(", ") : label;
}

export function parseOraclePage(board: OracleBoard, payload: unknown): { total: number; jobs: Job[] } {
  const roots = rows(record(payload).items);
  if (roots.length !== 1) throw new Error("Unexpected Oracle search envelope");
  const root = roots[0];
  if (typeof root.TotalJobsCount !== "number" || !Number.isSafeInteger(root.TotalJobsCount) || root.TotalJobsCount < 0)
    throw new Error("Unexpected Oracle search total");
  const jobs = rows(root.requisitionList).map(row => {
    const id = stringId(row.Id);
    const title = str(row.Title);
    if (!id || !/^\d+$/.test(id) || !title) throw new Error("Unexpected Oracle job posting shape");
    let primary = str(row.PrimaryLocation);
    if (str(row.PrimaryLocationCountry) === "CA" && !isCanadian(primary)) primary = [primary, "Canada"].filter(Boolean).join(", ");
    const extra = [row.SecondaryLocations, row.secondaryLocations, row.otherWorkLocations, row.workLocation]
      .flatMap(value => Array.isArray(value) ? value.map(oracleLocation) : typeof value === "string" ? value.split(";") : []);
    return {
      source: "oracle:nokia", company: board.company, externalId: id, title,
      locations: [...new Set([primary, ...extra].map(str).filter(Boolean))],
      url: board.origin + "/hcmUI/CandidateExperience/en/sites/" + board.site + "/job/" + id,
      description: plain(row.ShortDescriptionStr || row.ShortDescription),
      employmentType: str(row.JobSchedule),
      postedAt: iso(row.PostedDate)
    };
  });
  return { total: root.TotalJobsCount, jobs };
}

export async function fetchOracle(board: OracleBoard, http = new SourceHttpClient(), signal?: AbortSignal): Promise<Job[]> {
  const seen = new Map<string, Job>();
  let offset = 0;
  const limit = 25;
  for (let page = 0; page < 12; page++) {
    const url = new URL(board.origin + "/hcmRestApi/resources/latest/recruitingCEJobRequisitions");
    url.searchParams.set("onlyData", "true");
    url.searchParams.set("expand", "requisitionList");
    url.searchParams.set("finder", "findReqs;siteNumber=" + board.site + ",locationId=" + board.canadaId +
      ",limit=" + limit + ",offset=" + offset);
    const { jobs, total } = parseOraclePage(board, await http.getJson(url.toString(), signal));
    const before = seen.size;
    for (const job of jobs) seen.set(job.externalId, job);
    offset += jobs.length;
    if (offset >= total) return [...seen.values()];
    if (!jobs.length || seen.size === before) throw new Error("Oracle pagination did not advance");
  }
  throw new Error("Oracle search exceeded the bounded page budget");
}

export function careerSource(id: CareerId, http = new SourceHttpClient()): JobSource {
  const board = CAREERS[id];
  const name = board.provider + ":" + id;
  return { name, async fetchJobs() {
    // Allow time for the deliberate request pacing while bounding the entire
    // search. The signal also cancels retry sleeps and detail requests.
    const deadline = AbortSignal.timeout(board.provider === "workday" ? 240_000 : 120_000);
    switch (board.provider) {
      case "workday": return fetchWorkday(board, http, deadline);
      case "oracle": return fetchOracle(board, http, deadline);
      case "smartrecruiters": return fetchSmartRecruiters(board, http, deadline);
    }
  } };
}
