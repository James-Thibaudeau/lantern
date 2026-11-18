#!/usr/bin/env node
import { parseArgs } from 'node:util'

import { loadConfig } from './config'
import { createHttpClient } from './http'
import { runIngest, type IngestResult } from './ingest'
import { writeOutputs } from './output'

const USAGE = `Usage:
  pnpm cli ingest [options]

Options:
  --config <dir>       Folder with companies.json and profiles.json (default: config)
  --out <dir>          Where to write jobs.jsonl, open.json, report.json (default: out)
  --company <slug>     Only fetch this company. Repeatable.
  --companies <a,b>    Same, comma-separated (what the workflow input passes).
  --dry-run            Print the jobs and a summary; write nothing.
  --all                With --dry-run, also print jobs the filter dropped, and why.
  --json               With --dry-run, print full normalized jobs as JSON lines.
  -h, --help           Show this help.

Examples:
  pnpm cli ingest --config ../lantern-runner/config --company wealthsimple --dry-run
  pnpm cli ingest --config ../lantern-runner/config --out out/`

function printSummary(result: IngestResult) {
  const { report } = result
  const rows = report.companies.map((c) => ({
    company: c.slug,
    ats: c.ats,
    status: c.status === 'ok' ? (c.complete ? 'ok' : 'partial') : c.status,
    fetched: c.fetched,
    kept: c.kept,
    'drop:title': c.droppedTitle,
    'drop:location': c.droppedEligibility,
    'bad posts': c.normalizeErrors,
    ms: c.durationMs,
  }))
  console.table(rows)
  for (const c of report.companies) {
    if (c.error) console.error(`  ${c.slug}: ${c.error}`)
    for (const s of c.normalizeErrorSamples)
      console.error(`  ${c.slug} posting ${s.sourceJobId ?? '?'}: ${s.error.split('\n')[0]}`)
  }
  const t = report.totals
  console.log(
    `\n${t.ok}/${t.companies} companies ok (${t.errors} errors, ${t.skipped} skipped) · ` +
      `${t.fetched} fetched · ${t.kept} kept · ${t.droppedTitle} dropped by title · ` +
      `${t.droppedEligibility} dropped by location · ${(report.durationMs / 1000).toFixed(1)}s`,
  )
  const elig = Object.entries(report.eligibility)
    .filter(([, n]) => n > 0)
    .map(([e, n]) => `${e} ${n}`)
    .join(' · ')
  console.log(`Eligibility of all ${t.normalized} jobs: ${elig}`)
}

function printJobs(result: IngestResult, all: boolean, json: boolean) {
  const outcomes = all ? result.outcomes : result.outcomes.filter((o) => o.filter.keep)
  for (const { job, filter } of outcomes) {
    if (json) {
      console.log(JSON.stringify(job))
      continue
    }
    const mark = filter.keep
      ? 'keep'
      : `drop:${filter.reason === 'eligibility' ? 'location' : 'title'}`
    console.log(
      `${mark.padEnd(13)} ${job.eligibility.padEnd(18)} ${job.company} | ${job.title} | ${job.locationText || '(no location)'}`,
    )
  }
  console.log('')
}

async function ingest(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: 'string', default: 'config' },
      out: { type: 'string', default: 'out' },
      company: { type: 'string', multiple: true },
      companies: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  })
  if (values.help) {
    console.log(USAGE)
    return 0
  }

  const only = [
    ...(values.company ?? []),
    ...(values.companies ?? '').split(',').map((s) => s.trim()),
  ].filter(Boolean)

  const config = await loadConfig(values.config)
  const result = await runIngest({
    config,
    http: createHttpClient(),
    only,
    runId: process.env.GITHUB_RUN_ID,
  })

  if (values['dry-run']) {
    printJobs(result, values.all, values.json)
    if (!values.json) printSummary(result)
  } else {
    const files = await writeOutputs(values.out, result)
    printSummary(result)
    console.log(`\nWrote ${files.jobs}, ${files.open}, ${files.report}`)
  }

  if (result.report.failed) {
    console.error('\nRun failed: no company could be fetched.')
    return 1
  }
  return 0
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  switch (command) {
    case 'ingest':
      return ingest(rest)
    case undefined:
    case '-h':
    case '--help':
      console.log(USAGE)
      return command ? 0 : 2
    default:
      console.error(`Unknown command "${command}"\n\n${USAGE}`)
      return 2
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  },
)
