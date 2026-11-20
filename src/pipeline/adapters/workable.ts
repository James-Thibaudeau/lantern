import { z } from 'zod'

import type { LocationInput } from '../eligibility'
import type { WorkplaceType } from '../schema'
import { toIso } from '../text'
import { buildJob, parseRaw, requireCompany } from './build-job'
import type { SourceAdapter } from './types'

// Workable's careers widget API — public, no key, the one its embeddable job widget uses.
// ?details=true includes each job's description.
const RawJob = z.looseObject({
  title: z.string(),
  shortcode: z.string(),
  url: z.string(),
  application_url: z.string().nullish(),
  telecommuting: z.boolean().nullish(),
  published_on: z.string().nullish(),
  created_at: z.string().nullish(),
  country: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  locations: z
    .array(
      z.looseObject({
        country: z.string().nullish(),
        countryCode: z.string().nullish(),
        city: z.string().nullish(),
        region: z.string().nullish(),
        hidden: z.boolean().nullish(),
      }),
    )
    .nullish(),
  description: z.string().nullish(),
})

export function widgetUrl(slug: string, details: boolean): string {
  return `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}${details ? '?details=true' : ''}`
}

const place = (...parts: (string | null | undefined)[]) =>
  parts.filter((p): p is string => Boolean(p?.trim())).join(', ')

const Repeat = z.looseObject({
  shortcode: z.string(),
  country: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  locations: RawJob.shape.locations,
})

/**
 * The widget lists a job once per location, repeating its shortcode. Merges the copies into
 * one job with every location, so eligibility sees all of them (ingest would otherwise keep
 * only the first copy). Items it can't read pass through for normalize to report.
 */
export function mergeByShortcode(jobs: unknown[]): unknown[] {
  const out: unknown[] = []
  const merged = new Map<string, Record<string, unknown> & z.infer<typeof Repeat>>()
  for (const item of jobs) {
    const r = Repeat.safeParse(item)
    if (!r.success) {
      out.push(item)
      continue
    }
    const locations =
      r.data.locations && r.data.locations.length > 0
        ? r.data.locations
        : [{ country: r.data.country, city: r.data.city, region: r.data.state, hidden: false }]
    const first = merged.get(r.data.shortcode)
    if (!first) {
      const job = { ...r.data, locations: [...locations] }
      merged.set(r.data.shortcode, job)
      out.push(job)
      continue
    }
    const key = (l: (typeof locations)[number]) => `${l.city}|${l.region}|${l.country}`
    const have = new Set((first.locations ?? []).map(key))
    first.locations = [...(first.locations ?? []), ...locations.filter((l) => !have.has(key(l)))]
  }
  return out
}

export const workable: SourceAdapter = {
  id: 'workable',

  async fetch(company, { http }) {
    const c = requireCompany(company, 'workable')
    const res = z
      .object({ jobs: z.array(z.unknown()) })
      .parse(await http.getJson(widgetUrl(c.slug, true)))
    return { raw: mergeByShortcode(res.jobs), complete: true }
  },

  normalize(raw, company) {
    const c = requireCompany(company, 'workable')
    const parsed = parseRaw(RawJob, raw)
    if (!parsed.ok) return parsed
    const j = parsed.data

    // Workable only says "telecommuting" (remote allowed); anything else is unknown.
    const mode: WorkplaceType | null = j.telecommuting ? 'remote' : null
    const shown = (j.locations ?? []).filter((l) => !l.hidden)
    const locations: LocationInput[] =
      shown.length > 0
        ? shown.map((l) => ({
            text: place(l.city, l.region, l.country),
            country: l.countryCode ?? l.country,
            workplaceType: mode,
          }))
        : [{ text: place(j.city, j.state, j.country), country: j.country, workplaceType: mode }]

    return buildJob({
      source: 'workable',
      sourceJobId: j.shortcode,
      companySlug: c.slug,
      company: c.name,
      title: j.title,
      url: j.url,
      applyUrl: j.application_url ?? null,
      locations,
      workplaceType: mode,
      salary: null,
      descriptionHtml: j.description ?? '',
      postedAt: toIso(j.published_on ?? j.created_at),
      updatedAt: null,
    })
  },
}
