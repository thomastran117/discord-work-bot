import { setTimeout as sleep } from "node:timers/promises";
import type { Job } from "../models/job.ts";

export function webhookUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(url.hostname) ||
      url.username || url.password || url.port ||
      !/^\/api\/webhooks\/\d+\/[\w.-]+\/?$/.test(url.pathname))
    throw new Error("Invalid Discord webhook URL");
  url.searchParams.set("wait", "true");
  return url;
}

export function buildPayload(job: Job) {
  return {
    username: "Canada Job Bot",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: job.title.slice(0, 256), url: job.url, color: 0x57f287,
      author: { name: job.company.slice(0, 256) },
      fields: [
        { name: "Location", value: job.locations.join("\n").slice(0, 1024) || "Not specified", inline: true },
        { name: "Start date", value: (job.startDate || "Not specified").slice(0, 1024), inline: true }
      ],
      footer: { text: ("Source: " + job.source).slice(0, 2048) }
    }]
  };
}

export function publishJob(webhook: URL, job: Job, request = fetch): Promise<string> {
  return executeWebhook(webhook, buildPayload(job), request);
}

export function testWebhook(webhook: URL, request = fetch): Promise<string> {
  return executeWebhook(webhook, {
    username: "Canada Job Bot",
    allowed_mentions: { parse: [] },
    content: "Discord job bot webhook test: delivery is working. No job records were modified."
  }, request);
}

async function executeWebhook(webhook: URL, payload: object, request: typeof fetch): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await request(webhook, { method: "POST", redirect: "error",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000) });
    } catch {
      // A timeout may mean Discord accepted the message. Do not immediately retry.
      throw new Error("Discord network failure; delivery unknown");
    }
    if (response.status === 429) {
      const body = await response.json().catch(() => ({}));
      const seconds = Number(body.retry_after ?? response.headers.get("retry-after") ?? 1);
      if (attempt === 2 || !Number.isFinite(seconds) || seconds > 60) throw new Error("Discord rate limited; deferred");
      await sleep(Math.max(1000, Math.ceil(seconds * 1000)));
      continue;
    }
    if (!response.ok) {
      // Discord's numeric API error code is useful without logging the response body or token.
      const body = await response.json().catch(() => ({}));
      const code = typeof body?.code === "number" ? " (API code " + body.code + ")" : "";
      throw new Error("Discord HTTP " + response.status + code);
    }
    const message = await response.json();
    if (typeof message.id !== "string") throw new Error("Discord response missing message ID");
    return message.id;
  }
  throw new Error("Discord retry limit reached");
}
