import { escapeText } from 'entities'
import { z } from 'zod'

import type { LocationInput } from '../eligibility'
import type { Salary, WorkplaceType } from '../schema'
import { toIso } from '../text'
import { buildJob, parseRaw, requireCompany } from './build-job'
import type { SourceAdapter } from './types'

// https://github.com/lever/postings-api — public, no key. EU-hosted boards (region "eu")
// use the same API on api.eu.lever.co.
const RawJob = z.looseObject({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string(),
  applyUrl: z.string().nullish(),
  createdAt: z.number().nullish(),
  country: z.string().nullish(), // ISO code, e.g. "CA"
  workplaceType: z.string().nullish(), // onsite | remote | hybrid | unspecified
  categories: z
    .looseObject({ location: z.string().nullish(), allLocations: z.array(z.string()).nullish() })
    .nullish(),
  description: z.string().nullish(),
  lists: z.array(z.object({ text: z.string(), content: z.string() })).nullish(),
  additional: z.string().nullish(),
  salaryRange: z
    .object({
      min: z.number().nullish(),
      max: z.number().nullish(),
      currency: z.string().nullish(),
      interval: z.string().nullish(),
    })
    .nullish(),
})

function workplace(value: string | null | undefined): WorkplaceType | null {
  if (value === 'onsite' || value === 'remote' || value === 'hybrid') return value
  return null
}

const INTERVALS: Record<string, Salary['period']> = {
  'per-year-salary': 'year',
  'per-month-salary': 'month',
  'per-week-salary': 'week',
  'per-day-wage': 'day',
  'per-hour-wage': 'hour',
}

export const lever: SourceAdapter = {
  id: 'lever',

  async fetch(company, { http }) {
    const c = requireCompany(company, 'lever')
    const host = c.region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co'
    const url = `https://${host}/v0/postings/${encodeURIComponent(c.slug)}?mode=json`
    const res = z.array(z.unknown()).parse(await http.getJson(url))
    return { raw: res, complete: true }
  },

  normalize(raw, company) {
    const c = requireCompany(company, 'lever')
    const parsed = parseRaw(RawJob, raw)
    if (!parsed.ok) return parsed
    const j = parsed.data

    const mode = workplace(j.workplaceType)
    const primary = j.categories?.location ?? ''
    const others = (j.categories?.allLocations ?? []).filter((l) => l !== primary)
    const locations: LocationInput[] = [
      { text: primary, country: j.country, workplaceType: mode },
      ...others.map((text) => ({ text, workplaceType: mode })),
    ]

    const descriptionHtml = [
      j.description ?? '',
      ...(j.lists ?? []).map((l) => `<h3>${escapeText(l.text)}</h3><ul>${l.content}</ul>`),
      j.additional ?? '',
    ].join('\n')

    const s = j.salaryRange
    const salary: Salary | null =
      s && (s.min != null || s.max != null)
        ? {
            min: s.min ?? null,
            max: s.max ?? null,
            currency: s.currency ?? null,
            period: INTERVALS[s.interval ?? ''] ?? null,
          }
        : null

    return buildJob({
      source: 'lever',
      sourceJobId: j.id,
      companySlug: c.slug,
      company: c.name,
      title: j.text,
      url: j.hostedUrl,
      applyUrl: j.applyUrl ?? null,
      locations,
      workplaceType: mode,
      salary,
      descriptionHtml,
      postedAt: toIso(j.createdAt),
      updatedAt: null,
    })
  },
}
