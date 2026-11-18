import { z } from 'zod'

import type { LocationInput } from '../eligibility'
import type { Salary, WorkplaceType } from '../schema'
import { toIso } from '../text'
import { buildJob, parseRaw, requireCompany } from './build-job'
import type { SourceAdapter } from './types'

// https://developers.ashbyhq.com/docs/public-job-posting-api — public, no key.
// Responses can be large (about 15 MB for big boards).

const Address = z
  .looseObject({
    postalAddress: z.looseObject({ addressCountry: z.string().nullish() }).nullish(),
  })
  .nullish()

const RawJob = z.looseObject({
  id: z.string(),
  title: z.string(),
  location: z.string().nullish(),
  secondaryLocations: z
    .array(z.looseObject({ location: z.string().nullish(), address: Address }))
    .nullish(),
  isListed: z.boolean().nullish(),
  isRemote: z.boolean().nullish(),
  workplaceType: z.string().nullish(), // OnSite | Remote | Hybrid
  address: Address,
  jobUrl: z.string(),
  applyUrl: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  publishedAt: z.string().nullish(),
  compensation: z
    .looseObject({
      summaryComponents: z
        .array(
          z.looseObject({
            compensationType: z.string().nullish(),
            interval: z.string().nullish(),
            currencyCode: z.string().nullish(),
            minValue: z.number().nullish(),
            maxValue: z.number().nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
})

const Response = z.looseObject({ jobs: z.array(z.unknown()) })

// Ashby sets isRemote: true on some hybrid jobs, so workplaceType wins when present.
function workplace(
  type: string | null | undefined,
  isRemote: boolean | null | undefined,
): WorkplaceType | null {
  switch (type?.toLowerCase()) {
    case 'onsite':
      return 'onsite'
    case 'remote':
      return 'remote'
    case 'hybrid':
      return 'hybrid'
  }
  return isRemote ? 'remote' : null
}

const INTERVALS: Record<string, Salary['period']> = {
  '1 YEAR': 'year',
  '1 MONTH': 'month',
  '1 WEEK': 'week',
  '1 DAY': 'day',
  '1 HOUR': 'hour',
}

export const ashby: SourceAdapter = {
  id: 'ashby',

  async fetch(company, { http }) {
    const c = requireCompany(company, 'ashby')
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(c.slug)}?includeCompensation=true`
    const res = Response.parse(await http.getJson(url))
    const listed = res.jobs.filter((j) => (j as { isListed?: unknown }).isListed !== false)
    return { raw: listed, complete: true }
  },

  normalize(raw, company) {
    const c = requireCompany(company, 'ashby')
    const parsed = parseRaw(RawJob, raw)
    if (!parsed.ok) return parsed
    const j = parsed.data

    const mode = workplace(j.workplaceType, j.isRemote)
    const locations: LocationInput[] = [
      {
        text: j.location ?? '',
        country: j.address?.postalAddress?.addressCountry,
        workplaceType: mode,
      },
      ...(j.secondaryLocations ?? []).map((s) => ({
        text: s.location ?? '',
        country: s.address?.postalAddress?.addressCountry,
      })),
    ]

    const pay = j.compensation?.summaryComponents?.find((s) => s.compensationType === 'Salary')
    const salary: Salary | null =
      pay && (pay.minValue != null || pay.maxValue != null)
        ? {
            min: pay.minValue ?? null,
            max: pay.maxValue ?? null,
            currency: pay.currencyCode ?? null,
            period: INTERVALS[pay.interval ?? ''] ?? null,
          }
        : null

    return buildJob({
      source: 'ashby',
      sourceJobId: j.id,
      companySlug: c.slug,
      company: c.name,
      title: j.title,
      url: j.jobUrl,
      applyUrl: j.applyUrl ?? null,
      locations,
      workplaceType: mode,
      salary,
      descriptionHtml: j.descriptionHtml ?? '',
      postedAt: toIso(j.publishedAt),
      updatedAt: null,
    })
  },
}
