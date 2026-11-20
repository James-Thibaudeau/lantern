import { useId, type ReactNode } from 'react'

import { Button, selectClass } from '#/components/ui'
import type { Scope } from '#/rank/criteria'

import { SCOPE_OPTIONS, parseScope } from './form'

/** A small visible label above a control; the control gets the generated id. */
export function Field({
  label,
  className = '',
  children,
}: {
  label: string
  className?: string
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      {children(id)}
    </div>
  )
}

export function ScopeSelect({
  id,
  value,
  onChange,
}: {
  id: string
  value: Scope
  onChange: (scope: Scope) => void
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(parseScope(e.target.value))}
      className={`${selectClass} w-full`}
    >
      {SCOPE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** Up / down / delete for a row in a list. */
export function RowActions({
  name,
  move,
  onDelete,
}: {
  name: string
  /** Omit for lists without an order; null disables that direction. */
  move?: { up: (() => void) | null; down: (() => void) | null }
  onDelete: () => void
}) {
  return (
    <div className="flex justify-end gap-1">
      {move && (
        <>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Move ${name} up`}
            disabled={!move.up}
            onClick={move.up ?? undefined}
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Move ${name} down`}
            disabled={!move.down}
            onClick={move.down ?? undefined}
          >
            ↓
          </Button>
        </>
      )}
      <Button size="sm" variant="danger" aria-label={`Delete ${name}`} onClick={onDelete}>
        Delete
      </Button>
    </div>
  )
}

/** Items with the one at `index` swapped with its neighbour `by` places away (if any). */
export function moved<T>(items: T[], index: number, by: -1 | 1): T[] {
  const other = index + by
  if (other < 0 || other >= items.length) return items
  const next = [...items]
  ;[next[index], next[other]] = [next[other], next[index]]
  return next
}
