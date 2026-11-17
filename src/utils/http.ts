import { setTimeout as sleep } from "node:timers/promises";

export async function getJson(url: string, request = fetch): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await request(url, {
        headers: { Accept: "application/json", "User-Agent": "discord-work-bot/0.1" },
        signal: AbortSignal.timeout(20_000)
      });
    } catch {
      if (attempt === 2) throw new Error("Source network request failed");
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (response.ok) return response.json();
    if (response.status !== 429 && response.status < 500)
      throw new Error("Source HTTP " + response.status);
    if (attempt === 2) throw new Error("Source HTTP " + response.status);
    const header = response.headers.get("retry-after");
    const seconds = header === null ? NaN : Number(header);
    const delay = Number.isFinite(seconds) ? seconds * 1000 :
      header && Number.isFinite(Date.parse(header)) ? Date.parse(header) - Date.now() :
      1000 * 2 ** attempt;
    if (delay > 60_000) throw new Error("Source requested a long retry delay");
    await sleep(Math.max(1000, delay));
  }
  throw new Error("Source retry limit reached");
}

// Keep runtime validation independent of compile-time TypeScript types.
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
export function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str).filter(Boolean) : [];
}
export function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("Unexpected source response: expected array");
  return value.map(record);
}
export function iso(value: unknown, seconds = false): string | undefined {
  const millis = typeof value === "number" ? value * (seconds ? 1000 : 1)
    : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(millis) && Math.abs(millis) <= 8.64e15 ? new Date(millis).toISOString() : undefined;
}
// A lightweight text conversion for classification, not a general HTML parser.
export function plain(value: unknown): string {
  return str(value).replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}
