import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Job } from "../models/job.ts";
import { urlIdentity } from "../services/identity.ts";

export interface PendingJob { id: string; job: Job }

export class JobsRepository {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL,
        first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        state TEXT NOT NULL CHECK(state IN ('pending','seeded','sent')),
        discord_message_id TEXT, notified_at TEXT
      );
      CREATE TABLE IF NOT EXISTS identities (
        identity TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id)
      );
      CREATE TABLE IF NOT EXISTS sources (name TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS source_cooldowns (
        host TEXT PRIMARY KEY, until_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS delivery_rejections (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id),
        reason TEXT NOT NULL,
        rejected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(state, first_seen_at);
    `);
  }

  ingest(source: string, jobs: Job[], seedFirst: boolean, backfill = false): { added: number; seeded: number; duplicates: number; requeued: number } {
    const result = { added: 0, seeded: 0, duplicates: 0, requeued: 0 };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const seed = !backfill && seedFirst && !this.db.prepare("SELECT name FROM sources WHERE name=?").get(source);
      for (const job of jobs) {
        const keys = ["source:" + job.source + ":" + job.externalId, "url:" + urlIdentity(job.url)];
        if (job.requisitionKey) keys.push("req:" + job.requisitionKey);
        const ids = new Set(keys.map(key => this.db.prepare("SELECT job_id FROM identities WHERE identity=?").get(key)?.job_id).filter(Boolean));
        if (ids.size > 1) { result.duplicates++; continue; } // avoid silently merging ambiguous identities
        const existing = [...ids][0] as string | undefined;
        const id = existing ?? randomUUID();
        if (existing) {
          result.duplicates++;
          const row = this.db.prepare("SELECT payload FROM jobs WHERE id=?").get(id)!;
          const original = JSON.parse(String(row.payload)) as Job;
          if (backfill) {
            // Only currently matched, never-notified seeded jobs are eligible.
            // Use fresh metadata for those jobs; leave sent/pending state intact.
            const changes = this.db.prepare("UPDATE jobs SET state='pending', payload=? WHERE id=? AND state='seeded'")
              .run(JSON.stringify({ ...job, startDate: job.startDate ?? original.startDate }), id).changes;
            result.requeued += Number(changes);
          }
          if (!original.startDate && job.startDate && !backfill)
            this.db.prepare("UPDATE jobs SET payload=? WHERE id=?").run(JSON.stringify({ ...original, startDate: job.startDate }), id);
          else if (backfill && !original.startDate && job.startDate)
            this.db.prepare("UPDATE jobs SET payload=? WHERE id=? AND state='pending'")
              .run(JSON.stringify({ ...job, startDate: job.startDate }), id);
        } else {
          this.db.prepare("INSERT INTO jobs(id,payload,state) VALUES(?,?,?)").run(id, JSON.stringify(job), seed ? "seeded" : "pending");
          result.added++;
          if (seed) result.seeded++;
        }
        for (const key of keys) this.db.prepare("INSERT OR IGNORE INTO identities VALUES(?,?)").run(key, id);
      }
      this.db.prepare("INSERT OR IGNORE INTO sources VALUES(?)").run(source);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getCooldown(host: string): number {
    return Number(this.db.prepare("SELECT until_ms FROM source_cooldowns WHERE host=?").get(host)?.until_ms ?? 0);
  }

  setCooldown(host: string, untilMs: number): void {
    this.db.prepare("INSERT INTO source_cooldowns(host,until_ms) VALUES(?,?) ON CONFLICT(host) DO UPDATE SET until_ms=MAX(until_ms,excluded.until_ms)")
      .run(host, untilMs);
  }

  counts(): { pending: number; seeded: number; sent: number; rejected: number } {
    const counts = { pending: 0, seeded: 0, sent: 0, rejected: 0 };
    for (const row of this.db.prepare(`
      SELECT state, COUNT(*) AS count FROM jobs
      WHERE NOT EXISTS (SELECT 1 FROM delivery_rejections WHERE job_id=jobs.id)
      GROUP BY state
    `).all()) {
      counts[String(row.state) as keyof typeof counts] = Number(row.count);
    }
    counts.rejected = Number(this.db.prepare("SELECT COUNT(*) AS count FROM delivery_rejections").get()!.count);
    return counts;
  }

  pending(limit: number): PendingJob[] {
    return this.db.prepare(`
      SELECT id,payload FROM jobs WHERE state='pending'
      AND NOT EXISTS (SELECT 1 FROM delivery_rejections WHERE job_id=jobs.id)
      ORDER BY first_seen_at,id LIMIT ?
    `)
      .all(limit).map(row => ({ id: String(row.id), job: JSON.parse(String(row.payload)) as Job }));
  }

  markSent(id: string, messageId: string): void {
    this.db.prepare("UPDATE jobs SET state='sent',discord_message_id=?,notified_at=CURRENT_TIMESTAMP WHERE id=? AND state='pending'").run(messageId, id);
  }

  markRejected(id: string, reason: string): void {
    this.db.prepare("INSERT OR REPLACE INTO delivery_rejections(job_id,reason) VALUES(?,?)")
      .run(id, reason.slice(0, 512));
  }

  close(): void { this.db.close(); }
}

// Preview honours the last saved cooldowns without creating or changing state.
// Older snapshots can predate the additive cooldown-table migration.
export function readSourceCooldowns(path: string): Map<string, number> {
  if (path === ":memory:" || !existsSync(path)) return new Map();
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_cooldowns'").get()) return new Map();
    return new Map(db.prepare("SELECT host,until_ms FROM source_cooldowns").all().map(row => [String(row.host), Number(row.until_ms)]));
  } finally { db.close(); }
}
