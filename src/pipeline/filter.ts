import type { Job, Profile } from './schema'

export type FilterResult = { keep: true; profileIds: string[] } | { keep: false; reason: 'title' | 'eligibility' }

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whole-word, case-insensitive phrase match, so "intern" doesn't match "International". */
function phraseMatcher(phrases: string[]): (title: string) => boolean {
  if (phrases.length === 0) return () => false
  const re = new RegExp(`(?<![a-z0-9])(${phrases.map(escapeRegex).join('|')})(?![a-z0-9])`, 'i')
  return (title) => re.test(title)
}

/**
 * The early filter that runs in the Action. A job is kept if at least one enabled profile
 * matches its title (an include phrase, no exclude phrase) and allows its eligibility.
 */
export function createFilter(profiles: Profile[]): (job: Pick<Job, 'title' | 'eligibility'>) => FilterResult {
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
