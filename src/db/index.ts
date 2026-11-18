import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export const DEFAULT_DB_PATH = 'data/lantern.db'

/**
 * Opens (creating if needed) the SQLite database and applies pending migrations.
 * Paths are relative to the current directory, which is the repo root for both
 * `pnpm cli` and `pnpm dev`. Pass ':memory:' for tests.
 */
export function openDb(path: string = process.env.LANTERN_DB ?? DEFAULT_DB_PATH): Db {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true })
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, {
    migrationsFolder: process.env.LANTERN_MIGRATIONS ?? join(process.cwd(), 'drizzle'),
  })
  return db
}

export { schema }
