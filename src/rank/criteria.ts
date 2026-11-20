import { z } from 'zod'

import { parseJsonFile } from '#/pipeline/json-file'
import { EligibilitySchema } from '#/pipeline/schema'

// criteria.json lives in the private runner repo, next to profiles.json. Objects are strict,
// so a typo like "weigth" is reported instead of silently ignored.

/** Where a phrase is looked for. `any` is the title or the description. */
const ScopeSchema = z.enum(['title', 'description', 'location', 'any']).default('any')
export type Scope = z.infer<typeof ScopeSchema>

const phrases = z.array(z.string().trim().min(1)).min(1)

export const SignalSchema = z.strictObject({
  label: z.string().min(1),
  phrases,
  /** Points added when any phrase matches (counted once). Negative to push a job down. */
  weight: z.number(),
  in: ScopeSchema,
})
export type Signal = z.infer<typeof SignalSchema>

export const DealbreakerSchema = z.strictObject({
  label: z.string().min(1),
  phrases,
  in: ScopeSchema,
})
export type Dealbreaker = z.infer<typeof DealbreakerSchema>

export const CriteriaSchema = z.strictObject({
  signals: z.array(SignalSchema).default([]),
  /** A match sinks the job to the bottom of the list, whatever its score. */
  dealbreakers: z.array(DealbreakerSchema).default([]),
  /** Points per location eligibility; ones not listed score 0. */
  eligibility: z.partialRecord(EligibilitySchema, z.number()).default({}),
  /** Applies only to annual salaries in this currency; a missing salary is neutral. */
  salary: z
    .strictObject({
      currency: z
        .string()
        .length(3)
        .transform((c) => c.toUpperCase()),
      floor: z.number().positive(),
      /** Points (0 or less) when the top of the posted range is below the floor. */
      belowFloor: z.number().max(0),
    })
    .optional(),
})
export type Criteria = z.infer<typeof CriteriaSchema>

export function parseCriteria(label: string, text: string): Criteria {
  return parseJsonFile(label, text, CriteriaSchema)
}
