import { setTimeout as sleep } from "node:timers/promises";
import type { Job } from "../models/job.ts";

export function webhookUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(url.hostname) ||
      url.username || url.password || url.port ||
      !/^\/api\/webhooks\/\d+\/[\w.-]+\/?$/.test(url.pathname))
    throw new Error("Invalid Discord webhook URL");
  url.searchParams.set("wait", "true");
  // Incoming webhooks must explicitly opt in to non-interactive link buttons.
  url.searchParams.set("with_components", "true");
  return url;
}

const ACCENT = 0x5865f2;
const SOURCE_LABELS: Record<string, string> = {
  simplify: "SimplifyJobs",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  "vansh-canada": "Vansh New-Grad Canada",
  "grind-canada": "Grind",
  "intern-radar": "Intern Radar",
  preview: "Preview only"
};

function sourceLabel(source: string): string {
  const provider = source.split(":")[0].toLowerCase();
  return Object.hasOwn(SOURCE_LABELS, provider) ? SOURCE_LABELS[provider] : source;
}

// Locations are scraped text, not trusted Discord Markdown.
function escapeMarkdown(value: string): string {
  return value.replace(/[\\\x60*_~|<>\[\]()#]/g, "\\$&");
}

export function buildPayload(job: Job) {
  const locations = [...new Set(job.locations.map(location => location.trim()).filter(Boolean))];
  const locationText = locations.map(escapeMarkdown).join("\n");
  const applyUrl = new URL(job.url);
  if (!["https:", "http:"].includes(applyUrl.protocol) || applyUrl.username || applyUrl.password)
    throw new Error("Invalid application URL");

  return {
    username: "Canada Job Bot",
    allowed_mentions: { parse: [] },
    embeds: [{
      author: { name: job.company.slice(0, 256) },
      title: job.title.slice(0, 256),
      url: job.url,
      color: ACCENT,
      fields: [
        {
          name: locations.length > 1 ? "📍 Locations" : "📍 Location",
          value: locationText.slice(0, 1024) || "Not specified",
          inline: false
        }
      ],
      footer: { text: ("via " + sourceLabel(job.source)).slice(0, 2048) }
    }],
    // Discord link buttons are limited to 512-character URLs. Longer links
    // remain accessible from the embed title without a redundant button.
    ...(job.url.length <= 512 ? {
      components: [{
        type: 1,
        components: [{ type: 2, style: 5, label: "View posting", url: job.url }]
      }]
    } : {})
  };
}

export function publishJob(webhook: URL, job: Job, request = fetch): Promise<string> {
  return executeWebhook(webhook, buildPayload(job), request);
}

export function testWebhook(webhook: URL, request = fetch): Promise<string> {
  return executeWebhook(webhook, {
    ...buildPayload({
      source: "preview",
      externalId: "preview-card",
      company: "Example Technologies",
      title: "Sample — Software Engineer, New Grad",
      locations: ["Toronto, ON", "Waterloo, ON"],
      url: "https://example.com/"
    }),
    content: "Discord job bot webhook test — sample card only (not a real vacancy). No job records were modified."
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
