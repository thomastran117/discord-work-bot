import type { Job } from "../models/job.ts";
import { isIP } from "node:net";
import { isCanadian } from "./classifier.ts";

export const JOB_LIMITS = {
  source: 128,
  externalId: 512,
  title: 256,
  company: 256,
  locations: 20,
  location: 256,
  url: 2_048,
  description: 100_000,
  employmentType: 128,
  postedAt: 64,
  startDate: 128,
  requisitionKey: 512
} as const;

const bidiControls = /[\u202a-\u202e\u2066-\u2069]/g;

function bounded(value: unknown, name: string, max: number, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new Error("Missing required job field: " + name);
    return undefined;
  }
  if (typeof value !== "string") throw new Error("Invalid job field: " + name);
  const result = value.replace(bidiControls, "").trim();
  if ((required && !result) || result.length > max) throw new Error("Invalid job field: " + name);
  return result || undefined;
}

export function applicationUrl(input: string): URL {
  if (typeof input !== "string" || input.length > JOB_LIMITS.url) throw new Error("Invalid application URL");
  const url = new URL(input);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const address = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !hostname.includes(".") || hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".home.arpa") || isIP(address))
    throw new Error("Invalid application URL");
  url.hostname = hostname;
  return url;
}

export function normalizeUrl(input: string): string {
  const url = applicationUrl(input);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || /^(?:gh_src|fbclid|gclid|ref|source)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

export function urlIdentity(value: string): string {
  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  if (/^(?:boards|job-boards)\.greenhouse\.io$/i.test(url.hostname)) {
    const index = parts.indexOf("jobs");
    if (index > 0 && /^\d+$/.test(parts[index + 1] ?? "")) return "greenhouse:" + parts[index - 1].toLowerCase() + ":" + parts[index + 1];
  }
  if (/^jobs(?:\.eu)?\.lever\.co$/i.test(url.hostname) && parts.length >= 2) return "lever:" + url.hostname + ":" + parts[0].toLowerCase() + ":" + parts[1];
  if (url.hostname === "jobs.ashbyhq.com" && parts.length >= 2) return "ashby:" + parts[0].toLowerCase() + ":" + parts[1];
  const workday = url.hostname.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i);
  const req = parts.at(-1)?.match(/_([A-Za-z]*\d[\w-]*)$/)?.[1];
  if (workday && parts.includes("job") && req) return "workday:" + workday[1].toLowerCase() + ":" + req.toLowerCase();
  if (["jobs.nokia.com", "fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com"].includes(url.hostname)) {
    const index = parts.indexOf("job");
    if (index >= 0 && /^\d+$/.test(parts[index + 1] ?? "")) return "oracle:nokia:" + parts[index + 1];
  }
  if (url.hostname === "jobs.smartrecruiters.com" && parts.length === 2) {
    const id = parts[1].match(/^(\d+)(?:-|$)/)?.[1];
    if (id) return "smartrecruiters:" + parts[0].toLowerCase() + ":" + id;
  }
  if (url.hostname === "jobs.sap.com" && parts[1] === "jobs" && /^\d+$/.test(parts[2] ?? ""))
    return "smartrecruiters:sapitbusinesssysteme:" + parts[2];
  return value;
}

export function normalizeJob(job: Job): Job {
  const source = bounded(job.source, "source", JOB_LIMITS.source, true)!;
  const externalId = bounded(job.externalId, "externalId", JOB_LIMITS.externalId, true)!;
  const title = bounded(job.title, "title", JOB_LIMITS.title, true)!;
  const company = bounded(job.company, "company", JOB_LIMITS.company, true)!;
  if (!Array.isArray(job.locations) || job.locations.length > JOB_LIMITS.locations)
    throw new Error("Invalid job field: locations");
  const locations = [...new Set(job.locations.map(value => bounded(value, "location", JOB_LIMITS.location)).filter(Boolean) as string[])];
  return {
    source, externalId, title, company, locations: locations.filter(isCanadian), url: normalizeUrl(job.url),
    description: bounded(job.description, "description", JOB_LIMITS.description),
    employmentType: bounded(job.employmentType, "employmentType", JOB_LIMITS.employmentType),
    isNewGrad: job.isNewGrad === true ? true : undefined,
    postedAt: bounded(job.postedAt, "postedAt", JOB_LIMITS.postedAt),
    startDate: bounded(job.startDate, "startDate", JOB_LIMITS.startDate),
    requisitionKey: bounded(job.requisitionKey, "requisitionKey", JOB_LIMITS.requisitionKey)
  };
}
