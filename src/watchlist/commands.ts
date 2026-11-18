import { parseArgs } from 'node:util'

import { openDb } from '#/db'
import type { SuggestionRow } from '#/db/schema'
import { createHttpClient } from '#/pipeline/http'
import { githubRunner } from '#/sync/settings'

import { boardKey, detectFromUrl, fetchPageText, toCompany, type Detection } from './detect'
import { mineHiringThread } from './hn'
import { GitHubConfigStore, LocalConfigStore, type ConfigStore } from './runner-config'
import {
  decide,
  decidedKeys,
  getSuggestion,
  listSuggestions,
  saveSuggestions,
  suggestionCompany,
} from './suggestions'

// Loaded lazily from src/pipeline/cli.ts, like the sync commands.

/** The runner repo on GitHub by default; a local folder with --config. */
export async function configStore(dir?: string): Promise<ConfigStore> {
  if (dir) return new LocalConfigStore(dir)
  const { runner, settings } = await githubRunner()
  return new GitHubConfigStore(runner, settings.repo)
}

const deps = () => ({ http: createHttpClient(), fetchText: fetchPageText })

const VIA: Record<Detection['via'], string> = {
  link: 'linked',
  page: 'found on site',
  guess: 'guessed, check it',
}

function describe(d: Pick<Detection, 'board' | 'name' | 'via' | 'check'>): string {
  const where = `${d.board.ats}/${d.board.slug}`
  if (!d.board.supported) return `${d.name} · ${where} · ${d.board.note ?? 'not supported'}`
  const counts = d.check
    ? d.check.ok
      ? `${d.check.matchingJobs} matching of ${d.check.openJobs} open`
      : `check failed: ${d.check.error}`
    : ''
  return `${d.name} · ${where} · ${counts} · ${VIA[d.via]}`
}

export async function detectAtsCommand(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      name: { type: 'string' },
      add: { type: 'boolean', default: false },
      config: { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  })
  const [url] = positionals
  if (!url) {
    console.error('Usage: pnpm cli detect-ats <url> [--name <company>] [--add] [--config <dir>]')
    return 2
  }
  const store = await configStore(values.config)
  const { companies, profiles } = await store.read()
  const watched = new Set(companies.map(boardKey))

  const found = await detectFromUrl(deps(), url, profiles, values.name)
  if (found.length === 0) {
    console.log('No job board found. Try a link to one of the company’s job postings instead.')
    return 1
  }
  const db = openDb()
  saveSuggestions(
    db,
    found
      .filter((d) => !watched.has(boardKey(d.board)))
      .map((d) => Object.assign(d, { source: 'url' as const, sourceUrl: url, sourceText: url })),
  )

  for (const d of found) {
    const onList = watched.has(boardKey(d.board))
    console.log(`${describe(d)}${onList ? ' · already on your watchlist' : ''}`)
    const company = toCompany(d.board, d.name)
    if (company && !onList) console.log(`  ${JSON.stringify(company)}`)
  }

  if (values.add) {
    const addable = found.filter(
      (d) => toCompany(d.board, d.name) && !watched.has(boardKey(d.board)),
    )
    if (addable.length !== 1) {
      console.log(
        addable.length === 0
          ? '\nNothing to add.'
          : '\nMore than one board found; accept one with: pnpm cli suggestions accept <id>',
      )
      return addable.length === 0 ? 0 : 1
    }
    const d = addable[0]
    const company = toCompany(d.board, d.name)!
    const result = await store.addCompany(company)
    decide(db, boardKey(d.board), 'accepted')
    console.log(
      `\n${result === 'added' ? 'Added' : 'Already there:'} ${company.name} → ${store.describe}`,
    )
  }
  return 0
}

export async function hnSuggestCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { thread: { type: 'string' }, config: { type: 'string' } },
    strict: true,
  })
  const store = await configStore(values.config)
  const { companies, profiles } = await store.read()
  const db = openDb()
  const skip = new Set([...companies.map(boardKey), ...decidedKeys(db)])

  const result = await mineHiringThread(deps(), {
    threadId: values.thread,
    profiles,
    skip,
    log: (l) => console.log(l),
  })
  const saved = saveSuggestions(
    db,
    result.suggestions.map((s) =>
      Object.assign(s, { source: 'hn' as const, sourceUrl: s.post.url, sourceText: s.post.header }),
    ),
  )
  console.log(`\n${saved.added} new suggestions, ${saved.refreshed} refreshed.\n`)
  printSuggestions(listSuggestions(db, 'pending'))
  console.log(
    '\nAccept or reject at http://localhost:3000/watchlist, or: pnpm cli suggestions accept <id>',
  )
  return 0
}

function printSuggestions(rows: SuggestionRow[]) {
  if (rows.length === 0) {
    console.log('No pending suggestions.')
    return
  }
  for (const r of rows) {
    const counts = r.supported
      ? r.checkError
        ? `check failed: ${r.checkError}`
        : `${r.matchingJobs ?? 0} matching of ${r.openJobs ?? 0} open`
      : (r.note ?? 'not supported')
    const via = VIA[r.via]
    console.log(`  ${r.id.padEnd(32)} ${r.name} · ${counts}${r.supported ? ` · ${via}` : ''}`)
  }
}

export async function suggestionsCommand(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { all: { type: 'boolean', default: false }, config: { type: 'string' } },
    allowPositionals: true,
    strict: true,
  })
  const [action = 'list', id] = positionals
  const db = openDb()

  if (action === 'list') {
    printSuggestions(listSuggestions(db, values.all ? 'all' : 'pending'))
    return 0
  }
  if ((action !== 'accept' && action !== 'reject') || !id) {
    console.error('Usage: pnpm cli suggestions [list [--all] | accept <id> | reject <id>]')
    return 2
  }
  const row = getSuggestion(db, id)
  if (!row) {
    console.error(`No suggestion "${id}". See: pnpm cli suggestions`)
    return 1
  }
  if (action === 'reject') {
    decide(db, id, 'rejected')
    console.log(`Rejected ${row.name}; it won't be suggested again.`)
    return 0
  }
  const company = suggestionCompany(row)
  if (!company) {
    console.error(`${row.name} can't be added yet: ${row.note ?? 'board not supported'}`)
    return 1
  }
  const store = await configStore(values.config)
  const result = await store.addCompany(company)
  decide(db, id, 'accepted')
  console.log(
    `${result === 'added' ? 'Added' : 'Already there:'} ${company.name} → ${store.describe}`,
  )
  return 0
}
