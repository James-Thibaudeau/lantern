import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { startupSync } from './db'
import {
  decide,
  startTailoring,
  tailoringData,
  type TailorOutcome,
  type TailoringData,
} from './tailoring'

// Server functions for tailoring. The logic lives in ./tailoring.ts and is only called from
// inside handlers, which TanStack Start strips from the browser bundle.

export type { TailoringData, TailoringView } from './tailoring'

export const getTailoring = createServerFn({ method: 'GET' })
  .validator((input: unknown) =>
    z.object({ jobId: z.string().min(1), id: z.number().int().optional() }).parse(input),
  )
  .handler(async ({ data: input }): Promise<TailoringData> => {
    await startupSync() // reads resume.json the first time
    return tailoringData(input.jobId, input.id)
  })

/** Tailor resume. Takes about a minute; one at a time, and a repeat click joins the running one. */
export const tailorJob = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({ jobId: z.string().min(1) }).parse(input))
  .handler(({ data: input }): Promise<TailorOutcome & { data: TailoringData }> =>
    startTailoring(input.jobId),
  )

/** Accept or revert one change. */
export const setTailoringDecision = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .object({ id: z.number().int(), change: z.string().min(1), accepted: z.boolean() })
      .parse(input),
  )
  .handler(({ data: input }): TailoringData | null =>
    decide(input.id, input.change, input.accepted),
  )
