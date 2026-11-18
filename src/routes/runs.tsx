import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { syncNow } from '#/server/jobs'
import { getRuns, runNow } from '#/server/runs'

export const Route = createFileRoute('/runs')({
  loader: () => getRuns(),
  head: () => ({ meta: [{ title: 'Runs · Lantern' }] }),
  component: RunsPage,
})

const OUTCOME_LABEL: Record<string, string> = {
  synced: 'Synced',
  no_artifact: 'Dry run',
  expired: 'Expired',
  superseded: 'Skipped (older)',
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function RunsPage() {
  const { runs, companies, repo } = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; message: string; url?: string } | null>(null)

  async function act(fn: () => Promise<{ ok: boolean; message: string; url?: string }>) {
    setBusy(true)
    try {
      setNotice(await fn())
      await router.invalidate()
    } finally {
      setBusy(false)
    }
  }

  const fullResend = () => {
    // A deliberate, rarer action: it re-sends every kept job.
    if (!window.confirm('Start a full resend? The next sync re-applies every open job.')) return
    void act(() => runNow({ data: { fullResend: true } }))
  }

  const hasGap = runs.some((r) => r.outcome === 'expired' || r.missing > 0)

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 text-zinc-900 dark:text-zinc-100">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">
            <Link to="/" className="hover:underline">
              Lantern
            </Link>{' '}
            /{' '}
            <Link to="/jobs" className="hover:underline">
              Jobs
            </Link>{' '}
            / Runs
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Runs</h1>
          {repo && <p className="mt-1 text-sm text-zinc-500">From {repo}</p>}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={fullResend}
            disabled={busy}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Full resend
          </button>
          <button
            type="button"
            onClick={() => void act(() => syncNow())}
            disabled={busy}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {busy ? 'Working…' : 'Sync'}
          </button>
        </div>
      </header>

      {notice && (
        <output
          className={`mb-4 block text-sm ${notice.ok ? 'text-zinc-500' : 'text-red-700 dark:text-red-400'}`}
        >
          {notice.message}{' '}
          {notice.url && (
            <a href={notice.url} target="_blank" rel="noreferrer" className="underline">
              Watch it on GitHub ↗
            </a>
          )}
        </output>
      )}
      {hasGap && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
          Some results were missed (an expired run, or jobs listed that aren't here). A full resend
          fixes it.
        </p>
      )}

      <section className="mb-10">
        <h2 className="mb-2 text-lg font-semibold">History</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">Run</th>
                <th className="px-3 py-2 font-medium">Result</th>
                <th className="px-3 py-2 text-right font-medium">New</th>
                <th className="px-3 py-2 text-right font-medium">Updated</th>
                <th className="px-3 py-2 text-right font-medium">Closed</th>
                <th className="px-3 py-2 text-right font-medium">Reopened</th>
                <th className="px-3 py-2 text-right font-medium">Missing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 tabular-nums dark:divide-zinc-800">
              {runs.map((r) => (
                <tr key={r.runId}>
                  <td className="px-3 py-2">
                    {repo && /^\d+$/.test(r.runId) ? (
                      <a
                        href={`https://github.com/${repo}/actions/runs/${r.runId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {formatTime(r.runCreatedAt)}
                      </a>
                    ) : (
                      formatTime(r.runCreatedAt)
                    )}
                  </td>
                  <td className="px-3 py-2">{OUTCOME_LABEL[r.outcome] ?? r.outcome}</td>
                  <td className="px-3 py-2 text-right">{r.inserted}</td>
                  <td className="px-3 py-2 text-right">{r.updated}</td>
                  <td className="px-3 py-2 text-right">{r.closed}</td>
                  <td className="px-3 py-2 text-right">{r.reopened}</td>
                  <td
                    className={`px-3 py-2 text-right ${r.missing ? 'font-medium text-amber-700' : ''}`}
                  >
                    {r.missing}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                    No runs synced yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Companies</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Board</th>
                <th className="px-3 py-2 font-medium">Last run</th>
                <th className="px-3 py-2 text-right font-medium">Fetched</th>
                <th className="px-3 py-2 text-right font-medium">Kept</th>
                <th className="px-3 py-2 font-medium">Problem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 tabular-nums dark:divide-zinc-800">
              {companies.map((c) => (
                <tr key={c.slug}>
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2 text-zinc-500">{c.ats}</td>
                  <td className="px-3 py-2">
                    {c.lastStatus === 'ok' ? (c.lastComplete ? 'OK' : 'Partial') : c.lastStatus}
                  </td>
                  <td className="px-3 py-2 text-right">{c.lastFetched}</td>
                  <td className="px-3 py-2 text-right">{c.lastKept}</td>
                  <td className="max-w-md truncate px-3 py-2 text-red-700 dark:text-red-400">
                    {c.lastError ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
