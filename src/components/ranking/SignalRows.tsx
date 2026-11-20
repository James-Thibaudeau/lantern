import { Button, inputClass } from '#/components/ui'

import { Field, RowActions, ScopeSelect, moved } from './Field'
import { newSignal, type SignalRow } from './form'

function weightTone(weight: string): string {
  const n = Number(weight)
  if (weight.trim() === '' || Number.isNaN(n) || n === 0) return 'text-ink'
  return n > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
}

export function SignalRows({
  rows,
  onChange,
}: {
  rows: SignalRow[]
  onChange: (rows: SignalRow[]) => void
}) {
  const update = (key: string, patch: Partial<SignalRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  return (
    <div className="@container rounded-xl border border-line bg-surface p-4">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No signals: every job scores 0 apart from location.</p>
      ) : (
        <ol className="divide-y divide-line">
          {rows.map((row, i) => {
            const name = row.label.trim() || `signal ${i + 1}`
            return (
              <li key={row.key} className="py-3 first:pt-0">
                <div className="grid gap-2 @md:grid-cols-[minmax(0,1fr)_6rem_11rem]">
                  <Field label="Label">
                    {(id) => (
                      <input
                        id={id}
                        value={row.label}
                        onChange={(e) => update(row.key, { label: e.target.value })}
                        className={`${inputClass} w-full`}
                      />
                    )}
                  </Field>
                  <Field label="Points">
                    {(id) => (
                      <input
                        id={id}
                        type="number"
                        step="any"
                        value={row.weight}
                        onChange={(e) => update(row.key, { weight: e.target.value })}
                        className={`${inputClass} w-full tabular-nums ${weightTone(row.weight)}`}
                      />
                    )}
                  </Field>
                  <Field label="Look in">
                    {(id) => (
                      <ScopeSelect
                        id={id}
                        value={row.in}
                        onChange={(scope) => update(row.key, { in: scope })}
                      />
                    )}
                  </Field>
                </div>
                <Field label="Phrases, separated by commas" className="mt-2">
                  {(id) => (
                    <input
                      id={id}
                      value={row.phrases}
                      placeholder="react, next.js"
                      onChange={(e) => update(row.key, { phrases: e.target.value })}
                      className={`${inputClass} w-full`}
                    />
                  )}
                </Field>
                <div className="mt-2">
                  <RowActions
                    name={name}
                    move={{
                      up: i > 0 ? () => onChange(moved(rows, i, -1)) : null,
                      down: i < rows.length - 1 ? () => onChange(moved(rows, i, 1)) : null,
                    }}
                    onDelete={() => onChange(rows.filter((r) => r.key !== row.key))}
                  />
                </div>
              </li>
            )
          })}
        </ol>
      )}
      <div className="mt-3 border-t border-line pt-3">
        <Button size="sm" onClick={() => onChange([...rows, newSignal()])}>
          Add signal
        </Button>
      </div>
    </div>
  )
}
