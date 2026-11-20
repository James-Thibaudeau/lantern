import { compareScores, type JobScore, type ScorableJob } from './score'

// How a change to the criteria would move the ranking, for the criteria editor's impact panel.

export interface PreviewJob extends ScorableJob {
  id: string
  company: string
  firstSeenAt: string
}

export interface PreviewRow {
  id: string
  title: string
  company: string
  score: number
  /** Score under the saved criteria, or null when there were none. */
  before: number | null
  /** 1-based position now, and under the saved criteria (null when there were none). */
  rank: number
  rankBefore: number | null
  dealbreaker: string | null
  reasons: { label: string; points: number }[]
}

export interface RankingPreview {
  top: PreviewRow[]
  dealbreakers: number
  dealbreakersBefore: number | null
  /** Jobs whose position changed. */
  moved: number
  total: number
}

type Scorer = (job: ScorableJob) => JobScore

/** The order /jobs shows: dealbreakers last, best score first, then newest. */
function ranked(jobs: PreviewJob[], score: Scorer) {
  return jobs
    .map((job) => ({ job, s: score(job) }))
    .toSorted(
      (a, b) => compareScores(a.s, b.s) || b.job.firstSeenAt.localeCompare(a.job.firstSeenAt),
    )
}

export function rankingPreview(
  jobs: PreviewJob[],
  next: Scorer,
  saved: Scorer | null,
  limit = 15,
): RankingPreview {
  const after = ranked(jobs, next)
  const before = saved ? ranked(jobs, saved) : null
  const beforeIndex = new Map(before?.map((r, i) => [r.job.id, { i, s: r.s }]) ?? [])
  return {
    top: after.slice(0, limit).map(({ job, s }, i) => {
      const prev = beforeIndex.get(job.id)
      return {
        id: job.id,
        title: job.title,
        company: job.company,
        score: s.score,
        before: prev ? prev.s.score : null,
        rank: i + 1,
        rankBefore: prev ? prev.i + 1 : null,
        dealbreaker: s.dealbreaker,
        reasons: s.reasons.slice(0, 3),
      }
    }),
    dealbreakers: after.filter((r) => r.s.dealbreaker).length,
    dealbreakersBefore: before ? before.filter((r) => r.s.dealbreaker).length : null,
    moved: before ? after.filter((r, i) => beforeIndex.get(r.job.id)?.i !== i).length : 0,
    total: jobs.length,
  }
}
