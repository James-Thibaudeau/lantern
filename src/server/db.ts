import { openDb, type Db } from '#/db'
import { createScorer, type JobScore, type ScorableJob } from '#/rank/score'
import { githubRunner, loadLocalEnv } from '#/sync/settings'
import { sync, type SyncResult } from '#/sync/sync'
import { GitHubConfigStore, LocalConfigStore, type ConfigStore } from '#/watchlist/runner-config'

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

export interface RankingStatus {
  /** Scores a job, or null when there are no criteria to rank with. */
  score: ((job: ScorableJob) => JobScore) | null
  ok: boolean
  /** One line for the UI. */
  message: string
}

let ranking: RankingStatus = { score: null, ok: true, message: 'Criteria not read yet.' }

export function rankingStatus(): RankingStatus {
  return ranking
}

/**
 * criteria.json comes from the runner repo, or from LANTERN_CONFIG_DIR (a local folder) so
 * you can tune it without pushing.
 */
async function criteriaStore(): Promise<ConfigStore> {
  const dir = process.env.LANTERN_CONFIG_DIR?.trim()
  if (dir) return new LocalConfigStore(dir)
  const { runner, settings } = await githubRunner()
  return new GitHubConfigStore(runner, settings.repo)
}

/** Reads criteria.json again. A failed read keeps the last criteria that worked. */
async function reloadCriteria(): Promise<void> {
  let where = 'the runner repo'
  try {
    const store = await criteriaStore()
    where = store.describe
    const criteria = await store.readCriteria()
    ranking = criteria
      ? {
          score: createScorer(criteria),
          ok: true,
          message: `Ranked with criteria.json from ${where}.`,
        }
      : {
          score: null,
          ok: true,
          message:
            `No criteria.json in ${where}` +
            (store instanceof LocalConfigStore ? '' : " (or the token can't read Contents)") +
            ', so jobs aren\'t ranked. See "Ranking" in the README.',
        }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    ranking = {
      score: ranking.score,
      ok: false,
      message:
        `Couldn't read criteria.json from ${where}: ${reason}` +
        (ranking.score ? ' Still using the last criteria read.' : ''),
    }
  }
}

/** Runs a sync, or joins the one already in progress. Never throws. */
export function runSync(): Promise<SyncStatus> {
  running ??= (async (): Promise<SyncStatus> => {
    const at = new Date().toISOString()
    // Sync is when the app picks up config changes, so criteria are read again here too.
    await reloadCriteria()
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
