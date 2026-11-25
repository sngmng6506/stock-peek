// Minimal Cloudflare D1 stand-in backed by node:sqlite, for integration tests of real SQL.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = new URL('../../stockpeek-proxy/migrations/', import.meta.url)

class Statement {
  constructor(db, sql, params = []) {
    this.db = db
    this.sql = sql
    this.params = params
  }
  bind(...params) {
    return new Statement(
      this.db,
      this.sql,
      params.map((p) => (p === undefined ? null : p))
    )
  }
  async first() {
    const row = this.db.prepare(this.sql).get(...this.params)
    return row ? { ...row } : null
  }
  async all() {
    return {
      results: this.db
        .prepare(this.sql)
        .all(...this.params)
        .map((r) => ({ ...r }))
    }
  }
  async run() {
    const info = this.db.prepare(this.sql).run(...this.params)
    return { meta: { changes: Number(info.changes) } }
  }
}

export function createD1() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort())
    db.exec(readFileSync(join(MIGRATIONS.pathname, file), 'utf8'))
  return {
    raw: db,
    prepare: (sql) => new Statement(db, sql),
    // D1 batches run in one transaction.
    async batch(statements) {
      db.exec('BEGIN')
      try {
        const out = []
        for (const s of statements) out.push(await s.run())
        db.exec('COMMIT')
        return out
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
  }
}
