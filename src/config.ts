import { readFileSync } from "node:fs";
import type { BoardConfig } from "./models/job.ts";
import { record, str } from "./utils/http.ts";
import { FEEDS } from "./sources/curated.ts";
import type { FeedId } from "./sources/curated.ts";
import { CAREERS } from "./sources/careers.ts";
import type { CareerId } from "./sources/careers.ts";

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new Error("Invalid numeric configuration");
  return number;
}
export function loadConfig(env = process.env) {
  const mode = env.FIRST_RUN_MODE ?? "seed";
  if (mode !== "seed" && mode !== "publish") throw new Error("FIRST_RUN_MODE must be seed or publish");
  const mechanicalMode = env.MECHANICAL_FIRST_RUN_MODE || mode;
  if (mechanicalMode !== "seed" && mechanicalMode !== "publish") throw new Error("MECHANICAL_FIRST_RUN_MODE must be seed or publish");
  const raw: unknown = JSON.parse(readFileSync(env.BOARDS_PATH || "./config/boards.json", "utf8"));
  if (!Array.isArray(raw)) throw new Error("Boards config must be an array");
  const boards: BoardConfig[] = raw.map(value => {
    const row = record(value);
    const provider = str(row.provider) as BoardConfig["provider"];
    const company = str(row.company), board = str(row.board);
    const region = (str(row.region) || "global") as BoardConfig["region"];
    if (!["greenhouse", "lever", "ashby"].includes(provider) || !company || !/^[a-zA-Z0-9_-]+$/.test(board) ||
        !["global", "eu"].includes(region!) || (region === "eu" && provider !== "lever")) throw new Error("Invalid employer board configuration");
    if (row.mechanicalFocus !== undefined && typeof row.mechanicalFocus !== "boolean") throw new Error("Invalid mechanicalFocus flag");
    return { provider, company, board, region, ...(row.mechanicalFocus === true ? { mechanicalFocus: true } : {}) };
  });
  const feedRaw: unknown = JSON.parse(readFileSync(env.FEEDS_PATH || "./config/feeds.json", "utf8"));
  if (!Array.isArray(feedRaw)) throw new Error("Feeds config must be an array");
  const seen = new Set<string>();
  const feeds: FeedId[] = [];
  for (const entry of feedRaw) {
    const row = record(entry);
    const id = str(row.id);
    if (!Object.hasOwn(FEEDS, id) || typeof row.enabled !== "boolean" || seen.has(id))
      throw new Error("Invalid or duplicate curated feed configuration");
    seen.add(id);
    if (row.enabled) feeds.push(id as FeedId);
  }
  const careerRaw: unknown = JSON.parse(readFileSync(env.CAREERS_PATH || "./config/careers.json", "utf8"));
  if (!Array.isArray(careerRaw)) throw new Error("Careers config must be an array");
  const careerSeen = new Set<string>();
  const careers: CareerId[] = [];
  for (const entry of careerRaw) {
    const row = record(entry);
    const id = str(row.id);
    if (!Object.hasOwn(CAREERS, id) || typeof row.enabled !== "boolean" || careerSeen.has(id))
      throw new Error("Invalid or duplicate career configuration");
    careerSeen.add(id);
    if (row.enabled) careers.push(id as CareerId);
  }
  const enabled = env.SIMPLIFY_ENABLED ?? "true";
  if (!["true", "false"].includes(enabled)) throw new Error("SIMPLIFY_ENABLED must be true or false");
  return { boards, feeds, careers, simplifyEnabled: enabled === "true", simplifyUrl: env.SIMPLIFY_URL || undefined,
    databasePath: env.DATABASE_PATH || "./data/jobs.db", webhook: env.DISCORD_WEBHOOK_URL, mechanicalWebhook: env.DISCORD_MECHANICAL_WEBHOOK_URL || undefined,
    intervalMs: positiveInt(env.POLL_INTERVAL_MINUTES, 120, 1440) * 60_000,
    maxNotifications: positiveInt(env.MAX_NOTIFICATIONS_PER_RUN, 25, 500), seedFirst: mode === "seed", mechanicalSeedFirst: mechanicalMode === "seed" };
}
