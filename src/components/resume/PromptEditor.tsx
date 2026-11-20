import { useBlocker } from '@tanstack/react-router'
import { useId, useState } from 'react'

import { getPromptForEdit, savePromptFn, tryPromptFn, type TryResult } from '#/server/config-editor'

import { ChangeBody, changeTitle } from '../jobs/TailoredResume'
import { ResumePreview } from '../ResumePreview'
import { Badge, Button, Callout, Notice, PageHeader, selectClass } from '../ui'
import { ResumeTabs } from './ResumeTabs'

export interface PromptLoaded {
  value: string
  version: string | null
  where: string
  builtIn: string
}

type Job = { id: string; title: string; company: string; score: number | null }

const norm = (s: string) => s.trim()

/** Edits config/tailoring-prompt.md, with a "Try it" run that saves nothing. */
export function PromptEditor({
  loaded,
  jobs,
  onReload,
}: {
  loaded: PromptLoaded
  jobs: Job[]
  onReload: (l: PromptLoaded) => void
}) {
  const textId = useId()
  const [text, setText] = useState(loaded.value)
  const [saved, setSaved] = useState(loaded.value)
  const [version, setVersion] = useState(loaded.version)
  const [busy, setBusy] = useState<'save' | 'try' | null>(null)
  const [result, setResult] = useState<{ ok: boolean; conflict?: boolean; message: string } | null>(
    null,
  )
  const [jobId, setJobId] = useState(jobs[0]?.id ?? '')
  const [tried, setTried] = useState<(TryResult & { jobLabel: string }) | null>(null)

  const dirty = norm(text) !== norm(saved)
  const isBuiltIn = norm(text) === norm(loaded.builtIn)

  useBlocker({
    shouldBlockFn: () =>
      dirty && !window.confirm('Discard unsaved changes to your tailoring prompt?'),
    enableBeforeUnload: () => dirty,
  })

  async function save() {
    setBusy('save')
    try {
      const r = await savePromptFn({ data: { text, version } })
      if (r.ok) {
        setSaved(text)
        setVersion(r.version)
      }
      setResult(r)
    } finally {
      setBusy(null)
    }
  }

  async function reload() {
    const r = await getPromptForEdit()
    if (r.ok) onReload({ value: r.value, version: r.version, where: r.where, builtIn: r.builtIn })
    else setResult({ ok: false, message: r.message })
  }

  async function tryIt() {
    const job = jobs.find((j) => j.id === jobId)
    if (!job || !text.trim()) return
    setBusy('try')
    setTried(null)
    try {
      const r = await tryPromptFn({ data: { jobId, text } })
      setTried({ ...r, jobLabel: `${job.title} · ${job.company}` })
    } catch (err) {
      setTried({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        jobLabel: `${job.title} · ${job.company}`,
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Resume"
        subtitle={<>The instructions Claude follows when tailoring · saved to {loaded.where}</>}
        actions={
          <>
            {dirty && (
              <Button variant="ghost" disabled={busy !== null} onClick={() => setText(saved)}>
                Discard changes
              </Button>
            )}
            <Button
              variant="primary"
              disabled={(!dirty && version !== null) || !text.trim() || busy !== null}
              onClick={() => void save()}
            >
              {busy === 'save' ? 'Saving…' : dirty || version === null ? 'Save' : 'Saved'}
            </Button>
          </>
        }
      />
      <ResumeTabs />

      {result?.conflict && (
        <Callout tone="warning">
          {result.message}{' '}
          <Button size="sm" onClick={() => void reload()}>
            Reload
          </Button>
        </Callout>
      )}
      {result && !result.conflict && (
        <div className="mb-4">
          <Notice ok={result.ok}>{result.message}</Notice>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {isBuiltIn ? <Badge>Built-in prompt</Badge> : <Badge tone="accent">Your prompt</Badge>}
            {version === null && !dirty && (
              <span className="text-muted">Not saved yet: tailoring uses the built-in prompt.</span>
            )}
            {dirty && <Badge tone="warning">Unsaved changes</Badge>}
            <span className="ml-auto text-xs text-muted tabular-nums">
              {text.trim().length.toLocaleString()} / 20,000
            </span>
          </div>
          <label htmlFor={textId} className="sr-only">
            Tailoring prompt
          </label>
          <textarea
            id={textId}
            value={text}
            spellCheck
            onChange={(e) => {
              setResult(null)
              setText(e.target.value)
            }}
            className="[field-sizing:content] min-h-[28rem] w-full rounded-lg border border-line bg-surface p-3 font-mono text-[13px] leading-relaxed text-ink focus:border-accent-500 focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={isBuiltIn} onClick={() => setText(loaded.builtIn)}>
              Reset to built-in
            </Button>
            <p className="text-xs text-muted">
              Whatever this says, every reply is still checked against your resume: invented
              numbers, skills or bullets are dropped or reverted.
            </p>
          </div>
          <details className="rounded-lg border border-line bg-surface p-3 text-sm">
            <summary className="cursor-pointer font-medium">What else Claude receives</summary>
            <p className="mt-2 text-muted">
              With this prompt, each tailoring sends your <code>resume.json</code> inside{' '}
              <code>&lt;resume&gt;</code> tags and the posting (title, company, location, salary,
              description) inside <code>&lt;posting&gt;</code> tags, and requires the reply in a
              fixed shape: summary, skill order, bullets by id, and fit notes. Those parts are set
              by Lantern; Try it shows the exact request.
            </p>
          </details>
        </section>

        <aside aria-label="Try it" className="min-w-0 space-y-3 xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-xl border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold">Try it</h2>
            <p className="mt-1 text-xs text-muted">
              Tailors one job with the prompt as it is now, saved or not. Takes about 25 seconds and
              uses your Claude plan. Nothing is saved.
            </p>
            <div className="mt-3 flex gap-2">
              <select
                aria-label="Job to try"
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className={`min-w-0 flex-1 ${selectClass}`}
              >
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.score !== null ? `${j.score} · ` : ''}
                    {j.title} · {j.company}
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                disabled={!jobId || !text.trim() || busy !== null}
                onClick={() => void tryIt()}
              >
                {busy === 'try' ? 'Trying…' : 'Try it'}
              </Button>
            </div>
            {busy === 'try' && (
              <p className="mt-3 text-sm text-muted">Tailoring… about 25 seconds.</p>
            )}
          </div>

          {tried && <TryResultView tried={tried} />}
        </aside>
      </div>
    </div>
  )
}

function TryResultView({ tried }: { tried: TryResult & { jobLabel: string } }) {
  const r = tried.result
  if (!tried.ok || !r) {
    return (
      <Callout tone="error">
        {tried.jobLabel}: {tried.message}
      </Callout>
    )
  }
  const notes = (key: string) => [
    ...r.errors.filter((e) => e.key === key).map((e) => ({ tone: 'red' as const, m: e.message })),
    ...r.warnings
      .filter((w) => w.key === key)
      .map((w) => ({ tone: 'warning' as const, m: w.message })),
  ]
  const shown = new Set(r.changes.map((c) => c.key))
  const other = [...r.errors, ...r.warnings].filter((i) => !i.key || !shown.has(i.key))

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <p className="text-sm">
        <span className="font-medium">{tried.jobLabel}</span>
        <span className="text-muted">
          {' '}
          · {r.seconds} s · {r.model}
          {r.tokens &&
            ` · ${r.tokens.input.toLocaleString()} in / ${r.tokens.output.toLocaleString()} out`}
        </span>
      </p>
      {other.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-red-700 dark:text-red-400">
          {other.map((i) => (
            <li key={i.message}>{i.message}</li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 rounded-lg bg-sunken p-3 text-sm">
        {(
          [
            ['You match', r.fitNotes.matches],
            ['Gaps', r.fitNotes.gaps],
            ['Interview topics', r.fitNotes.interviewTopics],
          ] as const
        ).map(([title, items]) => (
          <div key={title}>
            <h3 className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">{title}</h3>
            <ul className="list-disc space-y-0.5 pl-5">
              {items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
        Changes ({r.changes.length})
      </h3>
      <ul className="space-y-2">
        {r.changes.map((c) => (
          <li key={c.key} className="rounded-lg border border-line p-3">
            <p className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
              {changeTitle(c)}
            </p>
            <ChangeBody change={c} bulletText={r.bulletText} />
            {notes(c.key).map((n) => (
              <p key={n.m} className="mt-2">
                <Badge tone={n.tone}>{n.m}</Badge>
              </p>
            ))}
          </li>
        ))}
      </ul>
      <ResumePreview html={r.html} title="Tried resume" />
      {tried.request && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Show the request that was sent</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-sunken p-3 text-xs whitespace-pre-wrap">
            {tried.request}
          </pre>
        </details>
      )}
    </div>
  )
}
