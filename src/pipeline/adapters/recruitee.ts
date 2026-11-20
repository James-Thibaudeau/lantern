import { z } from 'zod'

import type { LocationInput } from '../eligibility'
import type { Salary, WorkplaceType } from '../schema'
import { toIso } from '../text'
import { buildJob, parseRaw, requireCompany } from './build-job'
import type { SourceAdapter } from './types'

// https://docs.recruitee.com/reference/offers — the careers-site offers API, public, no key.
const RawOffer = z.looseObject({
  id: z.number(),
  title: z.string(),
  status: z.string().nullish(),
  careers_url: z.string(),
  careers_apply_url: z.string().nullish(),
  location: z.string().nullish(),
  country_code: z.string().nullish(),
  remote: z.boolean().nullish(),
  hybrid: z.boolean().nullish(),
  on_site: z.boolean().nullish(),
  locations: z
    .array(z.looseObject({ name: z.string().nullish(), country_code: z.string().nullish() }))
    .nullish(),
  description: z.string().nullish(),
  requirements: z.string().nullish(),
  salary: z
    .looseObject({
      min: z.union([z.number(), z.string()]).nullish(),
      max: z.union([z.number(), z.string()]).nullish(),
      currency: z.string().nullish(),
      period: z.string().nullish(),
    })
    .nullish(),
  published_at: z.string().nullish(),
  updated_at: z.string().nullish(),
})

/** Recruitee dates look like "2026-11-20 11:15:31 UTC". */
export function recruiteeDate(value: string | null | undefined): string | null {
  if (!value) return null
  return toIso(value.replace(' UTC', 'Z').replace(' ', 'T'))
}

function workplace(o: z.infer<typeof RawOffer>): WorkplaceType | null {
  if (o.remote) return 'remote'
  if (o.hybrid) return 'hybrid'
  if (o.on_site) return 'onsite'
  return null
}

const amount = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function salary(s: z.infer<typeof RawOffer>['salary']): Salary | null {
  const min = amount(s?.min)
  const max = amount(s?.max)
  if (min === null && max === null) return null
  const p = s?.period ?? ''
  const period = /year|annual/i.test(p)
    ? 'year'
    : /month/i.test(p)
      ? 'month'
      : /week/i.test(p)
        ? 'week'
        : /day/i.test(p)
          ? 'day'
          : /hour/i.test(p)
            ? 'hour'
            : null
  return { min, max, currency: s?.currency ?? null, period }
}

export const recruitee: SourceAdapter = {
  id: 'recruitee',

  async fetch(company, { http }) {
    const c = requireCompany(company, 'recruitee')
    const url = `https://${encodeURIComponent(c.slug)}.recruitee.com/api/offers/`
    const res = z.object({ offers: z.array(z.unknown()) }).parse(await http.getJson(url))
    return { raw: res.offers, complete: true }
  },

  normalize(raw, company) {
    const c = requireCompany(company, 'recruitee')
    const parsed = parseRaw(RawOffer, raw)
    if (!parsed.ok) return parsed
    const o = parsed.data
    if (o.status && o.status !== 'published') {
      return { ok: false, sourceJobId: String(o.id), error: `Offer is ${o.status}` }
    }

    const mode = workplace(o)
    const listed = (o.locations ?? []).filter((l) => l.name)
    const locations: LocationInput[] =
      listed.length > 0
        ? listed.map((l) => ({ text: l.name ?? '', country: l.country_code, workplaceType: mode }))
        : [{ text: o.location ?? '', country: o.country_code, workplaceType: mode }]

    return buildJob({
      source: 'recruitee',
      sourceJobId: String(o.id),
      companySlug: c.slug,
      company: c.name,
      title: o.title,
      url: o.careers_url,
      applyUrl: o.careers_apply_url ?? null,
      locations,
      workplaceType: mode,
      salary: salary(o.salary),
      descriptionHtml: [o.description ?? '', o.requirements ?? ''].join('\n'),
      postedAt: recruiteeDate(o.published_at),
      updatedAt: recruiteeDate(o.updated_at),
    })
  },
}
