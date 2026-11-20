import { useBlocker, useRouter } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { Button, Callout, Notice, PageHeader, SectionTitle } from '#/components/ui'
import { CriteriaSchema, type Criteria } from '#/rank/criteria'
import { saveCriteriaFn } from '#/server/config-editor'

import { DealbreakerRows } from './DealbreakerRows'
import { describeIssues, fromCriteria, toCriteria, type CriteriaForm } from './form'
import { ImpactPanel } from './ImpactPanel'
import { LocationPoints } from './LocationPoints'
import { SalaryFloor } from './SalaryFloor'
import { SignalRows } from './SignalRows'

type SaveState =
  | { kind: 'saved' }
  | { kind: 'failed'; conflict: boolean; message: string; issues?: string[] }

/** The criteria as the form would save them, so an untouched form isn't "changed". */
function canonicalJson(value: Criteria): string {
  const parsed = CriteriaSchema.safeParse(toCriteria(fromCriteria(value)))
  return JSON.stringify(parsed.success ? parsed.data : value)
}

function Help({ children }: { children: string }) {
  return <p className="-mt-1 mb-3 text-sm text-muted">{children}</p>
}

export function CriteriaEditor({
  loaded,
  onReload,
}: {
  loaded: { value: Criteria; version: string | null; where: string }
  /** Refetches the saved criteria and remounts the editor with them. */
  onReload: () => Promise<void>
}) {
  const router = useRouter()
  const [draft, setDraft] = useState(() => fromCriteria(loaded.value))
  const [version, setVersion] = useState(loaded.version)
  const [savedJson, setSavedJson] = useState(() => canonicalJson(loaded.value))
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<SaveState | null>(null)

  const parsed = useMemo(() => CriteriaSchema.safeParse(toCriteria(draft)), [draft])
  const json = parsed.success ? JSON.stringify(parsed.data) : null
  const issues = parsed.success ? [] : describeIssues(parsed.error, draft)
  const dirty = json !== savedJson
  // With no file yet, the starter criteria can be saved as they are.
  const canSave = json !== null && (dirty || version === null) && !saving

  useBlocker({
    shouldBlockFn: () =>
      dirty && !window.confirm('Discard unsaved changes to your ranking criteria?'),
    enableBeforeUnload: () => dirty,
  })

  function edit(patch: Partial<CriteriaForm>) {
    setDraft((d) => ({ ...d, ...patch }))
    if (result?.kind === 'saved') setResult(null)
  }

  async function save() {
    if (!parsed.success || json === null) return
    setSaving(true)
    setResult(null)
    try {
      const r = await saveCriteriaFn({ data: { value: parsed.data, version } })
      if (r.ok) {
        setVersion(r.version)
        setSavedJson(json)
        setResult({ kind: 'saved' })
        await router.invalidate()
      } else {
        setResult({ kind: 'failed', conflict: r.conflict, message: r.message, issues: r.issues })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setResult({ kind: 'failed', conflict: false, message: `Not saved: ${message}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Ranking"
        subtitle={`How jobs are scored · saved to ${loaded.where}`}
        actions={
          <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        }
      />

      {result?.kind === 'saved' && (
        <div className="mb-4">
          <Notice ok>Saved. Jobs are re-ranked.</Notice>
        </div>
      )}
      {result?.kind === 'failed' && result.conflict && (
        <Callout tone="warning">
          <p className="whitespace-pre-line">{result.message}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            Reload to get the latest version (your changes here will be lost).
            <Button size="sm" onClick={() => void onReload()}>
              Reload
            </Button>
          </p>
        </Callout>
      )}
      {result?.kind === 'failed' && !result.conflict && (
        <Callout tone="error">
          <p className="whitespace-pre-line">{result.message}</p>
          {result.issues && result.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {result.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </Callout>
      )}
      {issues.length > 0 && (
        <Callout tone="warning">
          <p>Fix these before saving:</p>
          <ul className="mt-1 list-disc pl-5">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </Callout>
      )}
      {version === null && (
        <p className="mb-4 text-sm text-muted">
          There’s no criteria.json yet, so these are the example criteria. Save to create it.
        </p>
      )}

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_24rem] xl:gap-8">
        <div className="min-w-0 space-y-8">
          <section>
            <SectionTitle>Signals</SectionTitle>
            <Help>
              If any phrase matches (whole words, ignoring case), the points are added once.
              Negative points push a job down.
            </Help>
            <SignalRows rows={draft.signals} onChange={(signals) => edit({ signals })} />
          </section>
          <section>
            <SectionTitle>Dealbreakers</SectionTitle>
            <Help>A match sinks the job to the bottom of the list, whatever its score.</Help>
            <DealbreakerRows
              rows={draft.dealbreakers}
              onChange={(dealbreakers) => edit({ dealbreakers })}
            />
          </section>
          <section>
            <SectionTitle>Location points</SectionTitle>
            <Help>Points for each kind of location. Leave a box empty for 0.</Help>
            <LocationPoints
              values={draft.eligibility}
              onChange={(eligibility) => edit({ eligibility })}
            />
          </section>
          <section>
            <SectionTitle>Salary floor</SectionTitle>
            <Help>
              Takes points off when a yearly salary in this currency tops out below the floor. A
              missing salary is neutral.
            </Help>
            <SalaryFloor value={draft.salary} onChange={(salary) => edit({ salary })} />
          </section>
        </div>
        <aside className="mt-8 self-start xl:sticky xl:top-6 xl:mt-0 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto">
          <ImpactPanel json={json} issues={issues} />
        </aside>
      </div>
    </div>
  )
}
