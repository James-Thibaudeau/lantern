import type { Job, Profile } from './schema'
import { phraseMatcher } from './text'

export type FilterResult =
  | { keep: true; profileIds: string[] }
  | { keep: false; reason: 'title' | 'eligibility' }

/**
 * The early filter that runs in the Action. A job is kept if at least one enabled profile
 * matches its title (an include phrase, no exclude phrase) and allows its eligibility.
 */
export function createFilter(
  profiles: Profile[],
): (job: Pick<Job, 'title' | 'eligibility'>) => FilterResult {
  const compiled = profiles
    .filter((p) => p.enabled)
    .map((p) => ({
      id: p.id,
      include: phraseMatcher(p.titleInclude),
      exclude: phraseMatcher(p.titleExclude),
      allowed: new Set(p.allowedEligibility),
    }))

  return (job) => {
    const titleMatches = compiled.filter((p) => p.include(job.title) && !p.exclude(job.title))
    if (titleMatches.length === 0) return { keep: false, reason: 'title' }
    const matches = titleMatches.filter((p) => p.allowed.has(job.eligibility))
    if (matches.length === 0) return { keep: false, reason: 'eligibility' }
    return { keep: true, profileIds: matches.map((p) => p.id) }
  }
}
