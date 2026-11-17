import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { postedTime, backfillWindow, MAX_BACKFILL_DAYS } from "../src/services/backfill.ts";
import type { SearchJob } from "../src/services/ask.ts";

const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error("Usage: node scripts/export-search.ts <snapshot.db> <jobs.json>");
const db = new DatabaseSync(source, {readOnly:true});
try {
  const window = backfillWindow(MAX_BACKFILL_DAYS);
  const jobs: SearchJob[] = [];
  for (const row of db.prepare("SELECT payload,first_seen_at FROM jobs ORDER BY id").iterate()) {
    const job = JSON.parse(String(row.payload));
    const firstSeenAt = new Date(String(row.first_seen_at).replace(" ","T")+"Z").toISOString();
    const posted = postedTime(job.postedAt);
    const postedAt = posted === undefined ? undefined : new Date(posted).toISOString();
    const at = posted ?? Date.parse(firstSeenAt);
    if (at < window.from || at > window.through) continue;
    jobs.push({company:job.company,title:job.title,locations:job.locations,url:job.url,postedAt,firstSeenAt});
  }
  writeFileSync(output, JSON.stringify({version:1,jobs})+"\n");
} finally { db.close(); }
