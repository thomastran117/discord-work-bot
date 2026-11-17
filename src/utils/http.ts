import { setTimeout as sleep } from "node:timers/promises";
import { log } from "./logger.ts";

export const SOURCE_HTTP_POLICY = {
  attempts: 4,
  requestTimeoutMs: 20_000,
  baseDelayMs: 2_000,
  rateLimitBaseMs: 15_000,
  maxInlineWaitMs: 60_000,
  exhaustedCooldownMs: 30 * 60_000,
  minHostGapMs: 1_000,
  workdayHostGapMs: 2_000
} as const;

export const SOURCE_DATA_LIMITS = {
  responseBytes: 16 * 1024 * 1024,
  rawRows: 25_000,
  jobs: 10_000
} as const;

export interface CooldownStore {
  getCooldown(host: string): number;
  setCooldown(host: string, untilMs: number): void;
}

interface HttpOptions {
  request?: typeof fetch;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  cooldowns?: CooldownStore;
  initialCooldowns?: ReadonlyMap<string, number>;
  event?: typeof log;
}

export class SourceHttpError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "SourceHttpError";
    this.status = status;
  }
}

export class SourceCooldownError extends SourceHttpError {
  readonly untilMs: number;
  constructor(untilMs: number, status?: number) {
    super("Source host cooling down until " + new Date(untilMs).toISOString(), status);
    this.name = "SourceCooldownError";
    this.untilMs = untilMs;
  }
}

const MAX_DATE_MS = 8.64e15;

// HTTP Retry-After is either delay-seconds or an HTTP date. Round up and
// saturate huge values rather than accidentally retrying too early.
export function retryAfterMs(value: string | null, now: number): number | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.min(MAX_DATE_MS - now, Math.ceil(Number(raw) * 1000));
  // Do not let Date.parse interpret malformed numeric values as dates.
  if (!/[a-z]{3}/i.test(raw)) return undefined;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

export function retryableStatus(status: number): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function isTransient(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name));
}

/**
 * One client is shared by every source in a deployment. The aggregator
 * invokes sources sequentially; pacing applies across all requests to a
 * configured hostname, including pages, detail requests and retries.
 * Only read-only GETs and search POSTs use this policy, never Discord POSTs.
 */
export class SourceHttpClient {
  private readonly nextRequestAt = new Map<string, number>();
  private readonly blockedUntil: Map<string, number>;
  private readonly options: HttpOptions;

  constructor(options: HttpOptions = {}) {
    this.options = options;
    this.blockedUntil = new Map(options.initialCooldowns);
  }

  private now() { return (this.options.now ?? Date.now)(); }
  private event(event: string, fields: Record<string, unknown>) {
    (this.options.event ?? log)("warn", event, fields);
  }
  private checkDeadline(signal?: AbortSignal) {
    if (signal?.aborted) throw new SourceHttpError("Source request deadline exceeded");
  }

  private async wait(ms: number, signal?: AbortSignal) {
    this.checkDeadline(signal);
    if (ms > 0) {
      const pause = this.options.sleep ?? ((duration, abort) => sleep(duration, undefined, { signal: abort }));
      try { await pause(ms, signal); }
      catch (error) { this.checkDeadline(signal); throw error; }
    }
    this.checkDeadline(signal);
  }

  private cooldown(host: string): number {
    return Math.max(this.blockedUntil.get(host) ?? 0, this.options.cooldowns?.getCooldown(host) ?? 0);
  }

  private remember(host: string, ms: number): number {
    const until = Math.min(MAX_DATE_MS, Math.max(this.cooldown(host), this.now() + Math.ceil(ms)));
    this.blockedUntil.set(host, until);
    this.options.cooldowns?.setCooldown(host, until);
    return until;
  }

  private async retry(host: string, attempt: number, status: number | undefined,
                      header: string | null, signal?: AbortSignal) {
    const p = SOURCE_HTTP_POLICY;
    const serverDelay = retryAfterMs(header, this.now());
    const base = (status === 429 ? p.rateLimitBaseMs : p.baseDelayMs) * 2 ** attempt;
    // Positive jitter avoids synchronized retries without shortening any delay.
    const jittered = Math.ceil(base * (1 + 0.25 * (this.options.random ?? Math.random)()));
    const delay = Math.max(serverDelay ?? 0, jittered);
    const final = attempt + 1 >= p.attempts;
    const tooLong = delay > p.maxInlineWaitMs;
    const hostLimited = status === 429 || serverDelay !== undefined;
    if (hostLimited) {
      const fallback = status === 429 && (final || tooLong) ? p.exhaustedCooldownMs : 0;
      const until = this.remember(host, Math.max(delay, fallback));
      if (final || tooLong) {
        this.event("source_http_deferred", { host, status, attempt: attempt + 1, retryAt: new Date(until).toISOString() });
        throw new SourceCooldownError(until, status);
      }
    }
    this.checkDeadline(signal);
    if (final || tooLong)
      throw new SourceHttpError(status === undefined ? "Source network request failed" : "Source HTTP " + status, status);
    this.event("source_http_retry", { host, status: status ?? "network", attempt: attempt + 1, delayMs: delay });
    await this.wait(delay, signal);
  }

  private async read<T>(url: string, accept: string, consume: (response: Response) => Promise<T>,
                        jsonBody?: object, signal?: AbortSignal): Promise<T> {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.username || target.password)
      throw new SourceHttpError("Invalid source URL");
    const host = target.hostname.toLowerCase();
    const p = SOURCE_HTTP_POLICY;
    const request = this.options.request ?? fetch;
    for (let attempt = 0; attempt < p.attempts; attempt++) {
      this.checkDeadline(signal);
      const until = this.cooldown(host);
      if (until > this.now()) {
        this.event("source_http_cooldown", { host, retryAt: new Date(until).toISOString() });
        throw new SourceCooldownError(until);
      }
      await this.wait((this.nextRequestAt.get(host) ?? 0) - this.now(), signal);
      const timeout = AbortSignal.timeout(p.requestTimeoutMs);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const gap = /\.myworkdayjobs\.com$/i.test(host) ? p.workdayHostGapMs : p.minHostGapMs;
      this.nextRequestAt.set(host, this.now() + gap);
      let response: Response;
      try {
        response = await request(url, {
          headers: { Accept: accept, "User-Agent": "discord-work-bot/0.1",
            ...(jsonBody ? { "Content-Type": "application/json" } : {}) },
          ...(jsonBody ? { method: "POST", body: JSON.stringify(jsonBody) } : {}),
          redirect: "manual",
          signal: requestSignal
        });
      } catch (error) {
        this.checkDeadline(signal);
        if (!isTransient(error)) throw new SourceHttpError("Source request failed");
        await this.retry(host, attempt, undefined, null, signal);
        continue;
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => {});
        throw new SourceHttpError("Source redirects are not allowed", response.status);
      }
      if (response.ok) {
        try { return await consume(response); }
        catch (error) {
          this.checkDeadline(signal);
          if (error instanceof SourceHttpError) throw error;
          // Invalid JSON/schema is not a transient network error.
          if (!isTransient(error)) throw new SourceHttpError("Invalid source response body");
          await this.retry(host, attempt, undefined, null, signal);
          continue;
        }
      }
      const status = response.status;
      const header = response.headers.get("retry-after");
      await response.body?.cancel().catch(() => {});
      if (!retryableStatus(status)) throw new SourceHttpError("Source HTTP " + status, status);
      // Record a returned Retry-After even if the parent deadline expired.
      await this.retry(host, attempt, status, header, signal);
    }
    throw new SourceHttpError("Source retry limit reached");
  }

  getJson(url: string, signal?: AbortSignal): Promise<unknown> {
    return this.read(url, "application/json", async response => JSON.parse(await limitedText(response)), undefined, signal);
  }
  getText(url: string, signal?: AbortSignal): Promise<string> {
    return this.read(url, "text/plain, text/markdown;q=0.9", limitedText, undefined, signal);
  }
  // Workday's POST is a read-only search, never an application submission.
  postSearchJson(url: string, body: object, signal?: AbortSignal): Promise<unknown> {
    return this.read(url, "application/json", async response => JSON.parse(await limitedText(response)), body, signal);
  }
}

async function limitedText(response: Response): Promise<string> {
  const maximum = SOURCE_DATA_LIMITS.responseBytes;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    await response.body?.cancel().catch(() => {});
    throw new SourceHttpError("Source response is too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximum) {
      await reader.cancel().catch(() => {});
      throw new SourceHttpError("Source response is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// Compatibility helpers for one-off requests. Runtime adapters receive the
// same SourceHttpClient instance to share host pacing and cooldown state.
export function getJson(url: string, request = fetch): Promise<unknown> {
  return new SourceHttpClient({ request }).getJson(url);
}
export function getText(url: string, request = fetch): Promise<string> {
  return new SourceHttpClient({ request }).getText(url);
}
export function postSearchJson(url: string, body: object, request = fetch): Promise<unknown> {
  return new SourceHttpClient({ request }).postSearchJson(url, body);
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
  if (value.length > SOURCE_DATA_LIMITS.rawRows) throw new Error("Unexpected source response: too many rows");
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
