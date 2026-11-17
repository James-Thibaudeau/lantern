import { z } from 'zod'
import { classifyEligibility, type LocationInput } from '../eligibility'
import { JobSchema, type Job, type Salary, type SourceId, type WorkplaceType } from '../schema'
import { htmlToText, normalizeKey, sha256 } from '../text'
import type { NormalizeResult } from './types'

/** What an adapter knows about a posting; buildJob derives the rest. */
export interface JobDraft {
  source: SourceId
  sourceJobId: string
  companySlug: string
  company: string
  title: string
  url: string
  applyUrl: string | null
  locations: LocationInput[]
  workplaceType: WorkplaceType | null
  salary: Salary | null
  descriptionHtml: string
  postedAt: string | null
  updatedAt: string | null
}

export function buildJob(d: JobDraft): NormalizeResult {
  const descriptionText = htmlToText(d.descriptionHtml)
  const locationText = d.locations
    .map((l) => l.text.trim())
    .filter(Boolean)
    .join('; ')
  const { eligibility, country, workplaceType } = classifyEligibility({
    locations: d.locations,
    workplaceType: d.workplaceType,
    descriptionText,
  })

  const content = {
    title: d.title.trim(),
    url: d.url,
    applyUrl: d.applyUrl,
    locationText,
    country,
    workplaceType,
    eligibility,
    salary: d.salary,
    descriptionHtml: d.descriptionHtml,
  }

  const candidate: Job = {
    id: sha256(`${d.source}:${d.companySlug}:${d.sourceJobId}`, 24),
    dedupeKey: [d.company, d.title, locationText].map(normalizeKey).join('|'),
    source: d.source,
    sourceJobId: d.sourceJobId,
    companySlug: d.companySlug,
    company: d.company,
    ...content,
    descriptionText,
    postedAt: d.postedAt,
    updatedAt: d.updatedAt,
    // Includes eligibility, so improving the rules re-sends the affected jobs as "updated".
    contentHash: sha256(JSON.stringify(content), 24),
  }

  const parsed = JobSchema.safeParse(candidate)
  if (!parsed.success) {
    return { ok: false, sourceJobId: d.sourceJobId, error: z.prettifyError(parsed.error) }
  }
  return { ok: true, job: parsed.data }
}

/** Parse a raw posting with a lenient schema, turning failures into a NormalizeResult. */
export function parseRaw<T>(schema: z.ZodType<T>, raw: unknown): { ok: true; data: T } | { ok: false; error: string; sourceJobId?: string } {
  const parsed = schema.safeParse(raw)
  if (parsed.success) return { ok: true, data: parsed.data }
  const id = (raw as { id?: unknown } | null)?.id
  return {
    ok: false,
    sourceJobId: typeof id === 'string' || typeof id === 'number' ? String(id) : undefined,
    error: z.prettifyError(parsed.error),
  }
}

export function requireCompany<T>(company: T | undefined, source: string): T {
  if (!company) throw new Error(`${source} adapter needs a company`)
  return company
}
