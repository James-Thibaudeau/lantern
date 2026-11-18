import { createServerFn } from '@tanstack/react-start'
import { asc } from 'drizzle-orm'
import { z } from 'zod'

import { companies as companyStatus } from '#/db/schema'
import { createHttpClient } from '#/pipeline/http'
import type { Company } from '#/pipeline/schema'
import { githubRunner } from '#/sync/settings'
import { boardKey, boardUrl, detectFromUrl, fetchPageText } from '#/watchlist/detect'
import { mineHiringThread } from '#/watchlist/hn'
import { GitHubConfigStore, type ConfigStore } from '#/watchlist/runner-config'
import {
  decide,
  decidedKeys,
  getSuggestion,
  listSuggestions,
  saveSuggestions,
  suggestionCompany,
} from '#/watchlist/suggestions'

import { getDb } from './db'

async function store(): Promise<ConfigStore> {
  const { runner, settings } = await githubRunner()
  return new GitHubConfigStore(runner, settings.repo)
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))
const deps = () => ({ http: createHttpClient(), fetchText: fetchPageText })

export interface WatchedCompany extends Company {
  url: string | null
  lastStatus: string | null
  lastComplete: boolean | null
  lastFetched: number | null
  lastKept: number | null
  lastError: string | null
}

export interface SuggestionView {
  id: string
  name: string
  ats: string
  slug: string
  url: string | null
  supported: boolean
  note: string | null
  via: 'link' | 'page' | 'guess'
  source: 'hn' | 'url'
  sourceUrl: string | null
  sourceText: string | null
  openJobs: number | null
  matchingJobs: number | null
  checkError: string | null
}

export interface WatchlistData {
  repo: string | null
  watchlist: WatchedCompany[]
  suggestions: SuggestionView[]
  /** Why the watchlist couldn't be read (e.g. the token lacks Contents permission). */
  configError: string | null
}

function toView(r: ReturnType<typeof listSuggestions>[number]): SuggestionView {
  return {
    id: r.id,
    name: r.name,
    ats: r.ats,
    slug: r.slug,
    url: boardUrl({ ats: r.ats, slug: r.slug, workday: suggestionCompany(r)?.workday }),
    supported: r.supported,
    note: r.note,
    via: r.via,
    source: r.source,
    sourceUrl: r.sourceUrl,
    sourceText: r.sourceText,
    openJobs: r.openJobs,
    matchingJobs: r.matchingJobs,
    checkError: r.checkError,
  }
}

export const getWatchlist = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WatchlistData> => {
    const db = getDb()
    const status = new Map(
      db
        .select()
        .from(companyStatus)
        .orderBy(asc(companyStatus.slug))
        .all()
        .map((c) => [c.slug, c]),
    )
    let repo: string | null = null
    let watchlist: WatchedCompany[] = []
    let configError: string | null = null
    try {
      const s = await store()
      repo = s.describe.replace(/ \(GitHub\)$/, '')
      const { companies } = await s.read()
      watchlist = companies.map((c) => {
        const st = status.get(c.slug)
        // The parsed config objects are ours to extend.
        return Object.assign(c, {
          url: boardUrl(c),
          lastStatus: st?.lastStatus ?? null,
          lastComplete: st?.lastComplete ?? null,
          lastFetched: st?.lastFetched ?? null,
          lastKept: st?.lastKept ?? null,
          lastError: st?.lastError ?? null,
        })
      })
    } catch (err) {
      configError = errorMessage(err)
    }
    return { repo, watchlist, suggestions: listSuggestions(db, 'pending').map(toView), configError }
  },
)

/** "Add from URL": find the board, check it, and save it as a suggestion. */
export const detectUrl = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .object({ url: z.url({ protocol: /^https?$/ }), name: z.string().max(80).optional() })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; message: string; ids: string[] }> => {
    try {
      const { companies, profiles } = await (await store()).read()
      const watched = new Set(companies.map(boardKey))
      const found = await detectFromUrl(deps(), data.url, profiles, data.name || undefined)
      if (found.length === 0) {
        return {
          ok: false,
          message: 'No job board found. Try a link to one of the company’s job postings.',
          ids: [],
        }
      }
      const fresh = found.filter((d) => !watched.has(boardKey(d.board)))
      saveSuggestions(
        getDb(),
        fresh.map((d) =>
          Object.assign(d, { source: 'url' as const, sourceUrl: data.url, sourceText: data.url }),
        ),
      )
      const already = found.length - fresh.length
      return {
        ok: true,
        message:
          fresh.length === 0
            ? 'That company is already on your watchlist.'
            : `Found ${fresh.map((d) => `${d.name} (${d.board.ats})`).join(', ')}. Review it below.` +
              (already ? ` ${already} other board(s) already watched.` : ''),
        ids: fresh.map((d) => boardKey(d.board)),
      }
    } catch (err) {
      return { ok: false, message: errorMessage(err), ids: [] }
    }
  })

const IdInput = z.object({ id: z.string().min(3).max(200) })

export const acceptSuggestion = createServerFn({ method: 'POST' })
  .validator((input: unknown) => IdInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean; message: string }> => {
    const db = getDb()
    const row = getSuggestion(db, data.id)
    const company = row ? suggestionCompany(row) : null
    if (!row || !company) return { ok: false, message: 'That board can’t be added yet.' }
    try {
      const s = await store()
      const result = await s.addCompany(company)
      decide(db, data.id, 'accepted')
      return {
        ok: true,
        message:
          result === 'added'
            ? `Added ${company.name} to your watchlist. The next run picks it up.`
            : `${company.name} was already on your watchlist.`,
      }
    } catch (err) {
      return { ok: false, message: errorMessage(err) }
    }
  })

export const rejectSuggestion = createServerFn({ method: 'POST' })
  .validator((input: unknown) => IdInput.parse(input))
  .handler(({ data }): { ok: boolean; message: string } => {
    const db = getDb()
    const row = getSuggestion(db, data.id)
    if (!row) return { ok: false, message: 'Suggestion not found.' }
    decide(db, data.id, 'rejected')
    return { ok: true, message: `Rejected ${row.name}; it won't be suggested again.` }
  })

/** "Check HN": mines the latest "Who is hiring?" thread. Takes a minute or two. */
export const mineHn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ ok: boolean; message: string }> => {
    try {
      const { companies, profiles } = await (await store()).read()
      const db = getDb()
      const skip = new Set([...companies.map(boardKey), ...decidedKeys(db)])
      const result = await mineHiringThread(deps(), { profiles, skip })
      const saved = saveSuggestions(
        db,
        result.suggestions.map((s) =>
          Object.assign(s, {
            source: 'hn' as const,
            sourceUrl: s.post.url,
            sourceText: s.post.header,
          }),
        ),
      )
      return {
        ok: true,
        message: `${result.thread.title}: checked ${result.relevant} of ${result.posts} posts; ${saved.added} new suggestions, ${saved.refreshed} refreshed.`,
      }
    } catch (err) {
      return { ok: false, message: errorMessage(err) }
    }
  },
)
