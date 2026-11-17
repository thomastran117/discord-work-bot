import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
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
      CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(state, first_seen_at);
    `);
  }

  ingest(source: string, jobs: Job[], seedFirst: boolean): { added: number; seeded: number; duplicates: number } {
    const result = { added: 0, seeded: 0, duplicates: 0 };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const seed = seedFirst && !this.db.prepare("SELECT name FROM sources WHERE name=?").get(source);
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
          if (!original.startDate && job.startDate)
            this.db.prepare("UPDATE jobs SET payload=? WHERE id=?").run(JSON.stringify({ ...original, startDate: job.startDate }), id);
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

  pending(limit: number): PendingJob[] {
    return this.db.prepare("SELECT id,payload FROM jobs WHERE state='pending' ORDER BY first_seen_at,id LIMIT ?")
      .all(limit).map(row => ({ id: String(row.id), job: JSON.parse(String(row.payload)) as Job }));
  }

  markSent(id: string, messageId: string): void {
    this.db.prepare("UPDATE jobs SET state='sent',discord_message_id=?,notified_at=CURRENT_TIMESTAMP WHERE id=? AND state='pending'").run(messageId, id);
  }

  close(): void { this.db.close(); }
}
