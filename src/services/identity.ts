import type { Job } from "../models/job.ts";
import { isCanadian } from "./classifier.ts";

export function normalizeUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported application URL");
  if (url.username || url.password) throw new Error("Application URL contains credentials");
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
  return value;
}

export function normalizeJob(job: Job): Job {
  if (!job.source || !job.externalId || !job.title?.trim() || !job.company?.trim()) throw new Error("Missing required job fields");
  const locations = [...new Set(job.locations.map(s => s.trim()).filter(Boolean))];
  return { ...job, title: job.title.trim(), company: job.company.trim(),
    locations: locations.filter(isCanadian), url: normalizeUrl(job.url) };
}
