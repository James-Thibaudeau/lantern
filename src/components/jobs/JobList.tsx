import { useEffect, useRef } from 'react'

import type { JobRow } from '#/server/jobs'

import { Badge } from '../ui'
import { EligibilityBadge, ScoreBadge } from './badges'
import { formatSalary } from './format'

/** The left-hand list. Each row is a button; the selected one is marked aria-current. */
export function JobList({
  jobs,
  selectedId,
  isNew,
  onSelect,
}: {
  jobs: JobRow[]
  selectedId: string | null
  isNew: (job: JobRow) => boolean
  onSelect: (id: string) => void
}) {
  const selectedRef = useRef<HTMLButtonElement>(null)
  // Keep the selected row in view as J / K move through the list.
  useEffect(() => {
    if (selectedId) selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  return (
    <ul className="divide-y divide-line">
      {jobs.map((job) => {
        const selected = job.id === selectedId
        const salary = formatSalary(job.salary)
        return (
          <li key={job.id}>
            <button
              type="button"
              ref={selected ? selectedRef : undefined}
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelect(job.id)}
              className={`flex w-full gap-3 border-l-2 px-4 py-3 text-left transition-colors ${
                selected ? 'border-accent-500 bg-selected' : 'border-transparent hover:bg-hover'
              } ${job.dealbreaker ? 'opacity-55' : ''}`}
            >
              {job.score !== null && <ScoreBadge score={job.score} dealbreaker={job.dealbreaker} />}
              <div className="min-w-0 flex-1">
                <p className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-sm leading-snug font-medium">{job.title}</span>
                  {isNew(job) && (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent-500">
                      <span className="sr-only">New</span>
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {job.company} · {job.locationText || 'No location'}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <EligibilityBadge eligibility={job.eligibility} />
                  {salary && <span className="tabular-nums">{salary}</span>}
                  {job.closedAt && <Badge>Closed</Badge>}
                </div>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
