import { parseArgs } from 'node:util'

import { desc, isNull } from 'drizzle-orm'

import { DEFAULT_DB_PATH, openDb } from '#/db'
import { jobs } from '#/db/schema'
import { configStore } from '#/watchlist/commands'

import { compareScores, createScorer, type Reason } from './score'

// Loaded lazily from src/pipeline/cli.ts, like the sync commands.

const points = (n: number) => (n > 0 ? `+${n}` : String(n))
const reasonText = (r: Reason) => `${points(r.points)} ${r.label}`

export async function rankCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: 'string' },
      db: { type: 'string' },
      all: { type: 'boolean', default: false },
      limit: { type: 'string' },
      explain: { type: 'string' },
    },
    strict: true,
  })
  const limit = values.limit === undefined ? Infinity : Number(values.limit)
  if (!(limit > 0)) {
    console.error('--limit needs a positive number')
    return 2
  }

  const store = await configStore(values.config)
  const criteria = await store.readCriteria()
  if (!criteria) {
    console.error(
      `No criteria.json in ${store.describe}. Copy runner-template/config/criteria.example.json ` +
        'there and edit it.',
    )
    return 1
  }
  const score = createScorer(criteria)

  const dbPath = values.db ?? process.env.LANTERN_DB ?? DEFAULT_DB_PATH
  const rows = openDb(dbPath)
    .select()
    .from(jobs)
    .where(values.all ? undefined : isNull(jobs.closedAt))
    .orderBy(desc(jobs.firstSeenAt))
    .all()

  if (values.explain) {
    const prefix = values.explain
    const matches = rows.filter((j) => j.id.startsWith(prefix))
    if (matches.length !== 1) {
      console.error(
        matches.length === 0
          ? `No ${values.all ? '' : 'open '}job with an id starting "${prefix}"`
          : `"${prefix}" matches ${matches.length} jobs; give more of the id`,
      )
      return 1
    }
    const job = matches[0]
    const s = score(job)
    console.log(`${job.title} · ${job.company}`)
    console.log(`${job.locationText || 'No location'} · ${job.url}\n`)
    for (const r of s.reasons) console.log(`  ${points(r.points).padStart(4)}  ${r.label}`)
    if (s.reasons.length === 0) console.log('  (no criteria matched)')
    console.log(`  ────\n  ${String(s.score).padStart(4)}  total`)
    if (s.dealbreaker) console.log(`\nDealbreaker: ${s.dealbreaker}`)
    return 0
  }

  const ranked = rows
    .map((job) => ({ job, s: score(job) }))
    .toSorted((a, b) => compareScores(a.s, b.s))
  for (const { job, s } of ranked.slice(0, limit)) {
    const why = s.dealbreaker
      ? `DEALBREAKER: ${s.dealbreaker}`
      : s.reasons.slice(0, 4).map(reasonText).join(', ')
    console.log(
      `${String(s.score).padStart(4)}  ${job.title} · ${job.company}  [${job.id.slice(0, 8)}]`,
    )
    if (why) console.log(`      ${why}`)
  }
  const shown = Math.min(limit, ranked.length)
  console.log(
    `\n${shown} of ${ranked.length} ${values.all ? '' : 'open '}jobs, ranked with ` +
      `${store.describe}. Details for one: pnpm cli rank --explain <id>`,
  )
  return 0
}
