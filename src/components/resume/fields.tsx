import { useId, useState, type ReactNode } from 'react'

import { Button, inputClass } from '../ui'

// Small form controls for the resume editor.

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  className = '',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full ${inputClass}`}
      />
    </div>
  )
}

const areaClass =
  'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm leading-relaxed text-ink [field-sizing:content] placeholder:text-muted focus:border-accent-500 focus:outline-none'

export function TextArea({
  label,
  value,
  onChange,
  hideLabel = false,
  minRows = 2,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hideLabel?: boolean
  minRows?: number
}) {
  const id = useId()
  return (
    <div>
      <label
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'mb-1 block text-xs font-medium text-muted'}
      >
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        rows={minRows}
        onChange={(e) => onChange(e.target.value)}
        className={areaClass}
      />
    </div>
  )
}

export const splitList = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * A list edited as comma-separated text. Keeps its own text while you type, so a trailing
 * comma or space doesn't vanish; the parent gets the parsed list.
 */
export function CommaInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
}) {
  const id = useId()
  const [text, setText] = useState(value.join(', '))
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label} <span className="font-normal">(comma-separated)</span>
      </label>
      <textarea
        id={id}
        value={text}
        rows={1}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value)
          onChange(splitList(e.target.value))
        }}
        className={areaClass}
      />
    </div>
  )
}

/** Move up / move down / delete for one item in a list. */
export function RowActions({
  what,
  index,
  count,
  onMove,
  onDelete,
}: {
  what: string
  index: number
  count: number
  onMove: (to: number) => void
  onDelete: () => void
}) {
  return (
    <div className="flex shrink-0 gap-1">
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Move ${what} up`}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      >
        ↑
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Move ${what} down`}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        ↓
      </Button>
      <Button size="sm" variant="ghost" aria-label={`Delete ${what}`} onClick={onDelete}>
        ✕
      </Button>
    </div>
  )
}

/** Moves list[from] to position `to`, in place. */
export function move(list: unknown[], from: number, to: number): void {
  if (to < 0 || to >= list.length) return
  const [item] = list.splice(from, 1)
  list.splice(to, 0, item)
}

export function Section({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="@container rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{title}</h2>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}
