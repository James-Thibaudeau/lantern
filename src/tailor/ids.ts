import type { Resume } from './resume'

// Ids for jobs and bullets added in the resume editor. Tailored resumes point at bullets by
// id, so an id is never changed by editing and never handed to a different bullet: new ones
// get a random suffix, and the editor keeps deleted ids out of circulation.

/** "Acme Corp." → "acme-corp" */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/** Every job and bullet id in the resume. */
export function idsIn(resume: Resume): Set<string> {
  return new Set(resume.experience.flatMap((j) => [j.id, ...j.bullets.map((b) => b.id)]))
}

function unique(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
  }
}

/** "Acme Corp", "2024 – Present" → "acme-corp-2024" (or "-2" etc. when taken). */
export function newJobId(employer: string, dates: string, taken: Set<string>): string {
  const year = /\b(19|20)\d{2}\b/.exec(dates)?.[0]
  const base = [slugify(employer) || 'job', year].filter(Boolean).join('-')
  return unique(base, taken)
}

/** "<job id>-<4 random letters/digits>", unique among `taken`. */
export function newBulletId(
  jobId: string,
  taken: Set<string>,
  random: () => number = Math.random,
): string {
  for (;;) {
    const suffix = Array.from(
      { length: 4 },
      () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(random() * 36)],
    ).join('')
    const id = `${jobId}-${suffix}`
    if (!taken.has(id)) return id
  }
}
