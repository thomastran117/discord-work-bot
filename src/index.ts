import { loadConfig } from "./config.ts";
import { JobsRepository, readSourceCooldowns } from "./repositories/jobs.ts";
import { simplifySource } from "./sources/simplify.ts";
import { atsSource } from "./sources/ats.ts";
import { curatedSource } from "./sources/curated.ts";
import { careerSource } from "./sources/careers.ts";
import { runAggregation } from "./services/aggregator.ts";
import { publishJob, webhookUrl, testWebhook } from "./services/discord.ts";
import { log } from "./utils/logger.ts";
import { SourceHttpClient } from "./utils/http.ts";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const backfill = process.argv.includes("--backfill");
  if (process.argv.includes("--test-webhook")) {
    if (!process.env.DISCORD_WEBHOOK_URL) {
      log("error", "webhook_test_failed", { error: "DISCORD_WEBHOOK_URL is required" });
      process.exitCode = 1;
      return;
    }
    let webhook: URL;
    try { webhook = webhookUrl(process.env.DISCORD_WEBHOOK_URL); }
    catch {
      log("error", "webhook_test_failed", { error: "Invalid Discord webhook URL" });
      process.exitCode = 1;
      return;
    }
    try {
      const messageId = await testWebhook(webhook);
      log("info", "webhook_test_confirmed", { messageId });
    } catch (error) {
      log("error", "webhook_test_failed", { error: error instanceof Error ? error.message : "Unknown Discord error" });
      process.exitCode = 1;
    }
    return;
  }
  const once = dryRun || backfill || process.argv.includes("--once");
  const config = loadConfig();
  if (!dryRun && !config.webhook) throw new Error("DISCORD_WEBHOOK_URL is required (or use npm run preview)");
  const webhook = dryRun ? undefined : webhookUrl(config.webhook!);
  const repository = dryRun ? undefined : new JobsRepository(config.databasePath);
  const http = new SourceHttpClient({
    cooldowns: repository,
    initialCooldowns: dryRun ? readSourceCooldowns(config.databasePath) : undefined
  });
  const sources = [...(config.simplifyEnabled ? [simplifySource(config.simplifyUrl, http)] : []),
    ...config.boards.map(board => atsSource(board, http)),
    ...config.feeds.map(id => curatedSource(id, http)),
    ...config.careers.map(id => careerSource(id, http))];
  if (!sources.length || new Set(sources.map(source => source.name)).size !== sources.length) {
    repository?.close();
    throw new Error("Missing or duplicate source configuration");
  }
  const options = { repository, publish: webhook ? (job: Parameters<typeof publishJob>[1]) => publishJob(webhook, job) : undefined,
    dryRun, backfill, maxNotifications: config.maxNotifications, seedFirst: config.seedFirst };
  if (once) {
    try {
      const result = await runAggregation(sources, options);
      if (result.failed || result.deliveryFailed) process.exitCode = 1;
    } finally { repository?.close(); }
    return;
  }
  let active: Promise<unknown> | undefined;
  let stopping = false;
  const tick = () => {
    if (stopping || active) return;
    active = runAggregation(sources, options).catch(() => log("error", "poll_failed")).finally(() => { active = undefined; });
  };
  const timer = setInterval(tick, config.intervalMs);
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await active;
    repository?.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  log("info", "bot_started", { intervalMinutes: config.intervalMs / 60_000, sources: sources.map(s => s.name) });
  tick();
}

main().catch(() => { log("error", "startup_failed", { hint: "Check environment, webhook format, boards file and database path" }); process.exitCode = 1; });
