import type { BoardConfig, Job, JobSource } from "../models/job.ts";
import { SourceHttpClient, iso, plain, record, rows, str, strings } from "../utils/http.ts";

export function boardName(config: BoardConfig): string {
  return [config.provider, config.region ?? "global", config.board].join(":");
}

export function boardUrl(config: BoardConfig): string {
  const slug = encodeURIComponent(config.board);
  switch (config.provider) {
    case "greenhouse": return "https://boards-api.greenhouse.io/v1/boards/" + slug + "/jobs?content=true";
    case "lever": return "https://api." + (config.region === "eu" ? "eu." : "") + "lever.co/v0/postings/" + slug + "?mode=json";
    case "ashby": return "https://api.ashbyhq.com/posting-api/job-board/" + slug;
  }
}

export function parseBoard(config: BoardConfig, payload: unknown): Job[] {
  const source = boardName(config);
  const base = { source, company: config.company };
  if (config.provider === "lever") return rows(payload).map(row => {
    const categories = record(row.categories);
    const locations = [...strings(categories.allLocations), str(categories.location)].filter(Boolean);
    return { ...base, externalId: str(row.id), title: str(row.text), locations,
      url: str(row.hostedUrl) || str(row.applyUrl), description: plain(row.descriptionPlain || row.description),
      employmentType: str(categories.commitment), postedAt: iso(row.createdAt) };
  });
  const jobs = rows(record(payload).jobs);
  if (config.provider === "greenhouse") return jobs.map(row => {
    const offices = Array.isArray(row.offices) ? row.offices.map(office => str(record(office).location) || str(record(office).name)) : [];
    return { ...base, externalId: String(row.id ?? ""), title: str(row.title),
      locations: [str(record(row.location).name), ...offices].filter(Boolean),
      url: str(row.absolute_url), description: plain(row.content),
      requisitionKey: str(row.requisition_id) ? config.company.toLowerCase() + ":" + str(row.requisition_id) : undefined };
  });
  return jobs.filter(row => row.isListed !== false).map(row => {
    const ashbyLocation = (label: unknown, address: unknown) => {
      const postal = record(record(address).postalAddress);
      const country = str(postal.addressCountry);
      const region = str(postal.addressRegion);
      const city = str(postal.addressLocality);
      if (/^(?:CA|CAN|Canada)$/i.test(country))
        return [city || str(label), region, "Canada"].filter(Boolean).join(", ");
      return str(label);
    };
    const secondary = Array.isArray(row.secondaryLocations) ? row.secondaryLocations.map(value => {
      const location = record(value);
      return ashbyLocation(location.location, location.address);
    }) : [];
    return { ...base, externalId: str(row.id) || str(row.jobUrl), title: str(row.title),
      locations: [ashbyLocation(row.location, row.address), ...secondary].filter(Boolean),
      url: str(row.jobUrl) || str(row.applyUrl), description: plain(row.descriptionPlain || row.descriptionHtml),
      employmentType: str(row.employmentType), postedAt: iso(row.publishedAt) };
  });
}

export function atsSource(config: BoardConfig, http = new SourceHttpClient()): JobSource {
  return { name: boardName(config), async fetchJobs() { return parseBoard(config, await http.getJson(boardUrl(config))); } };
}
