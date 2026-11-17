import { log } from "../utils/logger.ts";

interface PollResult {
  failed: number;
  delivered: number;
  rejected: number;
  selected: number;
  deliveryFailed: boolean;
}

export function pollOutcome(result: PollResult, sourceCount: number, dryRun = false) {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (sourceCount === 0 || result.failed >= sourceCount) {
    errors.push("All configured job sources failed.");
  } else if (result.failed > 0) {
    warnings.push(`${result.failed} of ${sourceCount} job sources failed or were deferred. Other sources completed; results may be incomplete.`);
  }
  if (result.deliveryFailed) errors.push("Discord notification delivery failed; unsent jobs remain pending.");
  if (!dryRun && result.selected === 0 && sourceCount > result.failed && !result.deliveryFailed)
    warnings.push("No new jobs to post.");
  if (result.rejected > 0)
    warnings.push(`${result.rejected} invalid notification payload(s) were quarantined.`);
  return { exitCode: errors.length ? 1 : 0, warnings, errors };
}

export function reportPollOutcome(result: PollResult, sourceCount: number, dryRun = false): number {
  const outcome = pollOutcome(result, sourceCount, dryRun);
  for (const message of outcome.warnings) {
    log("warn", "poll_warning", { message });
    // Only fixed messages and numeric counts enter workflow commands.
    if (process.env.GITHUB_ACTIONS === "true") console.log("::warning::" + message);
  }
  for (const message of outcome.errors) {
    log("error", "poll_error", { message });
    if (process.env.GITHUB_ACTIONS === "true") console.log("::error::" + message);
  }
  return outcome.exitCode;
}
