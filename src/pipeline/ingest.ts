import { adapters, type FetchContext } from './adapters'
import type { IngestConfig } from './config'
import { createFilter, type FilterResult } from './filter'
import { mapLimit, sleep, type HttpClient } from './http'
import { ELIGIBILITY, type Company, type Eligibility, type Job } from './schema'

export interface IngestOptions {
  config: IngestConfig
  http: HttpClient
  /** Only fetch these company slugs (the workflow's `companies` input / CLI --company). */
  only?: string[]
  runId?: string
  concurrency?: number
  /** Pause after each company's requests, to stay polite. */
  politeDelayMs?: number
  maxDetailCalls?: number
  now?: () => Date
}

export type CompanyStatus = 'ok' | 'error' | 'skipped'

export interface CompanyReport {
  slug: string
  name: string
  ats: Company['ats']
  status: CompanyStatus
  /** Fetched successfully and fully. Only complete companies take part in closed-job detection. */
  complete: boolean
  fetched: number
  normalized: number
  normalizeErrors: number
  normalizeErrorSamples: { sourceJobId?: string; error: string }[]
  kept: number
  droppedTitle: number
  droppedEligibility: number
  durationMs: number
  error?: string
}

export interface IngestReport {
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  failed: boolean
  totals: {
    companies: number
    ok: number
    errors: number
    skipped: number
    fetched: number
    normalized: number
    normalizeErrors: number
    kept: number
    droppedTitle: number
    droppedEligibility: number
  }
  /** Eligibility of every normalized job, kept or not. Useful for tuning the rules. */
  eligibility: Record<Eligibility, number>
  companies: CompanyReport[]
}

export interface OpenListing {
  runId: string
  generatedAt: string
  /** Companies fetched successfully and completely in this run. */
  completeCompanies: string[]
  /** Every job from those companies that passes the filter. Sync closes local jobs missing from here. */
  jobs: { id: string; contentHash: string; companySlug: string }[]
}

export interface JobOutcome {
  job: Job
  filter: FilterResult
}

export interface IngestResult {
  report: IngestReport
  open: OpenListing
  /** Jobs that passed the filter. Stage 1 has no seen-state yet, so all of them are "new". */
  kept: Job[]
  /** Every normalized job with its filter decision (for dry runs and debugging). */
  outcomes: JobOutcome[]
}

const emptyEligibility = () =>
  Object.fromEntries(ELIGIBILITY.map((e) => [e, 0])) as Record<Eligibility, number>

export async function runIngest(opts: IngestOptions): Promise<IngestResult> {
  const now = opts.now ?? (() => new Date())
  const started = now()
  const runId = opts.runId ?? `local-${started.getTime()}`
  const { companies: allCompanies, profiles } = opts.config

  let companies = allCompanies
  if (opts.only?.length) {
    const unknown = opts.only.filter((s) => !allCompanies.some((c) => c.slug === s))
    if (unknown.length) throw new Error(`Unknown company slug(s): ${unknown.join(', ')}`)
    companies = allCompanies.filter((c) => opts.only!.includes(c.slug))
  }

  const filter = createFilter(profiles)
  const ctx: FetchContext = {
    http: opts.http,
    searchTerms: [...new Set(profiles.filter((p) => p.enabled).flatMap((p) => p.titleInclude))],
    maxDetailCalls: opts.maxDetailCalls ?? 50,
  }

  const perCompany = await mapLimit(companies, opts.concurrency ?? 4, async (company) => {
    const t0 = Date.now()
    const report: CompanyReport = {
      slug: company.slug,
      name: company.name,
      ats: company.ats,
      status: 'ok',
      complete: false,
      fetched: 0,
      normalized: 0,
      normalizeErrors: 0,
      normalizeErrorSamples: [],
      kept: 0,
      droppedTitle: 0,
      droppedEligibility: 0,
      durationMs: 0,
    }
    const outcomes: JobOutcome[] = []

    const adapter = adapters[company.ats]
    if (!adapter) {
      report.status = 'skipped'
      report.error = `No ${company.ats} adapter yet`
      return { report, outcomes }
    }

    try {
      const { raw, complete } = await adapter.fetch(company, ctx)
      report.fetched = raw.length
      report.complete = complete
      const seenIds = new Set<string>()
      for (const item of raw) {
        const result = adapter.normalize(item, company)
        if (!result.ok) {
          report.normalizeErrors++
          if (report.normalizeErrorSamples.length < 3) {
            report.normalizeErrorSamples.push({
              sourceJobId: result.sourceJobId,
              error: result.error,
            })
          }
          continue
        }
        if (seenIds.has(result.job.id)) continue
        seenIds.add(result.job.id)
        report.normalized++
        const decision = filter(result.job)
        if (decision.keep) report.kept++
        else if (decision.reason === 'title') report.droppedTitle++
        else report.droppedEligibility++
        outcomes.push({ job: result.job, filter: decision })
      }
    } catch (err) {
      report.status = 'error'
      report.complete = false
      report.error = err instanceof Error ? err.message : String(err)
    }

    report.durationMs = Date.now() - t0
    if (opts.politeDelayMs ?? 250) await sleep(opts.politeDelayMs ?? 250)
    return { report, outcomes }
  })

  const reports = perCompany.map((p) => p.report)
  const outcomes = perCompany.flatMap((p) => p.outcomes)
  const kept = outcomes.filter((o) => o.filter.keep).map((o) => o.job)

  const eligibility = emptyEligibility()
  for (const o of outcomes) eligibility[o.job.eligibility]++

  const sum = (
    k: keyof Pick<
      CompanyReport,
      'fetched' | 'normalized' | 'normalizeErrors' | 'kept' | 'droppedTitle' | 'droppedEligibility'
    >,
  ) => reports.reduce((n, r) => n + r[k], 0)
  const ok = reports.filter((r) => r.status === 'ok').length

  const finished = now()
  const report: IngestReport = {
    runId,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    // The run only fails when nothing could be fetched at all.
    failed: ok === 0,
    totals: {
      companies: reports.length,
      ok,
      errors: reports.filter((r) => r.status === 'error').length,
      skipped: reports.filter((r) => r.status === 'skipped').length,
      fetched: sum('fetched'),
      normalized: sum('normalized'),
      normalizeErrors: sum('normalizeErrors'),
      kept: sum('kept'),
      droppedTitle: sum('droppedTitle'),
      droppedEligibility: sum('droppedEligibility'),
    },
    eligibility,
    companies: reports,
  }

  const completeCompanies = reports
    .filter((r) => r.status === 'ok' && r.complete)
    .map((r) => r.slug)
  const complete = new Set(completeCompanies)
  const open: OpenListing = {
    runId,
    generatedAt: finished.toISOString(),
    completeCompanies,
    jobs: kept
      .filter((j) => complete.has(j.companySlug))
      .map((j) => ({ id: j.id, contentHash: j.contentHash, companySlug: j.companySlug })),
  }

  return { report, open, kept, outcomes }
}
