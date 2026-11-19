#!/usr/bin/env node
import { parseArgs } from 'node:util'

import { loadConfig } from './config'
import { createHttpClient } from './http'
import { runIngest, type IngestResult } from './ingest'
import { initRunner } from './init-runner'
import { writeOutputs } from './output'
import { applyState, readState, writeState, type SeenState } from './state'

const USAGE = `Usage:
  pnpm cli ingest [options]
  pnpm cli init-runner <repo-name> [--dir <path>] [--local-only]
  pnpm cli sync [--from <dir>] [--db <file>]      (also: pnpm sync)
  pnpm cli run [--full-resend] [--dry-run] [--companies <a,b>]
  pnpm cli detect-ats <url> [--name <company>] [--add] [--config <dir>]
  pnpm cli hn-suggest [--thread <id>] [--config <dir>]
  pnpm cli suggestions [list [--all] | accept <id> | reject <id>] [--config <dir>]
  pnpm cli rank [--config <dir>] [--limit <n>] [--all] [--explain <id>] [--db <file>]

sync pulls new runner results from GitHub into SQLite (data/lantern.db). It needs
LANTERN_RUNNER_REPO in .env, and LANTERN_GITHUB_TOKEN or a gh CLI login. --from applies
a local \`ingest --out <dir>\` result instead. run starts the runner workflow now.

detect-ats finds a company's job board from a posting or careers-page URL; --add puts it
on your watchlist. hn-suggest finds companies in HN's latest "Who is hiring?" thread.
Both read and update the watchlist in your runner repo on GitHub (the token needs
Contents read/write), or in a local folder with --config.

rank scores the open jobs in SQLite with criteria.json from your runner repo (or a local
folder with --config) and prints them best first. --explain shows one job's points; --all
includes closed jobs.

init-runner creates your private runner repo from runner-template/ (default folder:
../<repo-name>) and pushes it to GitHub with the gh CLI. --local-only skips GitHub.

ingest options:
  --config <dir>       Folder with companies.json and profiles.json (default: config)
  --out <dir>          Where to write jobs.jsonl, open.json, report.json (default: out)
  --company <slug>     Only fetch this company. Repeatable.
  --companies <a,b>    Same, comma-separated (what the workflow input passes).
  --state <file>       Seen-jobs state. jobs.jsonl then only holds new and updated jobs,
                       and the file is updated after a successful run.
  --full-resend        Ignore the saved state and send every kept job (state is still saved).
  --dry-run            Print the jobs and a summary; write nothing.
  --all                With --dry-run, also print jobs the filter dropped, and why.
  --json               With --dry-run, print full normalized jobs as JSON lines.
  -h, --help           Show this help.

Examples:
  pnpm cli ingest --config ../lantern-runner/config --company wealthsimple --dry-run
  pnpm cli ingest --config ../lantern-runner/config --out out/
  pnpm cli init-runner my-lantern-runner`

async function initRunnerCommand(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      dir: { type: 'string' },
      'local-only': { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: true,
  })
  const [name] = positionals
  if (!name || positionals.length > 1) {
    console.error(`init-runner needs exactly one repo name\n\n${USAGE}`)
    return 2
  }
  const { dir } = await initRunner({ name, dir: values.dir, localOnly: values['local-only'] })
  console.log(`
Next:
  1. Edit ${dir}/config/companies.json and profiles.json, then commit and push.
  2. Try a run: gh workflow run run.yml --repo <you>/${name} -f dryRun=true`)
  return 0
}

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
  const ch = report.changes
  if (ch) {
    const basis = ch.stateFound ? 'against saved state' : 'no saved state, so everything is new'
    console.log(
      `Changes (${basis}): ${ch.new} new · ${ch.updated} updated · ${ch.unchanged} unchanged`,
    )
  }
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
      state: { type: 'string' },
      'full-resend': { type: 'boolean', default: false },
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

  let emit = result.kept
  let nextState: SeenState | null = null
  if (values.state) {
    const previous = values['full-resend'] ? { state: null } : await readState(values.state)
    if (previous.warning) console.warn(previous.warning)
    const applied = applyState(
      result,
      previous.state,
      config.companies.map((c) => c.slug),
    )
    emit = applied.emit
    nextState = applied.next
    result.report.changes = applied.changes
  }

  if (values['dry-run']) {
    printJobs(result, values.all, values.json)
    if (!values.json) printSummary(result)
  } else {
    const files = await writeOutputs(values.out, result, emit)
    printSummary(result)
    console.log(`\nWrote ${files.jobs}, ${files.open}, ${files.report}`)
    // A failed run keeps the old state, so nothing is lost before the next good run.
    if (values.state && nextState && !result.report.failed) {
      await writeState(values.state, nextState)
      console.log(`Saved state to ${values.state} (${Object.keys(nextState.jobs).length} jobs)`)
    }
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
    case 'sync':
      return (await import('#/sync/commands')).syncCommand(rest)
    case 'run':
      return (await import('#/sync/commands')).runCommand(rest)
    case 'detect-ats':
      return (await import('#/watchlist/commands')).detectAtsCommand(rest)
    case 'hn-suggest':
      return (await import('#/watchlist/commands')).hnSuggestCommand(rest)
    case 'suggestions':
      return (await import('#/watchlist/commands')).suggestionsCommand(rest)
    case 'rank':
      return (await import('#/rank/commands')).rankCommand(rest)
    case 'init-runner':
      return initRunnerCommand(rest)
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
