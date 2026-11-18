export const MIN_BACKFILL_DAYS = 1;
export const MAX_BACKFILL_DAYS = 60;
export const DEFAULT_BACKFILL_DAYS = 7;
const DAY_MS = 86_400_000;

export interface BackfillWindow {
  readonly days: number;
  readonly from: number;
  readonly through: number;
}

export function parseBackfillDays(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || Number(value) > MAX_BACKFILL_DAYS)
    throw new Error("Backfill days must be a whole number from 1 to 60");
  return Number(value);
}

export function backfillWindow(days: number, now = Date.now()): BackfillWindow {
  if (!Number.isInteger(days) || days < MIN_BACKFILL_DAYS || days > MAX_BACKFILL_DAYS)
    throw new Error("Backfill days must be a whole number from 1 to 60");
  return { days, from: now - days * DAY_MS, through: now };
}

export function backfillFromArgs(args: string[]): BackfillWindow | undefined {
  const index = args.indexOf("--backfill");
  if (index < 0) return undefined;
  if (args.lastIndexOf("--backfill") !== index || index + 2 < args.length ||
      args.includes("--dry-run") || args.includes("--test-webhook"))
    throw new Error("Use --backfill with one optional day count, without diagnostic modes");
  const days = args[index + 1] === undefined ? DEFAULT_BACKFILL_DAYS : parseBackfillDays(args[index + 1]);
  return backfillWindow(days);
}

// Adapters normalize dates to ISO UTC. Accept an explicit calendar date at
// midnight UTC too, but never interpret a relative label or first-seen time
// as a publication date. Reject calendar rollover and timezone-less times.
export function postedTime(value: string | undefined): number | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(value)) return undefined;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  const canonical = new Date(at).toISOString();
  const expected = value.length === 10 ? value + "T00:00:00.000Z" :
    value.length === 20 ? value.slice(0, -1) + ".000Z" : value;
  return canonical === expected ? at : undefined;
}

export function withinBackfill(value: string | undefined, window: BackfillWindow): boolean {
  const at = postedTime(value);
  return at !== undefined && at >= window.from && at <= window.through;
}

// When aliases expose different dates, retain the earlier known date to
// avoid claiming that an older requisition is a recent posting.
export function knownPostedAt(current: string | undefined, previous: string | undefined): string | undefined {
  const dates = [postedTime(current), postedTime(previous)].filter((value): value is number => value !== undefined);
  return dates.length ? new Date(Math.min(...dates)).toISOString() : undefined;
}
