import { createServerFn } from '@tanstack/react-start'
import { count, eq } from 'drizzle-orm'

import { inboxCount } from '#/db/jobs'
import { suggestions } from '#/db/schema'

import { getDb, lastSyncStatus, startupSync, type SyncStatus } from './db'

/** What the app shell (sidebar) shows on every page. */
export interface ShellData {
  /** The latest sync's result. */
  sync: SyncStatus
  inbox: number
  pendingSuggestions: number
}

export const getShell = createServerFn({ method: 'GET' }).handler(async (): Promise<ShellData> => {
  // The first page load after the app starts waits for a sync, so it shows fresh data.
  const startup = await startupSync()
  const db = getDb()
  const pending =
    db.select({ n: count() }).from(suggestions).where(eq(suggestions.status, 'pending')).get()?.n ??
    0
  return { sync: lastSyncStatus() ?? startup, inbox: inboxCount(db), pendingSuggestions: pending }
})
