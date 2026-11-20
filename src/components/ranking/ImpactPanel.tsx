import { useEffect, useRef, useState } from 'react'

import { Notice, SectionTitle } from '#/components/ui'
import { previewRankingFn, type RankingPreview } from '#/server/config-editor'

// How the draft criteria would rank the open jobs, compared with the saved ones. Asks the server
// ~400ms after the draft stops changing; replies to older drafts are ignored.

type PreviewReply = Awaited<ReturnType<typeof previewRankingFn>>
type PreviewState = { for: string } & ({ reply: PreviewReply } | { error: string })
type Row = RankingPreview['top'][number]

const UP = 'text-emerald-700 dark:text-emerald-400'
const DOWN = 'text-red-700 dark:text-red-400'

function useRankingPreview(json: string | null) {
  const [state, setState] = useState<PreviewState | null>(null)
  const latest = useRef(0)

  useEffect(() => {
    if (json === null) return undefined
    const request = ++latest.current
    const timer = setTimeout(() => {
      const value: unknown = JSON.parse(json)
      void previewRankingFn({ data: { value } }).then(
        (reply) => {
          if (latest.current === request) setState({ for: json, reply })
        },
        (err: unknown) => {
          if (latest.current === request) {
            setState({ for: json, error: err instanceof Error ? err.message : String(err) })
          }
        },
      )
    }, 400)
    return () => clearTimeout(timer)
  }, [json])

  return { state, pending: json !== null && state?.for !== json }
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

function IssueList({ issues }: { issues: string[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-red-700 dark:text-red-400">
      {issues.map((issue) => (
        <li key={issue}>{issue}</li>
      ))}
    </ul>
  )
}

function PreviewRow({ row }: { row: Row }) {
  const rankDelta = row.rankBefore === null ? 0 : row.rankBefore - row.rank
  const scoreChanged = row.before !== null && row.before !== row.score
  return (
    <li className="flex gap-3 py-2 text-sm">
      <div className="w-8 shrink-0 text-right tabular-nums">
        <div className="text-muted">{row.rank}</div>
        {rankDelta !== 0 && (
          <div className={`text-xs ${rankDelta > 0 ? UP : DOWN}`} title={`Was #${row.rankBefore}`}>
            {rankDelta > 0 ? '↑' : '↓'}
            {Math.abs(rankDelta)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 flex-1 truncate" title={`${row.title} · ${row.company}`}>
            <span className="font-medium">{row.title}</span>
            <span className="text-muted"> · {row.company}</span>
          </p>
          <p className="shrink-0 tabular-nums">
            {scoreChanged && row.before !== null && (
              <span className="text-xs text-muted">
                <span className={row.score > row.before ? UP : DOWN}>
                  {row.score > row.before ? '↑' : '↓'}
                </span>{' '}
                was {row.before}{' '}
              </span>
            )}
            <span className="font-semibold">{row.score}</span>
          </p>
        </div>
        {row.dealbreaker && (
          <p className={`text-xs font-medium ${DOWN}`}>Dealbreaker: {row.dealbreaker}</p>
        )}
        {row.reasons.length > 0 && (
          <p className="text-xs text-muted">
            {row.reasons.map((r) => `${r.label} ${signed(r.points)}`).join(' · ')}
          </p>
        )}
      </div>
    </li>
  )
}

function Summary({ preview }: { preview: RankingPreview }) {
  const { moved, total, dealbreakers, dealbreakersBefore } = preview
  const dealbreakerDelta = dealbreakersBefore === null ? 0 : dealbreakers - dealbreakersBefore
  return (
    <dl className="grid grid-cols-2 gap-2 text-sm">
      <div className="rounded-lg bg-sunken px-3 py-2">
        <dt className="text-xs text-muted">Jobs that change position</dt>
        <dd className="font-semibold tabular-nums">
          {dealbreakersBefore === null ? `— of ${total}` : `${moved} of ${total}`}
        </dd>
      </div>
      <div className="rounded-lg bg-sunken px-3 py-2">
        <dt className="text-xs text-muted">Dealbreakers</dt>
        <dd className="font-semibold tabular-nums">
          {dealbreakers}
          {dealbreakerDelta !== 0 && (
            <span className={`ml-1 text-xs font-medium ${dealbreakerDelta > 0 ? DOWN : UP}`}>
              ({signed(dealbreakerDelta)})
            </span>
          )}
        </dd>
      </div>
    </dl>
  )
}

function PreviewBody({ preview }: { preview: RankingPreview }) {
  if (preview.total === 0) {
    return <p className="text-sm text-muted">No open jobs yet. Sync to see how these rank them.</p>
  }
  return (
    <>
      {preview.dealbreakersBefore === null && (
        <p className="mb-3 text-sm text-muted">No saved criteria to compare with yet.</p>
      )}
      <Summary preview={preview} />
      <h3 className="mt-4 text-xs font-medium tracking-wide text-muted uppercase">
        Top {preview.top.length}
      </h3>
      <ol className="divide-y divide-line">
        {preview.top.map((row) => (
          <PreviewRow key={row.id} row={row} />
        ))}
      </ol>
    </>
  )
}

/** `json` is the valid draft as JSON, or null while `issues` lists what's wrong with it. */
export function ImpactPanel({ json, issues }: { json: string | null; issues: string[] }) {
  const { state, pending } = useRankingPreview(json)

  let body
  if (json === null) {
    body = (
      <>
        <p className="text-sm text-muted">Fix these to see how jobs would rank:</p>
        <IssueList issues={issues} />
      </>
    )
  } else if (!state) {
    body = <p className="text-sm text-muted">Working out the ranking…</p>
  } else if ('error' in state) {
    body = <Notice ok={false}>Couldn’t preview the ranking: {state.error}</Notice>
  } else if (!state.reply.ok) {
    body = <IssueList issues={state.reply.issues} />
  } else {
    body = <PreviewBody preview={state.reply.preview} />
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <SectionTitle
        actions={pending && state ? <span className="text-xs text-muted">Updating…</span> : null}
      >
        Impact
      </SectionTitle>
      <div className={`transition-opacity ${pending && state ? 'opacity-60' : ''}`}>{body}</div>
    </div>
  )
}
