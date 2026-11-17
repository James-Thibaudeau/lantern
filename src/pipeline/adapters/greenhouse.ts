import { z } from 'zod'
import { decodeHTML, toIso } from '../text'
import type { LocationInput } from '../eligibility'
import { buildJob, parseRaw, requireCompany } from './build-job'
import type { SourceAdapter } from './types'

// https://developers.greenhouse.io/job-board.html — public, no key.
const RawJob = z.looseObject({
  id: z.number(),
  title: z.string(),
  absolute_url: z.string(),
  location: z.object({ name: z.string().nullable() }).nullish(),
  // HTML-entity-escaped HTML ("&lt;p&gt;…"), so it's decoded before storing.
  content: z.string().nullish(),
  updated_at: z.string().nullish(),
  first_published: z.string().nullish(),
  offices: z.array(z.looseObject({ name: z.string().nullish(), location: z.string().nullish() })).nullish(),
})

const Response = z.looseObject({ jobs: z.array(z.unknown()) })

export const greenhouse: SourceAdapter = {
  id: 'greenhouse',

  async fetch(company, { http }) {
    const c = requireCompany(company, 'greenhouse')
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(c.slug)}/jobs?content=true`
    const res = Response.parse(await http.getJson(url))
    return { raw: res.jobs, complete: true }
  },

  normalize(raw, company) {
    const c = requireCompany(company, 'greenhouse')
    const parsed = parseRaw(RawJob, raw)
    if (!parsed.ok) return parsed
    const j = parsed.data

    const locations: LocationInput[] = [{ text: j.location?.name ?? '' }]
    // Offices are sometimes the company's whole office list rather than this job's,
    // so only trust them when there's exactly one.
    const offices = j.offices ?? []
    if (offices.length === 1 && offices[0].location) locations.push({ text: offices[0].location })

    return buildJob({
      source: 'greenhouse',
      sourceJobId: String(j.id),
      companySlug: c.slug,
      company: c.name,
      title: j.title,
      url: j.absolute_url,
      applyUrl: j.absolute_url,
      locations,
      workplaceType: null, // free text only; eligibility reads it from the location text
      salary: null,
      descriptionHtml: decodeHTML(j.content ?? ''),
      postedAt: toIso(j.first_published),
      updatedAt: toIso(j.updated_at),
    })
  },
}
