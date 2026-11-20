import { decodeHTML } from 'entities'

import { widgetUrl } from '#/pipeline/adapters/workable'
import { HttpError, USER_AGENT, mapLimit, type HttpClient } from '#/pipeline/http'
import { runIngest } from '#/pipeline/ingest'
import type { Ats, Company, Profile } from '#/pipeline/schema'

/** A job board found in a URL or page. */
export interface Board {
  /** One of our ATS ids, or another ATS we recognize but can't read (SmartRecruiters). */
  ats: Ats | 'smartrecruiters'
  slug: string
  workday?: { tenant: string; host: string; site: string }
  /** "eu" for an EU-hosted Lever board. */
  region?: 'eu'
  /** We have an adapter for it, so it can go on the watchlist. */
  supported: boolean
  note?: string
}

export type DetectedVia = 'link' | 'page' | 'guess'

export interface Detection {
  board: Board
  via: DetectedVia
  /** Display name: from the board's API, the HN post, or the slug. */
  name: string
  /** Set when the board was checked (supported boards only). */
  check?: BoardCheck
}

export interface BoardCheck {
  ok: boolean
  openJobs: number
  /** Jobs that pass your profiles today. */
  matchingJobs: number
  error?: string
}

export const boardKey = (b: Pick<Board, 'ats' | 'slug'>) => `${b.ats}:${b.slug.toLowerCase()}`

// ---------- URLs ----------

const SKIP_SLUGS = new Set(['embed', 'v1', 'api', 'jobs', 'careers', 'www'])

/** decodeURIComponent that leaves malformed escapes ("50%off") as they are. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Recognizes a job-board URL. Returns null for anything else. */
export function parseBoardUrl(raw: string): Board | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  const parts = url.pathname.split('/').filter(Boolean).map(safeDecode)
  const first = parts[0]

  if (/^(boards|job-boards)(\.eu)?\.greenhouse\.io$/.test(host)) {
    // Embeds look like boards.greenhouse.io/embed/job_board?for=<slug>
    const slug = url.searchParams.get('for') ?? first
    return slug && !SKIP_SLUGS.has(slug) ? { ats: 'greenhouse', slug, supported: true } : null
  }
  if (
    host === 'boards-api.greenhouse.io' &&
    parts[0] === 'v1' &&
    parts[1] === 'boards' &&
    parts[2]
  ) {
    return { ats: 'greenhouse', slug: parts[2], supported: true }
  }
  if (host === 'jobs.lever.co' && first) return { ats: 'lever', slug: first, supported: true }
  if (host === 'jobs.eu.lever.co' && first) {
    return { ats: 'lever', slug: first, region: 'eu', supported: true }
  }
  if (host === 'jobs.ashbyhq.com' && first && !SKIP_SLUGS.has(first)) {
    return { ats: 'ashby', slug: first, supported: true }
  }
  const workday = /^([\w-]+)\.(wd\d+)\.myworkdayjobs\.com$/.exec(host)
  if (workday) {
    // Paths are /<site>/… or /<locale>/<site>/…
    const site = parts[0] && /^[a-z]{2}-[A-Z]{2}$/.test(parts[0]) ? parts[1] : parts[0]
    if (!site) return null
    return {
      ats: 'workday',
      slug: workday[1],
      workday: { tenant: workday[1], host, site },
      supported: false,
      note: 'Workday adapter not built yet',
    }
  }
  const bamboo = /^([\w-]+)\.bamboohr\.com$/.exec(host)
  if (bamboo && bamboo[1] !== 'www') {
    return {
      ats: 'bamboohr',
      slug: bamboo[1],
      supported: false,
      note: 'BambooHR adapter not built yet',
    }
  }
  if (host === 'apply.workable.com' && first && first !== 'api' && first !== 'j') {
    return { ats: 'workable', slug: first, supported: true }
  }
  if (host === 'jobs.smartrecruiters.com' && first) {
    return {
      ats: 'smartrecruiters',
      slug: first,
      supported: false,
      note: 'SmartRecruiters isn’t supported',
    }
  }
  const recruitee = /^([\w-]+)\.recruitee\.com$/.exec(host)
  if (recruitee) {
    return { ats: 'recruitee', slug: recruitee[1], supported: true }
  }
  return null
}

const URL_IN_TEXT = /https?:\/\/[^\s"'<>()\\]+/gi

/** Every URL in a piece of HTML or text, with entities decoded and trailing punctuation removed. */
export function extractUrls(htmlOrText: string): string[] {
  const text = decodeHTML(htmlOrText)
  return [...new Set((text.match(URL_IN_TEXT) ?? []).map((u) => u.replace(/[.,;:!?]+$/, '')))]
}

/** Job boards linked from HTML or text, one per board. */
export function findBoards(htmlOrText: string): Board[] {
  const boards = new Map<string, Board>()
  for (const url of extractUrls(htmlOrText)) {
    const b = parseBoardUrl(url)
    if (b && !boards.has(boardKey(b))) boards.set(boardKey(b), b)
  }
  return [...boards.values()]
}

// ---------- Checking and guessing against the real APIs ----------

export interface DetectDeps {
  http: HttpClient
  /** Fetches a web page's HTML. */
  fetchText: (url: string) => Promise<string>
}

export async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  })
  if (!res.ok) throw new HttpError(res.status, url)
  return (await res.text()).slice(0, 2_000_000)
}

const API_URLS: Record<'greenhouse' | 'lever' | 'ashby', (slug: string) => string> = {
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
  lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json&limit=1`,
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
}

function apiUrl(ats: 'greenhouse' | 'lever' | 'ashby', slug: string): string {
  return API_URLS[ats](encodeURIComponent(slug))
}

/** Does this board exist? A 404 means no; other errors are passed on. */
async function boardExists(http: HttpClient, ats: 'greenhouse' | 'lever' | 'ashby', slug: string) {
  try {
    await http.getJson(apiUrl(ats, slug))
    return true
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 400)) return false
    throw err
  }
}

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'ltd', 'plc'])

const HOSTING_DOMAINS =
  /\.(vercel\.app|netlify\.app|github\.io|herokuapp\.com|pages\.dev|webflow\.io|framer\.website|framer\.app|carrd\.co|notion\.site|wixsite\.com|squarespace\.com|substack\.com|gitbook\.io|fly\.dev|onrender\.com|replit\.app)$/i

/** Slugs worth trying for a company: from its name and its website's domain. */
export function guessSlugs(name: string | undefined, siteUrl: string | undefined): string[] {
  const out: string[] = []
  const add = (s: string | undefined) => {
    const v = s?.toLowerCase().replace(/^-+|-+$/g, '')
    if (v && v.length >= 2 && !out.includes(v)) out.push(v)
  }
  if (siteUrl) {
    try {
      const host = new URL(siteUrl).hostname.replace(/^www\./, '')
      // On shared hosting (acme.vercel.app) the domain names the host, not the company.
      if (!HOSTING_DOMAINS.test(host)) {
        const labels = host.split('.')
        // acme.co.uk, acme.com.au: the name is before the two-part suffix.
        const twoPart = labels.length >= 3 && SECOND_LEVEL.has(labels.at(-2) ?? '')
        add(twoPart ? labels.at(-3) : labels.length > 1 ? labels.at(-2) : labels[0])
      }
    } catch {
      // not a URL
    }
  }
  if (name) {
    const words = name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\b(inc|llc|ltd|corp|co|gmbh|labs?|technologies|hq)\b\.?/gi, '')
      .toLowerCase()
      .match(/[a-z0-9]+/g)
    if (words) {
      add(words.join(''))
      add(words.join('-'))
    }
  }
  return out.slice(0, 3)
}

const GUESS_ATS = ['ashby', 'greenhouse', 'lever'] as const

/**
 * Finds a company's board from its own website: first by looking for board links in the
 * page HTML, then by trying likely slugs on each supported ATS.
 */
export async function detectFromSite(
  deps: DetectDeps,
  siteUrl: string,
  name?: string,
): Promise<{ boards: Board[]; via: DetectedVia } | null> {
  try {
    const boards = findBoards(await deps.fetchText(siteUrl))
    if (boards.length > 0) return { boards, via: 'page' }
  } catch {
    // Unreachable or blocked page: fall back to guessing.
  }
  // Tries are sequential and stop at the first hit, to keep requests down.
  /* oxlint-disable no-await-in-loop */
  for (const slug of guessSlugs(name, siteUrl)) {
    for (const ats of GUESS_ATS) {
      if (!(await boardExists(deps.http, ats, slug))) continue
      const board: Board = { ats, slug, supported: true }
      // Another company can own the same slug. Greenhouse tells us the board's company
      // name, so a guess whose name doesn't fit is dropped.
      const named = await boardName(deps.http, board)
      if (named && !looksLikeSameCompany(named, slug)) continue
      return { boards: [board], via: 'guess' }
    }
  }
  /* oxlint-enable no-await-in-loop */
  return null
}

const compact = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** "GitLab" fits "gitlab"; "Democorp" doesn't fit "example". */
export function looksLikeSameCompany(boardCompanyName: string, slug: string): boolean {
  const a = compact(boardCompanyName)
  const b = compact(slug)
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a))
}

/** Board name from Greenhouse's or Workable's API; the others don't expose one. */
async function boardName(http: HttpClient, board: Board): Promise<string | undefined> {
  const url =
    board.ats === 'greenhouse'
      ? `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.slug)}`
      : board.ats === 'workable'
        ? widgetUrl(board.slug, false)
        : undefined
  if (!url) return undefined
  try {
    const res = await http.getJson(url)
    if (typeof res === 'object' && res !== null && 'name' in res && typeof res.name === 'string') {
      return res.name.trim() || undefined
    }
  } catch {
    // name is optional
  }
  return undefined
}

function titleCase(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function toCompany(board: Board, name: string): Company | null {
  if (!board.supported || board.ats === 'smartrecruiters') return null
  return {
    name,
    ats: board.ats,
    slug: board.slug,
    ...(board.workday ? { workday: board.workday } : {}),
    ...(board.region ? { region: board.region } : {}),
  }
}

/** Fetches a supported board and counts open jobs and jobs that pass the profiles. */
export async function checkBoard(
  http: HttpClient,
  company: Company,
  profiles: Profile[],
): Promise<BoardCheck> {
  const { report } = await runIngest({
    config: { companies: [company], profiles },
    http,
    politeDelayMs: 0,
  })
  const r = report.companies[0]
  if (!r || r.status !== 'ok') {
    return { ok: false, openJobs: 0, matchingJobs: 0, error: r?.error ?? 'not checked' }
  }
  return { ok: true, openJobs: r.normalized, matchingJobs: r.kept }
}

/** Fills in names and checks for a list of detections, at most 4 at a time. */
export async function completeDetections(
  http: HttpClient,
  found: { board: Board; via: DetectedVia; name?: string }[],
  profiles: Profile[],
): Promise<Detection[]> {
  return mapLimit(found, 4, async ({ board, via, name }) => {
    const display = (await boardName(http, board)) ?? name ?? titleCase(board.slug)
    const company = toCompany(board, display)
    const check = company ? await checkBoard(http, company, profiles) : undefined
    return { board, via, name: display, check }
  })
}

/**
 * `detect-ats <url>`: a board URL is read directly; any other URL is treated as the
 * company's website.
 */
export async function detectFromUrl(
  deps: DetectDeps,
  url: string,
  profiles: Profile[],
  name?: string,
): Promise<Detection[]> {
  const direct = parseBoardUrl(url)
  if (direct) return completeDetections(deps.http, [{ board: direct, via: 'link', name }], profiles)
  const fromSite = await detectFromSite(deps, url, name)
  if (!fromSite) return []
  return completeDetections(
    deps.http,
    fromSite.boards.map((board) => ({ board, via: fromSite.via, name })),
    profiles,
  )
}

/** A human-facing link to a board, for the UI. */
export function boardUrl(b: {
  ats: string
  slug: string
  workday?: Board['workday']
  region?: 'eu'
}): string | null {
  const s = encodeURIComponent(b.slug)
  switch (b.ats) {
    case 'greenhouse':
      return `https://job-boards.greenhouse.io/${s}`
    case 'lever':
      return b.region === 'eu' ? `https://jobs.eu.lever.co/${s}` : `https://jobs.lever.co/${s}`
    case 'ashby':
      return `https://jobs.ashbyhq.com/${s}`
    case 'workday':
      return b.workday ? `https://${b.workday.host}/${encodeURIComponent(b.workday.site)}` : null
    case 'bamboohr':
      return `https://${s}.bamboohr.com/careers`
    case 'workable':
      return `https://apply.workable.com/${s}`
    case 'smartrecruiters':
      return `https://jobs.smartrecruiters.com/${s}`
    case 'recruitee':
      return `https://${s}.recruitee.com`
    default:
      return null
  }
}
