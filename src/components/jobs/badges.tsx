import { ELIGIBILITY_LABEL, type Eligibility } from '#/pipeline/schema'

import { Badge, type BadgeTone } from '../ui'

const ELIGIBILITY_TONE: Record<Eligibility, BadgeTone> = {
  remote_canada_ok: 'teal',
  canada_hybrid: 'blue',
  canada_onsite: 'indigo',
  unknown: 'warning',
  remote_us_only: 'neutral',
  remote_non_canada: 'neutral',
  non_canada_onsite: 'neutral',
}

export function EligibilityBadge({ eligibility }: { eligibility: Eligibility }) {
  return <Badge tone={ELIGIBILITY_TONE[eligibility]}>{ELIGIBILITY_LABEL[eligibility]}</Badge>
}

/** The match score; the stronger the match, the warmer the badge. */
export function ScoreBadge({
  score,
  dealbreaker,
  size = 'sm',
}: {
  score: number
  dealbreaker?: string | null
  size?: 'sm' | 'lg'
}) {
  const tone = dealbreaker
    ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/25'
    : score >= 40
      ? 'bg-accent-600 text-white ring-accent-600'
      : score >= 25
        ? 'bg-accent-200 text-accent-950 ring-accent-300 dark:bg-accent-500/35 dark:text-accent-100 dark:ring-accent-500/40'
        : score >= 10
          ? 'bg-accent-50 text-accent-900 ring-accent-200 dark:bg-accent-500/10 dark:text-accent-300 dark:ring-accent-500/20'
          : 'bg-sunken text-muted ring-line'
  const box = size === 'lg' ? 'h-10 min-w-10 text-base' : 'h-6 min-w-8 text-xs'
  return (
    <span
      title={dealbreaker ? `Dealbreaker: ${dealbreaker}` : 'Match score'}
      className={`inline-flex shrink-0 items-center justify-center rounded-md px-1.5 font-semibold tabular-nums ring-1 ring-inset ${box} ${tone}`}
    >
      {score}
    </span>
  )
}
