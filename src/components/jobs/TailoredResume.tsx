import { useEffect, useRef, useState } from 'react'

import {
  getTailoring,
  setTailoringDecision,
  tailorJob,
  type TailoringData,
  type TailoringView,
} from '#/server/tailor'
import type { Change } from '#/tailor/changes'

import { Badge, buttonClass } from '../ui'
import { formatDate } from './format'

/** A change is used unless you reverted it. */
const isUsed = (decisions: Record<string, boolean>, key: string) =>
  !Object.hasOwn(decisions, key) || decisions[key]

/** Loads and drives one job's tailored resume. Mount it per job (JobDetail is keyed by job). */
export function useTailoring(jobId: string) {
  const [data, setData] = useState<TailoringData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void getTailoring({ data: { jobId } }).then((d) => {
      if (live) setData(d)
    })
    return () => {
      live = false
    }
  }, [jobId])

  // A tailoring started elsewhere (another tab, the CLI): check back until it's done.
  const runningElsewhere = Boolean(data?.running) && !busy
  useEffect(() => {
    const timer = runningElsewhere
      ? setInterval(() => {
          void getTailoring({ data: { jobId } }).then(setData)
        }, 5000)
      : undefined
    return () => clearInterval(timer)
  }, [runningElsewhere, jobId])

  return {
    data,
    busy: busy || Boolean(data?.running),
    error,
    async tailor() {
      setBusy(true)
      setError(null)
      try {
        const r = await tailorJob({ data: { jobId } })
        setData(r.data)
        if (!r.ok) setError(r.message)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    async showVersion(id: number) {
      setData(await getTailoring({ data: { jobId, id } }))
    },
    async decide(id: number, change: string, accepted: boolean) {
      const d = await setTailoringDecision({ data: { id, change, accepted } })
      if (d) setData(d)
    },
  }
}

export type Tailoring = ReturnType<typeof useTailoring>

/** The rendered resume, scaled to fit the pane. Sandboxed: no scripts, no shared styles. */
function Preview({ html, title }: { html: string; title: string }) {
  const PAGE = 860 // the resume's own width (8.5in) plus its margin
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [scale, setScale] = useState(1)
  const [height, setHeight] = useState(1100)

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / PAGE))
    })
    if (box.current) observer.observe(box.current)
    return () => observer.disconnect()
  }, [])

  function measure() {
    const doc = frame.current?.contentDocument
    if (doc) setHeight(doc.documentElement.scrollHeight)
  }

  return (
    <div
      ref={box}
      className="overflow-hidden rounded-lg border border-line bg-[#c9ccd3]"
      style={{ height: height * scale }}
    >
      <iframe
        ref={frame}
        title={title}
        srcDoc={html}
        // allow-same-origin (without allow-scripts) only lets us measure the page's height.
        sandbox="allow-same-origin"
        onLoad={measure}
        className="origin-top-left border-0"
        style={{ width: PAGE, height, transform: `scale(${scale})` }}
      />
    </div>
  )
}

function ChangeBody({
  change,
  bulletText,
}: {
  change: Change
  bulletText: Record<string, string>
}) {
  if (change.kind === 'summary' || change.kind === 'reword') {
    return (
      <div className="grid gap-1.5 text-sm">
        <p className="text-muted line-through decoration-muted/40">{change.before}</p>
        <p>{change.after}</p>
      </div>
    )
  }
  if (change.kind === 'skills') {
    const left = change.before.filter((s) => !change.after.includes(s))
    return (
      <div className="text-sm">
        <p>{change.after.join(', ')}</p>
        {left.length > 0 && <p className="mt-1 text-muted">Left out: {left.join(', ')}</p>}
      </div>
    )
  }
  return (
    <div className="text-sm">
      <p className="text-muted">
        Keeps {change.after.length} of {change.before.length} bullets
        {change.after.join() !== change.before.filter((b) => change.after.includes(b)).join()
          ? ', reordered'
          : ''}
        .
      </p>
      {change.dropped.length > 0 && (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
          {change.dropped.map((id) => (
            <li key={id}>
              <span className="line-through decoration-muted/40">{bulletText[id] ?? id}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function changeTitle(c: Change): string {
  if (c.kind === 'summary') return 'Summary'
  if (c.kind === 'skills') return `Skills · ${c.group}`
  if (c.kind === 'bullets') return `${c.title}, ${c.employer} · which bullets`
  return 'Reworded bullet'
}

function Changes({
  view,
  onDecide,
}: {
  view: TailoringView
  onDecide: (key: string, accepted: boolean) => void
}) {
  const notes = (key: string) => [
    ...view.errors
      .filter((e) => e.key === key)
      .map((e) => ({ tone: 'red' as const, message: e.message })),
    ...view.warnings
      .filter((w) => w.key === key)
      .map((w) => ({ tone: 'warning' as const, message: w.message })),
  ]
  if (view.changes.length === 0) {
    return <p className="text-sm text-muted">No changes: your resume already fits this posting.</p>
  }
  return (
    <ul className="space-y-2">
      {view.changes.map((c) => {
        const accepted = isUsed(view.decisions, c.key)
        return (
          <li
            key={c.key}
            className={`rounded-lg border border-line bg-surface p-3 ${accepted ? '' : 'opacity-60'}`}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <p className="text-xs font-medium tracking-wide text-muted uppercase">
                {changeTitle(c)}
              </p>
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  className="accent-accent-600"
                  checked={accepted}
                  onChange={(e) => onDecide(c.key, e.target.checked)}
                />
                Use
              </label>
            </div>
            <ChangeBody change={c} bulletText={view.bulletText} />
            {notes(c.key).map((n) => (
              <p key={n.message} className="mt-2">
                <Badge tone={n.tone}>{n.message}</Badge>
              </p>
            ))}
          </li>
        )
      })}
    </ul>
  )
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <h4 className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">{title}</h4>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  )
}

/** The Tailored resume section of the job detail pane. */
export function TailoredResume({
  tailoring,
  appliedResumeId,
}: {
  tailoring: Tailoring
  appliedResumeId: number | null
}) {
  const { data, busy, error } = tailoring
  if (!data) return null
  const view = data.current
  if (!view) {
    if (!error && data.resume.ok && !busy) return null
    return (
      <section className="mt-6 text-sm">
        {busy && <p className="text-muted">Tailoring your resume… this takes about a minute.</p>}
        {error && <p className="text-red-700 dark:text-red-400">{error}</p>}
        {!data.resume.ok && <p className="text-red-700 dark:text-red-400">{data.resume.message}</p>}
      </section>
    )
  }

  // Issues not shown on a change card: ones without a key, and ones whose change was undone
  // by the checks themselves (e.g. a reworded bullet reverted for an invented number).
  const shown = new Set(view.changes.map((c) => c.key))
  const general = [...view.errors, ...view.warnings]
    .filter((i) => !i.key || !shown.has(i.key))
    .map((i) => i.message)
  const appliedWith = data.versions.find((v) => v.id === appliedResumeId)

  return (
    <section aria-labelledby="tailored" className="@container mt-8 border-t border-line pt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="tailored" className="flex flex-wrap items-center gap-2 text-base font-semibold">
          Tailored resume
          {(view.stale.job || view.stale.resume) && (
            <Badge tone="warning">
              {view.stale.job ? 'Posting changed since' : 'resume.json changed since'}
            </Badge>
          )}
          {appliedWith && <Badge tone="blue">Applied with v{appliedWith.version}</Badge>}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {data.versions.length > 1 && (
            <select
              aria-label="Version"
              value={view.id}
              onChange={(e) => void tailoring.showVersion(Number(e.target.value))}
              className="select h-7 rounded-md border border-line bg-surface pl-2 text-xs"
            >
              {data.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} · {formatDate(v.createdAt)}
                </option>
              ))}
            </select>
          )}
          <a
            href={`/print/resume/${view.id}`}
            target="_blank"
            rel="noreferrer"
            className={buttonClass('secondary', 'sm')}
          >
            Open ↗
          </a>
          <a
            href={`/print/resume/${view.id}?download=1`}
            download={view.fileName}
            className={buttonClass('secondary', 'sm')}
          >
            Download HTML
          </a>
        </div>
      </div>

      {busy && <p className="mb-3 text-sm text-muted">Tailoring a new version… about a minute.</p>}
      {error && <p className="mb-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
      {general.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm text-red-700 dark:text-red-400">
          {general.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      <div className="mb-5 grid gap-4 rounded-lg bg-sunken p-4 @xl:grid-cols-3">
        <List title="You match" items={view.fitNotes.matches} />
        <List title="Gaps" items={view.fitNotes.gaps} />
        <List title="Interview topics" items={view.fitNotes.interviewTopics} />
      </div>

      <h4 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
        Changes ({view.changes.filter((c) => isUsed(view.decisions, c.key)).length} of{' '}
        {view.changes.length} used)
      </h4>
      <Changes
        view={view}
        onDecide={(key, accepted) => void tailoring.decide(view.id, key, accepted)}
      />

      <h4 className="mt-6 mb-2 text-xs font-medium tracking-wide text-muted uppercase">Preview</h4>
      <Preview key={view.id} html={view.html} title={`Tailored resume v${view.version}`} />
      <p className="mt-2 text-xs text-muted">
        Open it to print to PDF (⌘P). v{view.version} · {formatDate(view.createdAt)} · {view.model}
      </p>
    </section>
  )
}
