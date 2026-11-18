import type { Job, JobSource, JobCategory } from "../models/job.ts";
import type { JobsRepository } from "../repositories/jobs.ts";
import { classifyJob, assessMechanical } from "./classifier.ts";
import { extractStartDate } from "./enrichment.ts";
import { normalizeJob, urlIdentity } from "./identity.ts";
import { SOURCE_DATA_LIMITS } from "../utils/http.ts";
import { log } from "../utils/logger.ts";
import { PermanentDeliveryError } from "./delivery.ts";
import type { BackfillWindow } from "./backfill.ts";

interface Options {
  repository?: JobsRepository;
  publish?: (job: Job) => Promise<string>;
  seedFirst: boolean;
  mechanicalEnabled?: boolean;
  maxNotifications: number;
  dryRun?: boolean;
  backfill?: BackfillWindow;
}

export async function runAggregation(sources: JobSource[], options: Options) {
  let failed = 0, delivered = 0, rejected = 0, matched = 0, selected = 0;
  const categories: JobCategory[] = options.mechanicalEnabled || options.dryRun ? ["swe", "mechanical"] : ["swe"];
  const previews = new Map<string, Job>();
  if (options.backfill) log("info", "backfill_started", {
    days: options.backfill.days, from: new Date(options.backfill.from).toISOString(),
    through: new Date(options.backfill.through).toISOString()
  });
  // Sequential reads keep load low; a failed source does not block others.
  for (const source of sources) {
    let raw: Job[];
    try {
      raw = await source.fetchJobs();
      if (!Array.isArray(raw) || raw.length > SOURCE_DATA_LIMITS.jobs)
        throw new Error("Source returned too many jobs");
    } catch (error) {
      failed++;
      log("warn", "source_failed", { source: source.name, error: error instanceof Error ? error.message : "Unknown error" });
      continue;
    }

    const jobs: Job[] = [];
    let invalid = 0;
    const mechanicalReasons: Record<string, number> = {};
    for (const job of raw) {
      try {
        const candidate = normalizeJob(job);
        if (categories.includes("mechanical")) {
          const assessment = assessMechanical(candidate);
          if (assessment !== "not_candidate") mechanicalReasons[assessment] = (mechanicalReasons[assessment] ?? 0) + 1;
        }
        const category = classifyJob(candidate);
        if (!category || !categories.includes(category)) continue;
        // Extract the term before dropping description text. Only notification metadata
        // is persisted, including in the public bot-state branch on GitHub Actions.
        const normalized = normalizeJob({ ...candidate, category, startDate: extractStartDate(candidate) });
        delete normalized.description;
        jobs.push(normalized);
      } catch { invalid++; }
    }
    if (categories.includes("mechanical")) log("info", "mechanical_classification", { source: source.name, ...mechanicalReasons, candidates: Object.values(mechanicalReasons).reduce((sum, count) => sum + count, 0) });
    matched += jobs.length;
    if (options.dryRun) {
      for (const job of jobs) previews.set(urlIdentity(job.url), job);
      log("info", "source_preview", { source: source.name, fetched: raw.length, matched: jobs.length, invalid });
    } else {
      // SQLite errors are infrastructure failures, not source failures. Let
      // them reach the caller rather than converting them into a warning.
      for (const category of categories) {
        const group = jobs.filter(job => job.category === category);
        const stats = options.repository!.ingest(category === "swe" ? source.name : "mechanical:" + source.name, group, options.seedFirst, options.backfill);
        log("info", "source_complete", { source: source.name, category, fetched: raw.length, matched: group.length, invalid, ...stats });
      }
    }
  }
  if (options.dryRun) {
    for (const job of previews.values()) log("info", "preview_job", { category: job.category, title: job.title, company: job.company, locations: job.locations, startDate: job.startDate ?? "Not specified", url: job.url });
  } else {
    const queue = categories.flatMap(category => {
      const pending = options.repository!.pending(options.maxNotifications, options.backfill, category);
      log("info", "category_delivery_queue", { category, selected: pending.length, backfill: Boolean(options.backfill) });
      return pending;
    });
    const failedCategories = new Set<JobCategory>();
    selected = queue.length;
    log("info", "delivery_queue", { ...options.repository!.counts(), selected: queue.length, limit: options.maxNotifications, backfill: Boolean(options.backfill), backfillDays: options.backfill?.days });
    if (!queue.length) log("warn", "no_notifications", { reason: "No pending jobs; existing matches may be seeded or already sent. Use bounded backfill for recent seeded jobs, or local test:webhook to check Discord." });
    for (const item of queue) {
      const category = item.job.category ?? "swe";
      if (failedCategories.has(category)) continue;
      let id: string;
      try {
        id = await options.publish!(item.job);
      } catch (error) {
        if (error instanceof PermanentDeliveryError) {
          options.repository!.markRejected(item.id, error.message);
          rejected++;
          log("error", "notification_rejected", { jobId: item.id, error: error.message });
          continue;
        }
        log("error", "delivery_deferred", { category, error: error instanceof Error ? error.message : "Unknown error" });
        failedCategories.add(category);
        continue;
      }
      // Persistence failures must remain fatal even if Discord accepted the card.
      options.repository!.markSent(item.id, id);
      delivered++;
      log("info", "notification_sent", { category, jobId: item.id, messageId: id });
    }
    if (failedCategories.size) return { failed, delivered, rejected, matched, selected, deliveryFailed: true };
  }
  log("info", "poll_complete", { failed, delivered, matched, selected, rejectedThisRun: rejected, sources: sources.length, ...(options.repository && !options.dryRun ? options.repository.counts() : {}) });
  return { failed, delivered, rejected, matched, selected, deliveryFailed: false };
}
