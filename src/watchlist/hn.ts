import { decodeHTML } from 'entities'
import { z } from 'zod'

import { mentionsCanada } from '#/pipeline/eligibility'
import { mapLimit } from '#/pipeline/http'
import type { Profile } from '#/pipeline/schema'

import {
  boardKey,
  completeDetections,
  detectFromSite,
  extractUrls,
  findBoards,
  parseBoardUrl,
  type Board,
  type DetectDeps,
  type Detection,
  type DetectedVia,
} from './detect'

// HN "Ask HN: Who is hiring?" threads, via the free HN Algolia API (no key).

const ALGOLIA = 'https://hn.algolia.com/api/v1'

const SearchResponse = z.object({
  hits: z.array(z.object({ objectID: z.string(), title: z.string(), created_at: z.string() })),
})
const Item = z.object({
  id: z.number(),
  title: z.string().nullish(),
  created_at: z.string(),
  children: z.array(
    z.object({
      id: z.number(),
      author: z.string().nullish(),
      text: z.string().nullish(),
      created_at: z.string(),
    }),
  ),
})

export interface HnThread {
  id: string
  title: string
  createdAt: string
}

export interface HnPost {
  id: string
  url: string
  /** The first line ("Company | Role | Location | …") as plain text. */
  header: string
  html: string
}

export async function latestHiringThread(deps: DetectDeps): Promise<HnThread> {
  const res = SearchResponse.parse(
    await deps.http.getJson(
      `${ALGOLIA}/search_by_date?tags=story,author_whoishiring&hitsPerPage=10`,
    ),
  )
  const hit = res.hits.find((h) => /who is hiring/i.test(h.title))
  if (!hit) throw new Error('No recent "Who is hiring?" thread found on HN')
  return { id: hit.objectID, title: hit.title, createdAt: hit.created_at }
}

const stripTags = (html: string) =>
  decodeHTML(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

/** The post's first paragraph, which by convention holds company, role and location. */
export function postHeader(html: string): string {
  return stripTags(html.split(/<p>/i)[0] ?? '').slice(0, 300)
}

/** "Acme (YC W21) | Senior Engineer | Remote" → "Acme". */
export function companyFromHeader(header: string): string | undefined {
  const name = header
    .split('|')[0]
    ?.replace(/\(.*?\)/g, '')
    .replace(/\s+-\s+.*$/, '')
    .trim()
  return name && name.length <= 60 ? name : undefined
}

/**
 * Worth checking: mentions Canada, or is remote. The board check later decides for real,
 * by counting jobs that pass your location rules.
 */
export function isRelevant(post: Pick<HnPost, 'header' | 'html'>): boolean {
  if (mentionsCanada(post.header) || /\bremote\b/i.test(post.header)) return true
  return mentionsCanada(stripTags(post.html))
}

const NOT_A_COMPANY_SITE =
  /(^|\.)(ycombinator\.com|github\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|medium\.com|google\.com|notion\.site|notion\.so|wellfound\.com|angel\.co|calendly\.com|forms\.gle|typeform\.com|substack\.com|bit\.ly|discord\.gg|t\.co)$/i

/** The first link in the post that looks like the company's own site. */
export function companySite(html: string): string | undefined {
  for (const url of extractUrls(html)) {
    if (parseBoardUrl(url)) continue
    try {
      const host = new URL(url).hostname.replace(/^www\./, '')
      if (!NOT_A_COMPANY_SITE.test(host)) return url
    } catch {
      // skip
    }
  }
  return undefined
}

export async function fetchThread(
  deps: DetectDeps,
  id: string,
): Promise<{ thread: HnThread; posts: HnPost[] }> {
  const item = Item.parse(await deps.http.getJson(`${ALGOLIA}/items/${encodeURIComponent(id)}`))
  const posts = item.children
    .filter((c) => c.text)
    .map((c) => ({
      id: String(c.id),
      url: `https://news.ycombinator.com/item?id=${c.id}`,
      header: postHeader(c.text ?? ''),
      html: c.text ?? '',
    }))
  return {
    thread: {
      id: String(item.id),
      title: item.title ?? `HN thread ${id}`,
      createdAt: item.created_at,
    },
    posts,
  }
}

export interface HnSuggestion extends Detection {
  post: HnPost
}

export interface MineResult {
  thread: HnThread
  posts: number
  relevant: number
  suggestions: HnSuggestion[]
}

/**
 * Finds job boards of companies hiring in Canada or remotely in a "Who is hiring?" thread,
 * skipping boards in `skip` (already watched, or decided before), and checks each one.
 */
export async function mineHiringThread(
  deps: DetectDeps,
  opts: { threadId?: string; profiles: Profile[]; skip: Set<string>; log?: (line: string) => void },
): Promise<MineResult> {
  const log = opts.log ?? (() => {})
  const threadId = opts.threadId ?? (await latestHiringThread(deps)).id
  const { thread, posts } = await fetchThread(deps, threadId)
  const relevant = posts.filter(isRelevant)
  log(`${thread.title}: ${posts.length} posts, ${relevant.length} mention Canada or remote`)

  // Boards linked in the post; otherwise look at the company's own site.
  const perPost = await mapLimit(relevant, 4, async (post) => {
    const name = companyFromHeader(post.header)
    const linked = findBoards(post.html)
    if (linked.length > 0) {
      return linked.map((board) => ({ board, via: 'link' as DetectedVia, name, post }))
    }
    const site = companySite(post.html)
    if (!site) return []
    const fromSite = await detectFromSite(deps, site, name)
    return (fromSite?.boards ?? []).map((board: Board) => ({
      board,
      via: fromSite!.via,
      name,
      post,
    }))
  })

  const unique = new Map<string, (typeof perPost)[number][number]>()
  for (const found of perPost.flat()) {
    const key = boardKey(found.board)
    if (!opts.skip.has(key) && !unique.has(key)) unique.set(key, found)
  }
  log(`${unique.size} new boards found; checking them`)

  const found = [...unique.values()]
  const checked = await completeDetections(deps.http, found, opts.profiles)
  const suggestions = checked
    .map((d, i) => Object.assign(d, { post: found[i].post }))
    // A guessed slug with no open jobs is no evidence the board is this company's.
    .filter((s) => !(s.via === 'guess' && s.check?.ok && s.check.openJobs === 0))
  return { thread, posts: posts.length, relevant: relevant.length, suggestions }
}
