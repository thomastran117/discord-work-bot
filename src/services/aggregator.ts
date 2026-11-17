import type { Job, JobSource } from "../models/job.ts";
import type { JobsRepository } from "../repositories/jobs.ts";
import { eligible } from "./classifier.ts";
import { extractStartDate } from "./enrichment.ts";
import { normalizeJob, urlIdentity } from "./identity.ts";
import { log } from "../utils/logger.ts";

interface Options {
  repository?: JobsRepository;
  publish?: (job: Job) => Promise<string>;
  seedFirst: boolean;
  maxNotifications: number;
  dryRun?: boolean;
}

export async function runAggregation(sources: JobSource[], options: Options) {
  let failed = 0, delivered = 0, matched = 0;
  const previews = new Map<string, Job>();
  // Sequential reads keep load low; a failed source does not block others.
  for (const source of sources) {
    try {
      const raw = await source.fetchJobs();
      const jobs: Job[] = [];
      let invalid = 0;
      for (const job of raw) {
        try {
          if (!eligible(job)) continue;
          // Extract the term before dropping description text. Only notification metadata
          // is persisted, including in the public bot-state branch on GitHub Actions.
          const normalized = normalizeJob({ ...job, startDate: extractStartDate(job) });
          delete normalized.description;
          jobs.push(normalized);
        } catch { invalid++; }
      }
      matched += jobs.length;
      if (options.dryRun) {
        for (const job of jobs) previews.set(urlIdentity(job.url), job);
        log("info", "source_preview", { source: source.name, fetched: raw.length, matched: jobs.length, invalid });
      } else {
        const stats = options.repository!.ingest(source.name, jobs, options.seedFirst);
        log("info", "source_complete", { source: source.name, fetched: raw.length, matched: jobs.length, invalid, ...stats });
      }
    } catch (error) {
      failed++;
      log("error", "source_failed", { source: source.name, error: error instanceof Error ? error.message : "Unknown error" });
    }
  }
  if (options.dryRun) {
    for (const job of previews.values()) log("info", "preview_job", { title: job.title, company: job.company, locations: job.locations, startDate: job.startDate ?? "Not specified", url: job.url });
  } else {
    for (const item of options.repository!.pending(options.maxNotifications)) {
      try {
        const id = await options.publish!(item.job);
        options.repository!.markSent(item.id, id);
        delivered++;
      } catch (error) {
        log("error", "delivery_deferred", { error: error instanceof Error ? error.message : "Unknown error" });
        return { failed, delivered, matched, deliveryFailed: true };
      }
    }
  }
  log("info", "poll_complete", { failed, delivered, matched, sources: sources.length });
  return { failed, delivered, matched, deliveryFailed: false };
}
