import { z } from 'zod'

import { applyDecisions, listChanges, type Change } from './changes'
import { ResumeSchema, type Resume } from './resume'
import { TailoringSchema, type Tailoring } from './schema'
import { ChecksSchema } from './tailor'

// How a tailoring is kept in tailored_resumes: the edits plus a snapshot of the master resume
// they were made from, so an old version still renders exactly as it was, even after
// resume.json changes.

export const StoredTailoringSchema = z.object({ master: ResumeSchema, result: TailoringSchema })
export type StoredTailoring = z.infer<typeof StoredTailoringSchema>

export function storeTailoring(master: Resume, result: Tailoring): StoredTailoring {
  return { master, result }
}

export interface ReadTailoring {
  master: Resume
  result: Tailoring
  checks: z.infer<typeof ChecksSchema>
  changes: Change[]
  /** The resume with your decisions applied. */
  final: Resume
}

/** Parses a stored row's JSON. Returns null when it's unreadable (e.g. an older format). */
export function readTailoring(
  tailoring: unknown,
  checks: unknown,
  decisions: Record<string, boolean>,
): ReadTailoring | null {
  const stored = StoredTailoringSchema.safeParse(tailoring)
  if (!stored.success) return null
  const { master, result } = stored.data
  const parsedChecks = ChecksSchema.safeParse(checks)
  return {
    master,
    result,
    checks: parsedChecks.success
      ? parsedChecks.data
      : { errors: [], warnings: [], fitNotes: result.fitNotes },
    changes: listChanges(master, result),
    final: applyDecisions(master, result, decisions),
  }
}

/** Removes characters that aren't allowed (or are awkward) in file names. */
function cleanFilePart(s: string): string {
  const printable = Array.from(s, (c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('')
  return printable
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "James Thibaudeau - Cohere - Web Developer.html", safe on every OS. */
export function resumeFileName(name: string, company: string, title: string): string {
  return `${[name, company, title].map(cleanFilePart).filter(Boolean).join(' - ').slice(0, 150)}.html`
}
