import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'

import { formatDate } from '#/components/jobs/format'
import { JobDetail } from '#/components/jobs/JobDetail'
import { JobList } from '#/components/jobs/JobList'
import { Callout, EmptyState, inputClass, selectClass } from '#/components/ui'
import {
  ELIGIBILITY,
  ELIGIBILITY_LABEL,
  EligibilitySchema,
  type JobStatus,
} from '#/pipeline/schema'
import { getJobs, setJobStatus, type JobRow } from '#/server/jobs'

const TABS = ['inbox', 'interested', 'applied', 'dismissed'] as const
type Tab = (typeof TABS)[number]

const TAB_STATUS: Record<Tab, JobStatus> = {
  inbox: 'new',
  interested: 'interested',
  applied: 'applied',
  dismissed: 'dismissed',
}
const TAB_LABEL: Record<Tab, string> = {
  inbox: 'Inbox',
  interested: 'Interested',
  applied: 'Applied',
  dismissed: 'Dismissed',
}
const TAB_EMPTY: Record<Tab, string> = {
  inbox: 'Inbox zero. New jobs land here after each sync.',
  interested: 'Nothing marked Interested yet. Select a job and press I.',
  applied: 'Nothing marked Applied yet. Select a job and press A.',
  dismissed: 'Nothing dismissed. Dismissed jobs never come back to the inbox.',
}

// Filters, the tab and the selected job live in the URL, so a view can be bookmarked and the
// back button undoes a change.
const JobsSearch = z.object({
  tab: z.enum(TABS).optional().catch(undefined),
  job: z.string().optional().catch(undefined),
  eligibility: z.enum(ELIGIBILITY).optional().catch(undefined),
  company: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  closed: z.boolean().optional().catch(undefined),
  /** Defaults to score when there are ranking criteria, newest otherwise. */
  sort: z.enum(['score', 'newest']).optional().catch(undefined),
})
type JobsSearch = z.infer<typeof JobsSearch>

export const Route = createFileRoute('/jobs')({
  validateSearch: (search) => JobsSearch.parse(search),
  // The loader runs before the page renders: on the server for the first load, and through
  // the server function's HTTP endpoint later. Only "show closed" changes what's loaded; the
  // other filters apply in the browser.
  loaderDeps: ({ search }) => ({ closed: search.closed ?? false }),
  loader: ({ deps }) => getJobs({ data: deps }),
  head: () => ({ meta: [{ title: 'Jobs · Lantern' }] }),
  component: JobsPage,
})

function matches(job: JobRow, search: JobsSearch): boolean {
  if (search.eligibility && job.eligibility !== search.eligibility) return false
  if (search.company && job.companySlug !== search.company) return false
  if (search.q) {
    const q = search.q.toLowerCase()
    if (!`${job.title} ${job.company} ${job.locationText}`.toLowerCase().includes(q)) return false
  }
  return true
}

/**
 * Best match first: jobs without a dealbreaker, then by score. Array sort is stable, so ties
 * keep the server's newest-first order. (Same rule as compareScores in src/rank/score.ts,
 * which can't be imported here because it pulls in server-only code.)
 */
function byScore(a: JobRow, b: JobRow): number {
  if ((a.dealbreaker === null) !== (b.dealbreaker === null)) return a.dealbreaker === null ? -1 : 1
  return (b.score ?? 0) - (a.score ?? 0)
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
  )
}

const DAY_MS = 24 * 60 * 60 * 1000

function JobsPage() {
  const { jobs: loaded, lastRun, ranking } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  // Status changes show at once. They're tied to the loaded data they were made on, so fresh
  // loader data (which has them saved) replaces them.
  const [pending, setPending] = useState<{ on: JobRow[]; status: Record<string, JobStatus> }>({
    on: loaded,
    status: {},
  })
  const [error, setError] = useState<string | null>(null)
  const jobs = useMemo(() => {
    const status = pending.on === loaded ? pending.status : {}
    return loaded.map((j) => (status[j.id] ? { ...j, status: status[j.id] } : j))
  }, [loaded, pending])

  const tab = search.tab ?? 'inbox'
  const sort = ranking.ranked ? (search.sort ?? 'score') : 'newest'
  const setSearch = (patch: Partial<JobsSearch>, replace = true) => {
    // navigate() returns a promise; filter changes don't need to wait for it.
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace })
  }

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { inbox: 0, interested: 0, applied: 0, dismissed: 0 }
    for (const j of jobs) {
      const t = TABS.find((x) => TAB_STATUS[x] === j.status)
      if (t && matches(j, search)) c[t]++
    }
    return c
  }, [jobs, search])

  const companies = useMemo(
    () =>
      [...new Map(jobs.map((j) => [j.companySlug, j.company])).entries()].toSorted((a, b) =>
        a[1].localeCompare(b[1]),
      ),
    [jobs],
  )
  const eligibilities = useMemo(
    () => ELIGIBILITY.filter((e) => jobs.some((j) => j.eligibility === e)),
    [jobs],
  )
  const visible = useMemo(() => {
    const kept = jobs.filter((j) => j.status === TAB_STATUS[tab] && matches(j, search))
    return sort === 'score' ? kept.toSorted(byScore) : kept
  }, [jobs, search, sort, tab])

  // On wide screens something is always selected; on phones the detail opens only for a job
  // chosen in the URL.
  const chosen = visible.find((j) => j.id === search.job) ?? null
  const selected = chosen ?? visible[0] ?? null
  const detailOpen = chosen !== null

  // "New" = first seen within a day of the latest run.
  const newSince = lastRun ? new Date(lastRun.at).getTime() - DAY_MS : Infinity
  const isNew = (j: JobRow) => new Date(j.firstSeenAt).getTime() >= newSince && !j.closedAt

  const select = (id: string | undefined, replace = false) => setSearch({ job: id }, replace)

  async function changeStatus(job: JobRow, status: Exclude<JobStatus, 'new'>) {
    const next: JobStatus = job.status === status ? 'new' : status
    if (next !== TAB_STATUS[tab]) {
      // The job leaves this tab: select its neighbour, like archiving in a mail app.
      const i = visible.findIndex((j) => j.id === job.id)
      select((visible[i + 1] ?? visible[i - 1])?.id, true)
    }
    setError(null)
    setPending((p) => ({
      on: loaded,
      status: { ...(p.on === loaded ? p.status : {}), [job.id]: next },
    }))
    try {
      const r = await setJobStatus({ data: { id: job.id, status: next } })
      if (!r.ok) setError(r.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    await router.invalidate() // also refreshes the sidebar's inbox count
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      const i = selected ? visible.findIndex((j) => j.id === selected.id) : -1
      if (e.key === 'j' || e.key === 'k') {
        const next =
          visible[e.key === 'j' ? Math.min(i + 1, visible.length - 1) : Math.max(i - 1, 0)]
        if (next) select(next.id, true)
      } else if (selected && (e.key === 'i' || e.key === 'a' || e.key === 'x')) {
        const status = e.key === 'i' ? 'interested' : e.key === 'a' ? 'applied' : 'dismissed'
        void changeStatus(selected, status)
      } else if (selected && e.key === 'o') {
        window.open(selected.url, '_blank', 'noopener')
      } else if (e.key === 'Escape' && detailOpen) {
        select(undefined)
      } else {
        return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (loaded.length === 0 && !lastRun) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <EmptyState title="No jobs yet">
          <p>
            Set <code>LANTERN_RUNNER_REPO</code> in <code>.env</code> and press Sync, or load a
            local ingest:
          </p>
          <pre className="mt-3 inline-block rounded-md bg-sunken px-3 py-2 text-left text-xs">
            pnpm cli ingest --config ../lantern-runner/config --out out/{'\n'}pnpm sync --from out/
          </pre>
        </EmptyState>
      </div>
    )
  }

  const filtered = Boolean(search.eligibility || search.company || search.q)

  return (
    <div className="flex h-full flex-col">
      <div
        className={`border-b border-line bg-surface px-4 pt-5 md:px-6 ${detailOpen ? 'hidden md:block' : ''}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          {lastRun && (
            <p className="text-xs text-muted">
              Last run {formatDate(lastRun.at)}
              {lastRun.totals &&
                ` · ${lastRun.totals.ok}/${lastRun.totals.companies} companies · ${lastRun.totals.kept} kept`}
            </p>
          )}
        </div>
        {(!ranking.ok || !ranking.ranked) && (
          <p
            className={`mt-1 text-xs ${ranking.ok ? 'text-muted' : 'text-red-700 dark:text-red-400'}`}
          >
            {ranking.message}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Search jobs"
            placeholder="Search title, company, location"
            defaultValue={search.q ?? ''}
            onChange={(e) => setSearch({ q: e.target.value || undefined })}
            className={`min-w-0 flex-1 basis-48 ${inputClass}`}
          />
          <select
            aria-label="Filter by location"
            value={search.eligibility ?? ''}
            onChange={(e) =>
              setSearch({ eligibility: EligibilitySchema.safeParse(e.target.value).data })
            }
            className={`min-w-0 ${selectClass}`}
          >
            <option value="">All locations</option>
            {eligibilities.map((e) => (
              <option key={e} value={e}>
                {ELIGIBILITY_LABEL[e]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by company"
            value={search.company ?? ''}
            onChange={(e) => setSearch({ company: e.target.value || undefined })}
            className={`min-w-0 ${selectClass}`}
          >
            <option value="">All companies</option>
            {companies.map(([slug, name]) => (
              <option key={slug} value={slug}>
                {name}
              </option>
            ))}
          </select>
          {ranking.ranked && (
            <select
              aria-label="Sort jobs"
              value={sort}
              onChange={(e) =>
                setSearch({ sort: e.target.value === 'newest' ? 'newest' : undefined })
              }
              className={`min-w-0 ${selectClass}`}
            >
              <option value="score">Best match</option>
              <option value="newest">Newest</option>
            </select>
          )}
          <label className="flex items-center gap-1.5 text-sm text-muted">
            <input
              type="checkbox"
              className="accent-accent-600"
              checked={search.closed ?? false}
              onChange={(e) => setSearch({ closed: e.target.checked || undefined })}
            />
            Closed
          </label>
          {filtered && (
            <button
              type="button"
              onClick={() =>
                setSearch({ q: undefined, eligibility: undefined, company: undefined })
              }
              className="text-sm text-muted hover:text-ink hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        <nav aria-label="Job status" className="mt-3 -mb-px flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              aria-current={t === tab ? 'page' : undefined}
              onClick={() =>
                setSearch({ tab: t === 'inbox' ? undefined : t, job: undefined }, false)
              }
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
                t === tab
                  ? 'border-accent-500 font-medium text-ink'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {TAB_LABEL[t]}
              <span
                className={`rounded-full px-1.5 text-xs tabular-nums ${t === tab ? 'bg-accent-500/15 text-accent-800 dark:text-accent-300' : 'bg-sunken'}`}
              >
                {counts[t]}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {error && (
        <div className="px-4 pt-3 md:px-6">
          <Callout tone="error">Couldn’t save that change: {error}</Callout>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <section
          aria-label={`${TAB_LABEL[tab]} jobs`}
          className={`w-full shrink-0 overflow-y-auto border-line bg-surface md:w-[22rem] md:border-r lg:w-[26rem] ${detailOpen ? 'hidden md:block' : ''}`}
        >
          {visible.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted">
              {filtered ? 'No jobs match these filters.' : TAB_EMPTY[tab]}
            </p>
          ) : (
            <JobList
              jobs={visible}
              selectedId={selected?.id ?? null}
              isNew={isNew}
              onSelect={(id) => select(id)}
            />
          )}
        </section>

        <section
          aria-label="Job details"
          className={`min-w-0 flex-1 overflow-y-auto ${detailOpen ? '' : 'hidden md:block'}`}
        >
          {selected ? (
            <JobDetail
              key={selected.id}
              job={selected}
              onStatus={(s) => void changeStatus(selected, s)}
              onBack={() => select(undefined)}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted">
              Nothing to show here.
            </div>
          )}
          {selected && (
            <p className="hidden px-8 pb-6 text-xs text-muted lg:block">
              Keys: J / K to move · I interested · A applied · X dismiss · O open posting
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
