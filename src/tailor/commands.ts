import { parseArgs } from 'node:util'

import { like } from 'drizzle-orm'

import { DEFAULT_DB_PATH, openDb } from '#/db'
import { jobs, type JobRowDb } from '#/db/schema'
import { insertTailoring } from '#/db/tailored'
import { configStore } from '#/watchlist/commands'

import { listChanges } from './changes'
import { storeTailoring } from './stored'
import { tailorResume } from './tailor'

// Loaded lazily from src/pipeline/cli.ts, like the other commands that use SQLite.

/** "$180K–$250K / year" style, for the prompt. */
export function postingSalary(
  j: Pick<JobRowDb, 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'>,
): string | null {
  const { salaryMin: min, salaryMax: max } = j
  if (min === null && max === null) return null
  const fmt = (n: number) => `${j.salaryCurrency ?? ''} ${n.toLocaleString('en-CA')}`.trim()
  const range =
    min !== null && max !== null && min !== max ? `${fmt(min)}–${fmt(max)}` : fmt((min ?? max)!)
  return j.salaryPeriod ? `${range} per ${j.salaryPeriod}` : range
}

export function postingFrom(j: JobRowDb) {
  return {
    title: j.title,
    company: j.company,
    locationText: j.locationText,
    salary: postingSalary(j),
    descriptionText: j.descriptionText,
  }
}

const indent = (s: string, pad = '      ') => s.replace(/^/gm, pad)

export async function tailorCommand(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { config: { type: 'string' }, db: { type: 'string' } },
    allowPositionals: true,
    strict: true,
  })
  const [prefix] = positionals
  if (!prefix || positionals.length > 1) {
    console.error('Usage: pnpm cli tailor <job id or prefix> [--config <dir>] [--db <file>]')
    return 2
  }

  const store = await configStore(values.config)
  const resume = await store.readResume()
  if (!resume) {
    console.error(
      `No resume.json in ${store.describe}. Copy runner-template/config/resume.example.json there and fill it in.`,
    )
    return 1
  }

  const db = openDb(values.db ?? process.env.LANTERN_DB ?? DEFAULT_DB_PATH)
  const matches = db
    .select()
    .from(jobs)
    .where(like(jobs.id, `${prefix}%`))
    .limit(2)
    .all()
  if (matches.length !== 1) {
    console.error(
      matches.length === 0
        ? `No job with an id starting "${prefix}"`
        : `"${prefix}" matches more than one job; give more of the id`,
    )
    return 1
  }
  const job = matches[0]
  console.log(`Tailoring for ${job.title} · ${job.company} (about a minute)…`)

  const started = Date.now()
  const promptFile = await store.readConfigFile('tailoring-prompt.md')
  const system = promptFile?.text.trim() ? promptFile.text : undefined
  if (system) console.log('Using tailoring-prompt.md from', store.describe)
  const result = await tailorResume(resume, postingFrom(job), undefined, system)
  const saved = insertTailoring(db, {
    jobId: job.id,
    model: result.model,
    resumeHash: result.resumeHash,
    jobHash: job.contentHash,
    promptHash: result.promptHash,
    tailoring: storeTailoring(resume, result.tailoring),
    checks: { ...result.checks, fitNotes: result.tailoring.fitNotes },
    usage: result.usage,
  })

  const bulletText = new Map(resume.experience.flatMap((j) => j.bullets.map((b) => [b.id, b.text])))
  console.log(`\nSaved as version ${saved.version} (id ${saved.id}).\n`)
  for (const c of listChanges(resume, result.tailoring)) {
    if (c.kind === 'summary') {
      console.log(`SUMMARY\n  before:\n${indent(c.before)}\n  after:\n${indent(c.after)}\n`)
    } else if (c.kind === 'skills') {
      console.log(`SKILLS · ${c.group}\n  ${c.after.join(', ')}`)
      const dropped = c.before.filter((s) => !c.after.includes(s))
      if (dropped.length > 0) console.log(`  left out: ${dropped.join(', ')}`)
      console.log('')
    } else if (c.kind === 'bullets') {
      console.log(`BULLETS · ${c.title}, ${c.employer}\n  order: ${c.after.join(', ')}`)
      for (const id of c.dropped) console.log(`  dropped ${id}: ${bulletText.get(id) ?? ''}`)
      console.log('')
    } else {
      console.log(
        `REWORD · ${c.bulletId}\n  before:\n${indent(c.before)}\n  after:\n${indent(c.after)}\n`,
      )
    }
  }
  for (const e of result.checks.errors) console.log(`ERROR: ${e.message}`)
  for (const w of result.checks.warnings) console.log(`WARNING (${w.key ?? '-'}): ${w.message}`)
  const f = result.tailoring.fitNotes
  console.log(`\nMatches:\n${f.matches.map((m) => `  + ${m}`).join('\n')}`)
  console.log(`Gaps:\n${f.gaps.map((g) => `  - ${g}`).join('\n')}`)
  console.log(`Interview topics:\n${f.interviewTopics.map((t) => `  · ${t}`).join('\n')}`)
  const u = result.usage
  console.log(
    `\n${result.model} · ${Math.round((Date.now() - started) / 1000)} s` +
      (u
        ? ` · ${u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens} in / ${u.outputTokens} out tokens`
        : ''),
  )
  return 0
}
