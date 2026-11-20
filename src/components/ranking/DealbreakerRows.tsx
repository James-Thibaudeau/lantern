import { Button, inputClass } from '#/components/ui'

import { Field, RowActions, ScopeSelect } from './Field'
import { newDealbreaker, type DealbreakerRow } from './form'

export function DealbreakerRows({
  rows,
  onChange,
}: {
  rows: DealbreakerRow[]
  onChange: (rows: DealbreakerRow[]) => void
}) {
  const update = (key: string, patch: Partial<DealbreakerRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  return (
    <div className="@container rounded-xl border border-line bg-surface p-4">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No dealbreakers.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row, i) => (
            <li key={row.key} className="py-3 first:pt-0">
              <div className="grid gap-2 @md:grid-cols-[minmax(0,1fr)_11rem]">
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
                    placeholder="security clearance, secret clearance"
                    onChange={(e) => update(row.key, { phrases: e.target.value })}
                    className={`${inputClass} w-full`}
                  />
                )}
              </Field>
              <div className="mt-2">
                <RowActions
                  name={row.label.trim() || `dealbreaker ${i + 1}`}
                  onDelete={() => onChange(rows.filter((r) => r.key !== row.key))}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 border-t border-line pt-3">
        <Button size="sm" onClick={() => onChange([...rows, newDealbreaker()])}>
          Add dealbreaker
        </Button>
      </div>
    </div>
  )
}
