import type { HttpClient } from '../http'
import type { Company, Job, SourceId } from '../schema'

export interface FetchContext {
  http: HttpClient
  /** Derived from enabled profiles' titleInclude. Used by sources that search server-side (Workday). */
  searchTerms: string[]
  /** Per-company cap on per-job detail requests (Workday). */
  maxDetailCalls: number
}

export interface FetchResult {
  raw: unknown[]
  /** false if paging stopped early or a detail cap was hit. Closed-job detection skips incomplete companies. */
  complete: boolean
}

export type NormalizeResult = { ok: true; job: Job } | { ok: false; error: string; sourceJobId?: string }

export interface SourceAdapter {
  id: SourceId
  fetch(company: Company | undefined, ctx: FetchContext): Promise<FetchResult>
  /** Never throws: a bad posting is reported and skipped, it doesn't fail the company. */
  normalize(raw: unknown, company?: Company): NormalizeResult
}
