import type { Job, JobSource } from "../models/job.ts";
import type { JobsRepository } from "../repositories/jobs.ts";
import { eligible } from "./classifier.ts";
import { extractStartDate } from "./enrichment.ts";
import { normalizeJob, urlIdentity } from "./identity.ts";
import { SOURCE_DATA_LIMITS } from "../utils/http.ts";
import { log } from "../utils/logger.ts";
import { PermanentDeliveryError } from "./delivery.ts";

interface Options {
  repository?: JobsRepository;
  publish?: (job: Job) => Promise<string>;
  seedFirst: boolean;
  maxNotifications: number;
  dryRun?: boolean;
  backfill?: boolean;
}

export async function runAggregation(sources: JobSource[], options: Options) {
  let failed = 0, delivered = 0, rejected = 0, matched = 0;
  const previews = new Map<string, Job>();
  // Sequential reads keep load low; a failed source does not block others.
  for (const source of sources) {
    try {
      const raw = await source.fetchJobs();
      if (!Array.isArray(raw) || raw.length > SOURCE_DATA_LIMITS.jobs)
        throw new Error("Source returned too many jobs");
      const jobs: Job[] = [];
      let invalid = 0;
      for (const job of raw) {
        try {
          const candidate = normalizeJob(job);
          if (!eligible(candidate)) continue;
          // Extract the term before dropping description text. Only notification metadata
          // is persisted, including in the public bot-state branch on GitHub Actions.
          const normalized = normalizeJob({ ...candidate, startDate: extractStartDate(candidate) });
          delete normalized.description;
          jobs.push(normalized);
        } catch { invalid++; }
      }
      matched += jobs.length;
      if (options.dryRun) {
        for (const job of jobs) previews.set(urlIdentity(job.url), job);
        log("info", "source_preview", { source: source.name, fetched: raw.length, matched: jobs.length, invalid });
      } else {
        const stats = options.repository!.ingest(source.name, jobs, options.seedFirst, options.backfill);
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
    const queue = options.repository!.pending(options.maxNotifications);
    log("info", "delivery_queue", { ...options.repository!.counts(), selected: queue.length, limit: options.maxNotifications, backfill: options.backfill === true });
    if (!queue.length) log("info", "no_notifications", { reason: "No pending jobs; existing matches may be seeded or already sent. Use backfill for currently eligible seeded jobs, or test-webhook to check Discord." });
    for (const item of queue) {
      try {
        const id = await options.publish!(item.job);
        options.repository!.markSent(item.id, id);
        delivered++;
        log("info", "notification_sent", { jobId: item.id, messageId: id });
      } catch (error) {
        if (error instanceof PermanentDeliveryError) {
          options.repository!.markRejected(item.id, error.message);
          rejected++;
          log("error", "notification_rejected", { jobId: item.id, error: error.message });
          continue;
        }
        log("error", "delivery_deferred", { error: error instanceof Error ? error.message : "Unknown error" });
        return { failed, delivered, rejected, matched, deliveryFailed: true };
      }
    }
  }
  log("info", "poll_complete", { failed, delivered, matched, sources: sources.length, ...(options.repository && !options.dryRun ? options.repository.counts() : {}) });
  return { failed, delivered, rejected, matched, deliveryFailed: false };
}
