import { openDb, type Db } from '#/db'
import { githubRunner, loadLocalEnv } from '#/sync/settings'
import { sync, type SyncResult } from '#/sync/sync'

// Server-only helpers shared by the server functions. One DB connection per server process.

let db: Db | undefined

export function getDb(): Db {
  loadLocalEnv()
  db ??= openDb()
  return db
}

export interface SyncStatus {
  ok: boolean
  /** One line for the UI. */
  message: string
  result?: SyncResult
  at: string
}

let running: Promise<SyncStatus> | undefined
let startup: Promise<SyncStatus> | undefined

function summarize(result: SyncResult): string {
  const synced = result.runs.filter((r) => r.outcome === 'synced')
  if (synced.length === 0) return 'Up to date: no new runs.'
  const sum = (k: 'inserted' | 'updated' | 'closed' | 'reopened') =>
    synced.reduce((n, r) => n + (r[k] ?? 0), 0)
  const runs = `${synced.length} run${synced.length === 1 ? '' : 's'}`
  return `Synced ${runs}: ${sum('inserted')} new, ${sum('updated')} updated, ${sum('closed')} closed, ${sum('reopened')} reopened.`
}

/** Runs a sync, or joins the one already in progress. Never throws. */
export function runSync(): Promise<SyncStatus> {
  running ??= (async (): Promise<SyncStatus> => {
    const at = new Date().toISOString()
    try {
      const { runner } = await githubRunner()
      const result = await sync(getDb(), runner)
      const gap = result.gap ? ' Some results were missed: use Full resend on the Runs page.' : ''
      return { ok: true, message: summarize(result) + gap, result, at }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), at }
    } finally {
      running = undefined
    }
  })()
  return running
}

/** The sync that runs once, the first time the app is used after starting. */
export function startupSync(): Promise<SyncStatus> {
  startup ??= runSync()
  return startup
}
