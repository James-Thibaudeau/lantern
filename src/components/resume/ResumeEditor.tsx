import { useBlocker } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import { getResumeForEdit, saveResumeFn } from '#/server/config-editor'
import { idsIn } from '#/tailor/ids'
import { renderResume } from '#/tailor/render'
import { ResumeSchema, type Resume } from '#/tailor/resume'

import { ResumePreview } from '../ResumePreview'
import { Button, Callout, Notice, PageHeader } from '../ui'
import { ExperienceSection } from './experience'
import { ResumeTabs } from './ResumeTabs'
import {
  BasicsSection,
  EducationSection,
  PatentsSection,
  SkillsSection,
  SummarySection,
  type Edit,
} from './sections'

interface Loaded {
  value: Resume
  version: string | null
  where: string
}

const same = (a: Resume, b: Resume) => JSON.stringify(a) === JSON.stringify(b)

/** The whole editor. Remount it (key) to start over from freshly loaded data. */
export function ResumeEditor({
  loaded,
  onReload,
}: {
  loaded: Loaded
  onReload: (l: Loaded) => void
}) {
  const [draft, setDraft] = useState(loaded.value)
  const [saved, setSaved] = useState(loaded.value)
  const [version, setVersion] = useState(loaded.version)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    ok: boolean
    conflict?: boolean
    message: string
    issues?: string[]
  } | null>(null)
  // Every id this resume has had while open, so new ones never reuse a deleted one. A mutable
  // set that's only read when adding a job or bullet, never for rendering.
  const [taken] = useState(() => idsIn(loaded.value))

  const edit: Edit = (change) => {
    setResult(null)
    setDraft((prev) => {
      const next = structuredClone(prev)
      change(next)
      return next
    })
  }

  const dirty = !same(draft, saved)
  const check = useMemo(() => ResumeSchema.safeParse(draft), [draft])
  const issues = check.success
    ? []
    : check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)

  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm('Discard unsaved changes to your resume?'),
    enableBeforeUnload: () => dirty,
  })

  // The preview re-renders a moment after you stop typing, not on every key.
  const [html, setHtml] = useState(() => renderResume(loaded.value))
  useEffect(() => {
    const timer = setTimeout(() => setHtml(renderResume(draft)), 300)
    return () => clearTimeout(timer)
  }, [draft])

  async function save() {
    setBusy(true)
    try {
      const r = await saveResumeFn({ data: { value: draft, version } })
      if (r.ok) {
        setSaved(draft)
        setVersion(r.version)
        setResult({ ok: true, message: `${r.message} New tailorings use it now.` })
      } else {
        setResult(r)
      }
    } finally {
      setBusy(false)
    }
  }

  async function reload() {
    const r = await getResumeForEdit()
    if (r.ok) onReload({ value: r.value, version: r.version, where: r.where })
    else setResult({ ok: false, message: r.message })
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Resume"
        subtitle={
          <>
            Your master resume for tailoring · saved to {loaded.where}
            {loaded.version === null && ' (new file: this is a starter to fill in)'}
          </>
        }
        actions={
          <>
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(saved)} disabled={busy}>
                Discard changes
              </Button>
            )}
            <Button
              variant="primary"
              disabled={!dirty || !check.success || busy}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
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
          {result.issues && (
            <ul className="mt-1 list-disc pl-5 text-sm text-red-700 dark:text-red-400">
              {result.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {issues.length > 0 && (
        <Callout tone="error">
          <p className="font-medium">Fix these before saving:</p>
          <ul className="mt-1 list-disc pl-5">
            {issues.slice(0, 8).map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Callout>
      )}

      <a
        href="#resume-preview"
        className="mb-4 inline-block text-sm text-accent-700 hover:underline xl:hidden dark:text-accent-400"
      >
        Jump to preview ↓
      </a>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)]">
        <div className="min-w-0 space-y-4">
          <BasicsSection resume={draft} edit={edit} />
          <SummarySection resume={draft} edit={edit} />
          <SkillsSection resume={draft} edit={edit} />
          <ExperienceSection resume={draft} edit={edit} taken={taken} />
          <PatentsSection resume={draft} edit={edit} />
          <EducationSection resume={draft} edit={edit} />
        </div>
        <aside
          id="resume-preview"
          aria-label="Preview"
          className="min-w-0 xl:sticky xl:top-6 xl:self-start"
        >
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">Preview</h2>
          <div className="xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto">
            <ResumePreview html={html} title="Resume preview" />
          </div>
        </aside>
      </div>
    </div>
  )
}
