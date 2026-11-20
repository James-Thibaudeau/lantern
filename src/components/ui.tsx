import type { ButtonHTMLAttributes, ReactNode } from 'react'

// Small shared building blocks, so pages don't repeat long class strings.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent-600 text-white shadow-sm hover:bg-accent-500 disabled:hover:bg-accent-600',
  secondary:
    'border border-line bg-surface text-ink shadow-sm hover:bg-hover disabled:hover:bg-surface',
  ghost: 'text-muted hover:bg-hover hover:text-ink',
  danger:
    'border border-line bg-surface text-red-700 shadow-sm hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40',
}

/** Classes for a button-looking element (also used on links). */
export function buttonClass(variant: ButtonVariant = 'secondary', size: 'sm' | 'md' = 'md') {
  return `${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${size === 'sm' ? 'h-7 px-2.5' : 'h-8 px-3'}`
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return (
    // oxlint-disable-next-line react/button-has-type -- type defaults to "button" above
    <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...props} />
  )
}

export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'warning'
  | 'green'
  | 'teal'
  | 'blue'
  | 'indigo'
  | 'red'

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-muted ring-line',
  accent:
    'bg-accent-100 text-accent-900 ring-accent-200 dark:bg-accent-500/15 dark:text-accent-300 dark:ring-accent-500/25',
  /** Needs a look: stays amber whatever the accent is. */
  warning:
    'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25',
  green:
    'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20',
  teal: 'bg-teal-50 text-teal-800 ring-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-500/20',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/20',
  indigo:
    'bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/20',
  red: 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/20',
}

export function Badge({
  tone = 'neutral',
  className = '',
  children,
}: {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${BADGE_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

/** A one-line result message: muted when fine, red when not. */
export function Notice({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <output className={`block text-sm ${ok ? 'text-muted' : 'text-red-700 dark:text-red-400'}`}>
      {children}
    </output>
  )
}

/** A highlighted box for warnings and errors that need attention. */
export function Callout({ tone, children }: { tone: 'warning' | 'error'; children: ReactNode }) {
  const style =
    tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200'
      : 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200'
  return <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${style}`}>{children}</div>
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  )
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <h2 className="text-base font-semibold">{children}</h2>
      {actions}
    </div>
  )
}

// Tables
export const tableWrap = 'overflow-x-auto rounded-xl border border-line bg-surface'
export const tableClass = 'w-full text-left text-sm'
export const theadClass =
  'border-b border-line bg-sunken text-xs tracking-wide text-muted uppercase'
export const thClass = 'px-3 py-2 font-medium'
export const tbodyClass = 'divide-y divide-line tabular-nums'
export const tdClass = 'px-3 py-2'

export const inputClass =
  'h-8 rounded-md border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-muted focus:border-accent-500 focus:outline-none'

/** For <select>: the input look plus a chevron inside the padding (see .select in styles.css). */
export const selectClass = `select ${inputClass}`
