import { ELIGIBILITY_LABEL, EligibilitySchema } from '#/pipeline/schema'
import { phraseMatcher } from '#/pipeline/text'

import type { Criteria, Scope } from './criteria'

/** The job fields scoring reads. A `jobs` table row fits this as is. */
export interface ScorableJob {
  title: string
  descriptionText: string
  locationText: string
  eligibility: string
  salaryMax: number | null
  salaryMin: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
}

export interface Reason {
  label: string
  points: number
}

export interface JobScore {
  /** Sum of all points. */
  score: number
  /** What added or took away points, largest effect first. */
  reasons: Reason[]
  /** Label of the first dealbreaker that matched, or null. */
  dealbreaker: string | null
}

function scopedMatcher(phrases: string[], scope: Scope): (job: ScorableJob) => boolean {
  const match = phraseMatcher(phrases)
  if (scope === 'title') return (job) => match(job.title)
  if (scope === 'description') return (job) => match(job.descriptionText)
  if (scope === 'location') return (job) => match(job.locationText)
  return (job) => match(job.title) || match(job.descriptionText)
}

/**
 * Compiles the criteria once and returns a scoring function. Pure: the same job and criteria
 * always give the same score, so the CLI and the app agree.
 */
export function createScorer(criteria: Criteria): (job: ScorableJob) => JobScore {
  const signals = criteria.signals.map((s) => ({
    label: s.label,
    weight: s.weight,
    matches: scopedMatcher(s.phrases, s.in),
  }))
  const dealbreakers = criteria.dealbreakers.map((d) => ({
    label: d.label,
    matches: scopedMatcher(d.phrases, d.in),
  }))
  const salary = criteria.salary

  return (job) => {
    const reasons: Reason[] = []

    for (const s of signals) {
      if (s.weight !== 0 && s.matches(job)) reasons.push({ label: s.label, points: s.weight })
    }

    const eligibility = EligibilitySchema.safeParse(job.eligibility).data
    const locationPoints = eligibility ? criteria.eligibility[eligibility] : undefined
    if (eligibility && locationPoints) {
      reasons.push({ label: ELIGIBILITY_LABEL[eligibility], points: locationPoints })
    }

    if (salary && salary.belowFloor !== 0 && job.salaryPeriod === 'year') {
      const top = job.salaryMax ?? job.salaryMin
      if (top !== null && job.salaryCurrency?.toUpperCase() === salary.currency) {
        if (top < salary.floor)
          reasons.push({ label: 'Below salary floor', points: salary.belowFloor })
      }
    }

    reasons.sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    return {
      score: reasons.reduce((sum, r) => sum + r.points, 0),
      reasons,
      dealbreaker: dealbreakers.find((d) => d.matches(job))?.label ?? null,
    }
  }
}

/** Sort order for ranked jobs: dealbreakers last, then highest score first. */
export function compareScores(a: JobScore, b: JobScore): number {
  if ((a.dealbreaker === null) !== (b.dealbreaker === null)) return a.dealbreaker === null ? -1 : 1
  return b.score - a.score
}
