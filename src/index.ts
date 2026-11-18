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
import { backfillFromArgs } from "./services/backfill.ts";
import type { BackfillWindow } from "./services/backfill.ts";
import { reportPollOutcome } from "./services/poll-outcome.ts";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  let backfill: BackfillWindow | undefined;
  try { backfill = backfillFromArgs(process.argv.slice(2)); }
  catch (error) {
    log("error", "invalid_backfill", { error: error instanceof Error ? error.message : "Invalid backfill" });
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes("--test-webhook")) {
    const mechanical = process.argv.includes("--mechanical");
    const secret = mechanical ? process.env.DISCORD_MECHANICAL_WEBHOOK_URL : process.env.DISCORD_WEBHOOK_URL;
    if (!secret) {
      log("error", "webhook_test_failed", { error: mechanical ? "DISCORD_MECHANICAL_WEBHOOK_URL is required" : "DISCORD_WEBHOOK_URL is required" });
      process.exitCode = 1;
      return;
    }
    let webhook: URL;
    try { webhook = webhookUrl(secret); }
    catch {
      log("error", "webhook_test_failed", { error: "Invalid Discord webhook URL" });
      process.exitCode = 1;
      return;
    }
    try {
      const messageId = await testWebhook(webhook, fetch, mechanical ? "mechanical" : "swe");
      log("info", "webhook_test_confirmed", { messageId });
    } catch (error) {
      log("error", "webhook_test_failed", { error: error instanceof Error ? error.message : "Unknown Discord error" });
      process.exitCode = 1;
    }
    return;
  }
  const once = dryRun || Boolean(backfill) || process.argv.includes("--once");
  const config = loadConfig();
  if (!dryRun && !config.webhook) throw new Error("DISCORD_WEBHOOK_URL is required (or use npm run preview)");
  const webhook = dryRun ? undefined : webhookUrl(config.webhook!);
  const mechanicalWebhook = !dryRun && config.mechanicalWebhook ? webhookUrl(config.mechanicalWebhook) : undefined;
  if (webhook && mechanicalWebhook && webhook.pathname.split("/")[3] === mechanicalWebhook.pathname.split("/")[3] &&
      webhook.searchParams.get("thread_id") === mechanicalWebhook.searchParams.get("thread_id"))
    throw new Error("Configure separate notification destinations");
  const mechanicalEnabled = dryRun || Boolean(mechanicalWebhook);
  const repository = dryRun ? undefined : new JobsRepository(config.databasePath);
  const http = new SourceHttpClient({
    cooldowns: repository,
    initialCooldowns: dryRun ? readSourceCooldowns(config.databasePath) : undefined
  });
  const sources = [...(config.simplifyEnabled ? [simplifySource(config.simplifyUrl, http)] : []),
    ...config.boards.filter(board => mechanicalEnabled || !board.mechanicalFocus).map(board => atsSource(board, http)),
    ...config.feeds.map(id => curatedSource(id, http)),
    ...config.careers.filter(id => mechanicalEnabled || (id !== "aecom" && id !== "cima")).map(id => careerSource(id, http, mechanicalEnabled))];
  if (!sources.length || new Set(sources.map(source => source.name)).size !== sources.length) {
    repository?.close();
    throw new Error("Missing or duplicate source configuration");
  }
  const options = { repository, mechanicalEnabled, publish: webhook ? (job: Parameters<typeof publishJob>[1]) => {
      const destination = job.category === "mechanical" ? mechanicalWebhook : webhook;
      if (!destination) throw new Error("Mechanical webhook is not configured");
      return publishJob(destination, job);
    } : undefined,
    dryRun, backfill, maxNotifications: config.maxNotifications, seedFirst: config.seedFirst, mechanicalSeedFirst: config.mechanicalSeedFirst };
  if (once) {
    try {
      const result = await runAggregation(sources, options);
      process.exitCode = reportPollOutcome(result, sources.length, dryRun);
    } finally { repository?.close(); }
    return;
  }
  let active: Promise<unknown> | undefined;
  let stopping = false;
  const tick = () => {
    if (stopping || active) return;
    active = runAggregation(sources, options)
      .then(result => { reportPollOutcome(result, sources.length); })
      .catch(() => log("error", "poll_failed"))
      .finally(() => { active = undefined; });
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
