import { parseArgs } from 'node:util'

import { DEFAULT_DB_PATH, openDb } from '#/db'

import { githubRunner } from './settings'
import { sync, syncFromDir, type SyncedRun } from './sync'

// Kept out of src/pipeline/cli.ts's static imports so `ingest` (which runs in the Action)
// never loads the native SQLite module.

function describe(r: SyncedRun): string {
  const when = r.createdAt.slice(0, 16).replace('T', ' ')
  if (r.outcome === 'no_artifact') return `${r.runId} (${when}): no results (dry run)`
  if (r.outcome === 'expired') return `${r.runId} (${when}): results EXPIRED before sync`
  if (r.outcome === 'superseded') {
    return `${r.runId} (${when}): skipped, older than a run already synced`
  }
  if (r.received === undefined) return `${r.runId} (${when}): already synced`
  return (
    `${r.runId} (${when}): ${r.inserted} new · ${r.updated} updated · ${r.closed} closed · ` +
    `${r.reopened} reopened${r.missing ? ` · ${r.missing} MISSING` : ''}`
  )
}

export async function syncCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      db: { type: 'string' },
      from: { type: 'string' },
    },
    strict: true,
  })
  const dbPath = values.db ?? process.env.LANTERN_DB ?? DEFAULT_DB_PATH
  const db = openDb(dbPath)

  if (values.from) {
    const r = await syncFromDir(db, values.from)
    console.log(describe(r))
    console.log(`Database: ${dbPath}`)
    return 0
  }

  const { runner, settings } = await githubRunner()
  console.log(`Syncing from ${settings.repo} (token from ${settings.tokenSource})`)
  const result = await sync(db, runner)
  if (result.runs.length === 0) console.log('Nothing new to sync.')
  for (const r of result.runs) console.log(`  ${describe(r)}`)
  if (result.gap) {
    console.log(
      "\nSome results were missed (expired, or jobs listed that aren't here). Fix it with a " +
        'full resend, then sync again once it finishes:\n  pnpm cli run --full-resend',
    )
  }
  console.log(`Database: ${dbPath}`)
  return 0
}

export async function runCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'full-resend': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      companies: { type: 'string' },
    },
    strict: true,
  })
  const { runner, settings } = await githubRunner()
  await runner.dispatch({
    fullResend: values['full-resend'],
    dryRun: values['dry-run'],
    companies: values.companies,
  })
  console.log(`Started a run of ${settings.repo}. It takes about a minute; then run: pnpm sync`)
  console.log(runner.actionsUrl)
  return 0
}
