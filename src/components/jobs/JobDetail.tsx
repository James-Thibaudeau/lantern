import type { JobStatus } from '#/pipeline/schema'
import type { JobRow } from '#/server/jobs'

import { Badge, Button, buttonClass } from '../ui'
import { EligibilityBadge, ScoreBadge } from './badges'
import { formatDate, formatSalary, points } from './format'

const STATUS_ACTIONS: { status: Exclude<JobStatus, 'new'>; label: string; key: string }[] = [
  { status: 'interested', label: 'Interested', key: 'I' },
  { status: 'applied', label: 'Applied', key: 'A' },
  { status: 'dismissed', label: 'Dismiss', key: 'X' },
]

const ACTIVE: Record<Exclude<JobStatus, 'new'>, string> = {
  interested:
    '!border-accent-500 !bg-accent-100 !text-accent-900 dark:!bg-accent-500/20 dark:!text-accent-200',
  applied: '!border-sky-500 !bg-sky-50 !text-sky-800 dark:!bg-sky-500/15 dark:!text-sky-200',
  dismissed: '!border-red-400 !bg-red-50 !text-red-800 dark:!bg-red-500/15 dark:!text-red-200',
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="ml-1 hidden rounded border border-line px-1 font-sans text-[10px] text-muted lg:inline">
      {children}
    </kbd>
  )
}

/** The selected job: what it is, why it scored what it did, and what you've decided. */
export function JobDetail({
  job,
  onStatus,
  onBack,
}: {
  job: JobRow
  /** Toggles: choosing the job's current status moves it back to the inbox. */
  onStatus: (status: Exclude<JobStatus, 'new'>) => void
  onBack: () => void
}) {
  const salary = formatSalary(job.salary)
  return (
    <article className="mx-auto max-w-3xl px-5 py-6 md:px-8">
      <Button variant="ghost" size="sm" className="mb-3 -ml-2 md:hidden" onClick={onBack}>
        ← All jobs
      </Button>

      <header className="flex items-start gap-4">
        {job.score !== null && (
          <ScoreBadge score={job.score} dealbreaker={job.dealbreaker} size="lg" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted">{job.company}</p>
          <h2 className="text-xl leading-snug font-semibold tracking-tight md:text-2xl">
            {job.title}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted">
            <EligibilityBadge eligibility={job.eligibility} />
            {job.closedAt && <Badge>Closed {formatDate(job.closedAt)}</Badge>}
            <span>{job.locationText || 'No location given'}</span>
            {salary && <span className="text-ink tabular-nums">{salary}</span>}
          </div>
        </div>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {STATUS_ACTIONS.map((a) => (
          <Button
            key={a.status}
            aria-pressed={job.status === a.status}
            className={job.status === a.status ? ACTIVE[a.status] : ''}
            onClick={() => onStatus(a.status)}
          >
            {a.label}
            <Kbd>{a.key}</Kbd>
          </Button>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <Button
          variant="primary"
          disabled
          title="Resume tailoring is the next thing being built"
          aria-describedby="tailor-soon"
        >
          Tailor resume
        </Button>
        <span id="tailor-soon" className="text-xs text-muted">
          Coming soon
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a
          href={job.url}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-accent-700 hover:underline dark:text-accent-400"
        >
          View posting ↗
        </a>
        {job.applyUrl && job.applyUrl !== job.url && (
          <a
            href={job.applyUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent-700 hover:underline dark:text-accent-400"
          >
            Apply ↗
          </a>
        )}
        <span className="text-muted">
          Posted {formatDate(job.postedAt)} · first seen {formatDate(job.firstSeenAt)} · via{' '}
          {job.source}
        </span>
      </div>

      {job.dealbreaker && (
        <p className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200">
          Dealbreaker: <strong>{job.dealbreaker}</strong>. It stays at the bottom of the list
          whatever its score.
        </p>
      )}

      {job.score !== null && (
        <section aria-labelledby="why-score" className="mt-6">
          <h3
            id="why-score"
            className="mb-2 text-xs font-medium tracking-wide text-muted uppercase"
          >
            Why it scored {job.score}
          </h3>
          {job.reasons.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {job.reasons.map((r) => (
                <li key={r.label}>
                  <Badge tone={r.points > 0 ? 'neutral' : 'red'} className="tabular-nums">
                    {points(r.points)} {r.label}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">None of your criteria matched this job.</p>
          )}
        </section>
      )}

      <section aria-labelledby="about-job" className="mt-8 border-t border-line pt-6">
        <h3 id="about-job" className="sr-only">
          Description
        </h3>
        <p className="text-[15px] leading-7 whitespace-pre-line text-ink/90">
          {job.descriptionText}
        </p>
      </section>

      <a
        href={job.applyUrl ?? job.url}
        target="_blank"
        rel="noreferrer"
        className={`mt-8 ${buttonClass('secondary')}`}
      >
        Open the posting ↗
      </a>
    </article>
  )
}
