import { inputClass } from '#/components/ui'

import { Field } from './Field'
import type { SalaryForm } from './form'

export function SalaryFloor({
  value,
  onChange,
}: {
  value: SalaryForm
  onChange: (value: SalaryForm) => void
}) {
  const set = (patch: Partial<SalaryForm>) => onChange({ ...value, ...patch })
  return (
    <div className="@container rounded-xl border border-line bg-surface p-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
          className="size-4 accent-accent-600"
        />
        Use a salary floor
      </label>
      {value.enabled && (
        <div className="mt-3 grid gap-2 @md:grid-cols-3">
          <Field label="Currency">
            {(id) => (
              <input
                id={id}
                value={value.currency}
                maxLength={3}
                placeholder="CAD"
                autoCapitalize="characters"
                onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
                className={`${inputClass} w-full uppercase`}
              />
            )}
          </Field>
          <Field label="Yearly floor">
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                step="any"
                placeholder="140000"
                value={value.floor}
                onChange={(e) => set({ floor: e.target.value })}
                className={`${inputClass} w-full tabular-nums`}
              />
            )}
          </Field>
          <Field label="Penalty below it (0 or less)">
            {(id) => (
              <input
                id={id}
                type="number"
                max={0}
                step="any"
                placeholder="-15"
                value={value.belowFloor}
                onChange={(e) => set({ belowFloor: e.target.value })}
                className={`${inputClass} w-full tabular-nums`}
              />
            )}
          </Field>
        </div>
      )}
    </div>
  )
}
