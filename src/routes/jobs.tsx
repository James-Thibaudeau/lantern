import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { z } from 'zod'

import { ELIGIBILITY, EligibilitySchema, type Eligibility, type Salary } from '#/pipeline/schema'
import { getJobs, syncNow, type JobRow } from '#/server/jobs'
import { runNow } from '#/server/runs'

// Filters live in the URL (?eligibility=…&company=…&q=…), so a filtered view can be
// bookmarked or shared, and the back button undoes a filter change.
const JobsSearch = z.object({
  eligibility: z.enum(ELIGIBILITY).optional().catch(undefined),
  company: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  closed: z.boolean().optional().catch(undefined),
})
type JobsSearch = z.infer<typeof JobsSearch>

export const Route = createFileRoute('/jobs')({
  validateSearch: (search) => JobsSearch.parse(search),
  // The loader runs before the page renders: on the server for the first load,
  // and through the server function's HTTP endpoint on later client-side visits.
  // loaderDeps picks the search params the loader depends on, so toggling "show closed"
  // reloads data, while the other filters (applied in the browser) don't.
  loaderDeps: ({ search }) => ({ closed: search.closed ?? false }),
  loader: ({ deps }) => getJobs({ data: deps }),
  head: () => ({ meta: [{ title: 'Jobs · Lantern' }] }),
  component: JobsPage,
})

const ELIGIBILITY_LABEL: Record<Eligibility, string> = {
  remote_canada_ok: 'Remote · Canada OK',
  canada_hybrid: 'Hybrid · Canada',
  canada_onsite: 'On-site · Canada',
  unknown: 'Unknown',
  remote_us_only: 'Remote · US only',
  remote_non_canada: 'Remote · outside Canada',
  non_canada_onsite: 'On-site · outside Canada',
}

const ELIGIBILITY_STYLE: Record<Eligibility, string> = {
  remote_canada_ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  canada_hybrid: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  canada_onsite: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  unknown: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  remote_us_only: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  remote_non_canada: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  non_canada_onsite: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
}

function formatSalary(s: Salary | null): string {
  if (!s || (s.min == null && s.max == null)) return '—'
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-CA', {
      style: s.currency ? 'currency' : 'decimal',
      currency: s.currency ?? undefined,
      notation: n >= 10_000 ? 'compact' : 'standard',
      maximumFractionDigits: n >= 10_000 ? 0 : 2,
    }).format(n)
  const range =
    s.min != null && s.max != null && s.min !== s.max
      ? `${fmt(s.min)}–${fmt(s.max)}`
      : fmt((s.min ?? s.max)!)
  return s.period ? `${range} / ${s.period}` : range
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function matches(job: JobRow, search: JobsSearch): boolean {
  if (search.eligibility && job.eligibility !== search.eligibility) return false
  if (search.company && job.companySlug !== search.company) return false
  if (search.q) {
    const q = search.q.toLowerCase()
    if (!`${job.title} ${job.company} ${job.locationText}`.toLowerCase().includes(q)) return false
  }
  return true
}

const DAY_MS = 24 * 60 * 60 * 1000

function JobsPage() {
  const { jobs, lastRun, sync } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [busy, setBusy] = useState<'sync' | 'run' | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null)
  const status = notice ?? sync

  async function onSync() {
    setBusy('sync')
    try {
      setNotice(await syncNow())
      await router.invalidate() // re-runs the loader to show the synced jobs
    } finally {
      setBusy(null)
    }
  }

  async function onRunNow() {
    setBusy('run')
    try {
      setNotice(await runNow({ data: { fullResend: false } }))
    } finally {
      setBusy(null)
    }
  }

  // "New" = first seen within a day of the latest run.
  const newSince = lastRun ? new Date(lastRun.at).getTime() - DAY_MS : Infinity

  const setSearch = (patch: Partial<JobsSearch>) => {
    // navigate() returns a promise; filter changes don't need to wait for it.
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  }

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
  const visible = useMemo(() => jobs.filter((j) => matches(j, search)), [jobs, search])
  const filtered = Boolean(search.eligibility || search.company || search.q)

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 text-zinc-900 dark:text-zinc-100">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">
            <Link to="/" className="hover:underline">
              Lantern
            </Link>{' '}
            / Jobs
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
          {lastRun && (
            <p className="mt-1 text-sm text-zinc-500">
              Last run {formatDate(lastRun.at)}
              {lastRun.totals &&
                ` · ${lastRun.totals.ok}/${lastRun.totals.companies} companies · ${lastRun.totals.fetched} fetched · ${lastRun.totals.kept} kept`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link to="/runs" className="text-sm text-zinc-500 hover:underline">
            Runs
          </Link>
          <button
            type="button"
            onClick={() => void onRunNow()}
            disabled={busy !== null}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {busy === 'run' ? 'Starting…' : 'Run now'}
          </button>
          <button
            type="button"
            onClick={() => void onSync()}
            disabled={busy !== null}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {busy === 'sync' ? 'Syncing…' : 'Sync'}
          </button>
        </div>
      </header>

      <output
        className={`mb-4 block text-sm ${status.ok ? 'text-zinc-500' : 'text-red-700 dark:text-red-400'}`}
      >
        {status.message}
      </output>

      {jobs.length === 0 && !lastRun ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <p className="font-medium">No jobs yet</p>
          <p className="mt-2 text-sm text-zinc-500">
            Set <code>LANTERN_RUNNER_REPO</code> in <code>.env</code> and press Sync, or load a
            local ingest:
          </p>
          <pre className="mt-3 inline-block rounded bg-zinc-100 px-3 py-2 text-left text-sm dark:bg-zinc-800">
            pnpm cli ingest --config ../lantern-runner/config --out out/{'\n'}pnpm sync --from out/
          </pre>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <input
              type="search"
              aria-label="Search jobs"
              placeholder="Search title, company, location"
              defaultValue={search.q ?? ''}
              onChange={(e) => setSearch({ q: e.target.value || undefined })}
              className="min-w-64 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <select
              aria-label="Filter by location"
              value={search.eligibility ?? ''}
              onChange={(e) =>
                setSearch({ eligibility: EligibilitySchema.safeParse(e.target.value).data })
              }
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">All companies</option>
              {companies.map(([slug, name]) => (
                <option key={slug} value={slug}>
                  {name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 self-center text-sm text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={search.closed ?? false}
                onChange={(e) => setSearch({ closed: e.target.checked || undefined })}
              />
              Show closed
            </label>
            {filtered && (
              <Link
                to="/jobs"
                search={{}}
                className="self-center text-sm text-zinc-500 hover:underline"
              >
                Clear filters
              </Link>
            )}
          </div>

          <p className="mb-2 text-sm text-zinc-500">
            {visible.length} of {jobs.length} jobs
          </p>

          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {visible.map((job) => (
              <li key={job.id}>
                <details className="group">
                  {/* The summary's label is the job title and company inside it; the rule
                      only looks at direct text. */}
                  {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label */}
                  <summary className="grid cursor-pointer list-none gap-x-4 gap-y-1 px-4 py-3 hover:bg-zinc-50 sm:grid-cols-[1fr_auto] dark:hover:bg-zinc-900">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {job.title}
                        {new Date(job.firstSeenAt).getTime() >= newSince && !job.closedAt && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                            New
                          </span>
                        )}
                        {job.closedAt && (
                          <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 align-middle text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                            Closed {formatDate(job.closedAt)}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-sm text-zinc-500">
                        {job.company} · {job.locationText || 'No location'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm sm:justify-end">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${ELIGIBILITY_STYLE[job.eligibility]}`}
                      >
                        {ELIGIBILITY_LABEL[job.eligibility]}
                      </span>
                      <span className="text-zinc-600 tabular-nums dark:text-zinc-400">
                        {formatSalary(job.salary)}
                      </span>
                      <span className="w-24 text-right text-zinc-500 tabular-nums">
                        {formatDate(job.postedAt)}
                      </span>
                    </div>
                  </summary>
                  <div className="border-t border-zinc-100 bg-zinc-50/60 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/40">
                    <div className="mb-3 flex gap-4 text-sm">
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-sky-700 hover:underline dark:text-sky-400"
                      >
                        View posting ↗
                      </a>
                      {job.applyUrl && job.applyUrl !== job.url && (
                        <a
                          href={job.applyUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-700 hover:underline dark:text-sky-400"
                        >
                          Apply ↗
                        </a>
                      )}
                      <span className="text-zinc-500">
                        via {job.source} · first seen {formatDate(job.firstSeenAt)}
                      </span>
                    </div>
                    <p className="max-h-96 overflow-y-auto text-sm leading-relaxed whitespace-pre-line text-zinc-700 dark:text-zinc-300">
                      {job.descriptionText}
                    </p>
                  </div>
                </details>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-zinc-500">
                No jobs match these filters.
              </li>
            )}
          </ul>
        </>
      )}
    </main>
  )
}
