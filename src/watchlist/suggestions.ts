import { and, desc, eq, inArray } from 'drizzle-orm'

import type { Db } from '#/db'
import { suggestions, type SuggestionRow } from '#/db/schema'
import { CompanySchema, type Company } from '#/pipeline/schema'

import { boardKey, toCompany, type Detection } from './detect'

export interface SuggestionSource {
  source: 'hn' | 'url'
  sourceUrl?: string
  sourceText?: string
}

/**
 * Saves detections as suggestions. New boards are added as pending; pending ones get fresh
 * counts; accepted and rejected ones are left alone, so a rejected company never comes back.
 */
export function saveSuggestions(
  db: Db,
  items: (Detection & SuggestionSource)[],
  now: Date = new Date(),
): { added: number; refreshed: number } {
  let added = 0
  let refreshed = 0
  const at = now.toISOString()
  db.transaction((tx) => {
    for (const d of items) {
      const id = boardKey(d.board)
      const company = toCompany(d.board, d.name)
      const fresh = {
        name: d.name,
        company: company ? JSON.stringify(company) : null,
        supported: d.board.supported,
        note: d.board.note ?? null,
        via: d.via,
        source: d.source,
        sourceUrl: d.sourceUrl ?? null,
        sourceText: d.sourceText ?? null,
        openJobs: d.check?.openJobs ?? null,
        matchingJobs: d.check?.matchingJobs ?? null,
        checkError: d.check?.error ?? null,
        checkedAt: at,
      }
      const existing = tx
        .select({ status: suggestions.status })
        .from(suggestions)
        .where(eq(suggestions.id, id))
        .get()
      if (!existing) {
        tx.insert(suggestions)
          .values({ id, ats: d.board.ats, slug: d.board.slug, ...fresh, createdAt: at })
          .run()
        added++
      } else if (existing.status === 'pending') {
        tx.update(suggestions).set(fresh).where(eq(suggestions.id, id)).run()
        refreshed++
      }
    }
  })
  return { added, refreshed }
}

/** Board keys that should not be suggested again: already accepted or rejected. */
export function decidedKeys(db: Db): Set<string> {
  return new Set(
    db
      .select({ id: suggestions.id })
      .from(suggestions)
      .where(inArray(suggestions.status, ['accepted', 'rejected']))
      .all()
      .map((r) => r.id),
  )
}

export function listSuggestions(
  db: Db,
  status: SuggestionRow['status'] | 'all' = 'pending',
): SuggestionRow[] {
  const rows = db
    .select()
    .from(suggestions)
    .where(status === 'all' ? undefined : eq(suggestions.status, status))
    .orderBy(desc(suggestions.matchingJobs), desc(suggestions.openJobs))
    .all()
  // Boards we can't read yet go last.
  return rows.toSorted((a, b) => Number(b.supported) - Number(a.supported))
}

export function getSuggestion(db: Db, id: string): SuggestionRow | undefined {
  return db.select().from(suggestions).where(eq(suggestions.id, id)).get()
}

/** The companies.json entry a suggestion would add, or null if its board isn't supported. */
export function suggestionCompany(row: SuggestionRow): Company | null {
  if (!row.company) return null
  try {
    return CompanySchema.parse(JSON.parse(row.company))
  } catch {
    return null
  }
}

export function decide(
  db: Db,
  id: string,
  status: 'accepted' | 'rejected',
  now: Date = new Date(),
): boolean {
  const res = db
    .update(suggestions)
    .set({ status, decidedAt: now.toISOString() })
    .where(and(eq(suggestions.id, id), eq(suggestions.status, 'pending')))
    .run()
  return res.changes > 0
}
