import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import {
  Badge,
  Button,
  Callout,
  Notice,
  PageHeader,
  SectionTitle,
  tableClass,
  tableWrap,
  tbodyClass,
  tdClass,
  theadClass,
  thClass,
  type BadgeTone,
} from '#/components/ui'
import { getRuns, runNow } from '#/server/runs'

export const Route = createFileRoute('/runs')({
  loader: () => getRuns(),
  head: () => ({ meta: [{ title: 'Runs · Lantern' }] }),
  component: RunsPage,
})

const OUTCOME: Record<string, { label: string; tone: BadgeTone }> = {
  synced: { label: 'Synced', tone: 'green' },
  no_artifact: { label: 'Dry run', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'red' },
  superseded: { label: 'Skipped (older)', tone: 'neutral' },
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
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Runs"
        subtitle={repo ? `From ${repo}` : undefined}
        actions={
          <Button onClick={fullResend} disabled={busy}>
            {busy ? 'Working…' : 'Full resend'}
          </Button>
        }
      />

      {notice && (
        <div className="mb-4">
          <Notice ok={notice.ok}>
            {notice.message}{' '}
            {notice.url && (
              <a href={notice.url} target="_blank" rel="noreferrer" className="underline">
                Watch it on GitHub ↗
              </a>
            )}
          </Notice>
        </div>
      )}
      {hasGap && (
        <Callout tone="warning">
          Some results were missed (an expired run, or jobs listed that aren't here). A full resend
          fixes it.
        </Callout>
      )}

      <section className="mb-10">
        <SectionTitle>History</SectionTitle>
        <div className={tableWrap}>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>Run</th>
                <th className={thClass}>Result</th>
                <th className={`${thClass} text-right`}>New</th>
                <th className={`${thClass} text-right`}>Updated</th>
                <th className={`${thClass} text-right`}>Closed</th>
                <th className={`${thClass} text-right`}>Reopened</th>
                <th className={`${thClass} text-right`}>Missing</th>
              </tr>
            </thead>
            <tbody className={tbodyClass}>
              {runs.map((r) => {
                const outcome = OUTCOME[r.outcome]
                return (
                  <tr key={r.runId}>
                    <td className={`${tdClass} whitespace-nowrap`}>
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
                    <td className={tdClass}>
                      <Badge tone={outcome?.tone ?? 'neutral'}>{outcome?.label ?? r.outcome}</Badge>
                    </td>
                    <td className={`${tdClass} text-right`}>{r.inserted}</td>
                    <td className={`${tdClass} text-right`}>{r.updated}</td>
                    <td className={`${tdClass} text-right`}>{r.closed}</td>
                    <td className={`${tdClass} text-right`}>{r.reopened}</td>
                    <td
                      className={`${tdClass} text-right ${r.missing > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : ''}`}
                    >
                      {r.missing}
                    </td>
                  </tr>
                )
              })}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted">
                    No runs synced yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionTitle>Companies</SectionTitle>
        <div className={tableWrap}>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>Company</th>
                <th className={thClass}>Board</th>
                <th className={thClass}>Last run</th>
                <th className={`${thClass} text-right`}>Fetched</th>
                <th className={`${thClass} text-right`}>Kept</th>
                <th className={thClass}>Problem</th>
              </tr>
            </thead>
            <tbody className={tbodyClass}>
              {companies.map((c) => {
                const label =
                  c.lastStatus === 'ok' ? (c.lastComplete ? 'OK' : 'Partial') : c.lastStatus
                const tone: BadgeTone =
                  label === 'OK' ? 'green' : label === 'Partial' ? 'warning' : 'red'
                return (
                  <tr key={c.slug}>
                    <td className={tdClass}>{c.name}</td>
                    <td className={`${tdClass} text-muted`}>{c.ats}</td>
                    <td className={tdClass}>
                      <Badge tone={tone}>{label}</Badge>
                    </td>
                    <td className={`${tdClass} text-right`}>{c.lastFetched}</td>
                    <td className={`${tdClass} text-right`}>{c.lastKept}</td>
                    <td className={`${tdClass} max-w-md truncate text-red-700 dark:text-red-400`}>
                      {c.lastError ?? ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
