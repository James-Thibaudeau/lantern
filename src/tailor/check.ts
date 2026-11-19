import type { Resume } from './resume'
import type { Tailoring } from './schema'

// Checks a tailoring against the master resume before you see it. Errors are fixed by
// dropping the bad item or falling back to the original wording; warnings are only shown.
// The aim is that a tailored resume can't say anything the master resume doesn't.

export interface Issue {
  /** The change it's about (see changes.ts), when there is one. */
  key?: string
  message: string
}

export interface CheckResult {
  /** The tailoring with every error fixed. */
  tailoring: Tailoring
  errors: Issue[]
  warnings: Issue[]
}

/** Numbers as written, without thousands separators: "1,000+" → "1000", "7–8x" → "7", "8". */
export function numbersIn(text: string): Set<string> {
  return new Set((text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,(?=\d{3}\b)/g, '')))
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? []

/** Share of the source's words still present: 1 is unchanged, 0 is a different sentence. */
export function overlap(source: string, text: string): number {
  const a = new Set(words(source))
  if (a.size === 0) return 1
  const b = new Set(words(text))
  let kept = 0
  for (const w of a) if (b.has(w)) kept++
  return kept / a.size
}

/**
 * Terms that look like names of technologies or products (capitalized mid-sentence, or with a
 * dot, plus sign, hash or capital inside), so a skill the resume never mentions stands out.
 */
export function termsIn(text: string): string[] {
  const out: string[] = []
  for (const sentence of text.split(/(?<=[.!?;:])\s+/)) {
    const tokens = sentence.match(/[A-Za-z][A-Za-z0-9.+#/-]*[A-Za-z0-9+#]|[A-Z]/g) ?? []
    tokens.forEach((t, i) => {
      const inner = /[A-Z]/.test(t.slice(1)) || /[.+#]/.test(t)
      if (inner || (i > 0 && /^[A-Z]/.test(t))) out.push(t)
    })
  }
  return out
}

const YEARS = /\d+\+?\s*years?\b/i

/** The sentence that states years of experience, or '' when there isn't one. */
function yearsSentence(text: string): string {
  return text.split(/(?<=[.!?])\s+/).find((s) => YEARS.test(s)) ?? ''
}

/**
 * Skills that the summary's years-of-experience sentence names but the master summary's
 * didn't, e.g. "9+ years building web apps" becoming "9+ years of React". Number checks can't
 * catch that stretch, since no number changed.
 */
export function stretchedYears(master: Resume, summary: string): string[] {
  const after = yearsSentence(summary).toLowerCase()
  if (!after) return []
  const before = yearsSentence(master.summary).toLowerCase()
  const skills = master.skills.flatMap((g) => g.items.map((i) => i.replace(/\s*\(.*\)$/, '')))
  return [...new Set(skills)].filter((skill) => {
    const re = new RegExp(
      `(?<![a-z0-9])${skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`,
    )
    return re.test(after) && !re.test(before)
  })
}

function resumeText(r: Resume): string {
  return [
    r.basics.name,
    r.basics.headline,
    r.basics.location ?? '',
    r.summary,
    ...r.skills.flatMap((g) => [g.group, ...g.items]),
    ...r.experience.flatMap((j) => [
      j.title,
      j.employer,
      j.dates,
      j.context ?? '',
      ...j.bullets.map((b) => b.text),
      ...j.stack,
    ]),
    ...r.patents.flatMap((p) => [p.title, p.number ?? '']),
    ...r.education.flatMap((e) => [e.credential, e.school, e.year]),
  ].join('\n')
}

/** Rewording below this share of kept words gets a "look closely" warning. */
const HEAVY_REWORD = 0.5

export function checkTailoring(master: Resume, input: Tailoring): CheckResult {
  const errors: Issue[] = []
  const warnings: Issue[] = []
  const known = resumeText(master).toLowerCase()
  const knownNumbers = numbersIn(resumeText(master))

  const unknownTerms = (text: string) =>
    [...new Set(termsIn(text))].filter((t) => !known.includes(t.toLowerCase()))

  // Summary: numbers must exist somewhere in the resume.
  let summary = input.summary.trim()
  const badSummaryNumbers = [...numbersIn(summary)].filter((n) => !knownNumbers.has(n))
  if (badSummaryNumbers.length > 0) {
    errors.push({
      key: 'summary',
      message: `The summary used numbers that aren't in your resume (${badSummaryNumbers.join(', ')}), so it was kept as written.`,
    })
    summary = master.summary
  } else {
    const terms = unknownTerms(summary)
    if (terms.length > 0) {
      warnings.push({
        key: 'summary',
        message: `The summary mentions ${terms.join(', ')}, which isn't in your resume.`,
      })
    }
    const stretched = stretchedYears(master, summary)
    if (stretched.length > 0) {
      warnings.push({
        key: 'summary',
        message: `The years-of-experience claim now names ${stretched.join(', ')}. Check that's true for all those years.`,
      })
    }
  }

  // Skills: only groups and items from the master.
  const masterGroups = new Map(master.skills.map((g) => [g.group, g.items]))
  const skills: Tailoring['skills'] = []
  for (const g of input.skills) {
    const items = masterGroups.get(g.group)
    if (!items) {
      errors.push({ message: `Dropped the skill group "${g.group}": it isn't in your resume.` })
      continue
    }
    if (skills.some((s) => s.group === g.group)) continue
    const byKey = new Map(items.map((i) => [i.trim().toLowerCase(), i]))
    const kept: string[] = []
    for (const item of g.items) {
      const match = byKey.get(item.trim().toLowerCase())
      if (!match) {
        errors.push({
          key: `skills:${g.group}`,
          message: `Dropped the skill "${item}": it isn't in your ${g.group} skills.`,
        })
      } else if (!kept.includes(match)) {
        kept.push(match)
      }
    }
    skills.push({ group: g.group, items: kept })
  }

  // Experience: bullets must come from that job, and keep their numbers.
  const jobOf = new Map<string, string>()
  const bulletText = new Map<string, string>()
  for (const j of master.experience) {
    for (const b of j.bullets) {
      jobOf.set(b.id, j.id)
      bulletText.set(b.id, b.text)
    }
  }
  const masterJobs = new Set(master.experience.map((j) => j.id))
  const experience: Tailoring['experience'] = []
  for (const j of input.experience) {
    if (!masterJobs.has(j.id)) {
      errors.push({ message: `Dropped an unknown job "${j.id}".` })
      continue
    }
    if (experience.some((e) => e.id === j.id)) continue
    const bullets: Tailoring['experience'][number]['bullets'] = []
    for (const b of j.bullets) {
      const source = bulletText.get(b.sourceId)
      const owner = jobOf.get(b.sourceId)
      if (source === undefined || owner === undefined) {
        errors.push({
          key: `bullets:${j.id}`,
          message: `Dropped a bullet with an unknown id "${b.sourceId}".`,
        })
        continue
      }
      if (owner !== j.id) {
        errors.push({
          key: `bullets:${j.id}`,
          message: `Dropped bullet "${b.sourceId}" from ${j.id}: it belongs to ${owner}.`,
        })
        continue
      }
      if (bullets.some((x) => x.sourceId === b.sourceId)) continue
      let text = b.text.trim()
      const sourceNumbers = numbersIn(source)
      const invented = [...numbersIn(text)].filter((n) => !sourceNumbers.has(n))
      const key = `reword:${b.sourceId}`
      if (invented.length > 0) {
        errors.push({
          key,
          message: `A reworded bullet added numbers that aren't in the original (${invented.join(', ')}), so the original wording was kept.`,
        })
        text = source
      } else if (text !== source) {
        const terms = unknownTerms(text)
        if (terms.length > 0) {
          warnings.push({
            key,
            message: `Mentions ${terms.join(', ')}, which isn't in your resume.`,
          })
        }
        if (overlap(source, text) < HEAVY_REWORD) {
          warnings.push({ key, message: 'Heavily reworded: check it still says what you did.' })
        }
      }
      bullets.push({ sourceId: b.sourceId, text })
    }
    experience.push({ id: j.id, bullets })
  }

  return { tailoring: { ...input, summary, skills, experience }, errors, warnings }
}
