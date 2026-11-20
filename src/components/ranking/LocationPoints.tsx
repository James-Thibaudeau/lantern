import { inputClass } from '#/components/ui'
import { ELIGIBILITY, ELIGIBILITY_LABEL, type Eligibility } from '#/pipeline/schema'

import { Field } from './Field'

export function LocationPoints({
  values,
  onChange,
}: {
  values: Record<Eligibility, string>
  onChange: (values: Record<Eligibility, string>) => void
}) {
  return (
    <div className="@container rounded-xl border border-line bg-surface p-4">
      <div className="grid gap-x-6 gap-y-3 @md:grid-cols-2">
        {ELIGIBILITY.map((e) => (
          <Field key={e} label={ELIGIBILITY_LABEL[e]}>
            {(id) => (
              <input
                id={id}
                type="number"
                step="any"
                placeholder="0"
                value={values[e]}
                onChange={(ev) => onChange({ ...values, [e]: ev.target.value })}
                className={`${inputClass} w-full tabular-nums`}
              />
            )}
          </Field>
        ))}
      </div>
    </div>
  )
}
