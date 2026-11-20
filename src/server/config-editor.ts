import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import type { Criteria } from '#/rank/criteria'
import type { Resume } from '#/tailor/resume'

import {
  loadCriteria,
  loadPrompt,
  loadResume,
  previewRanking,
  saveCriteria,
  savePrompt,
  saveResume,
  type LoadResult,
  type PromptLoad,
  type SaveResult,
} from './config-editing'
import { startupSync } from './db'
import { jobsToTry, tryPrompt, type TryResult } from './tailoring'

// Server functions for the resume and criteria editors; the logic is in ./config-editing.ts.

export type { LoadResult, PromptLoad, SaveResult } from './config-editing'
export type { TryResult } from './tailoring'
export type { RankingPreview } from '#/rank/preview'

const SaveInput = z.object({ value: z.unknown(), version: z.string().nullable() })

export const getResumeForEdit = createServerFn({ method: 'GET' }).handler(
  (): Promise<LoadResult<Resume>> => loadResume(),
)

export const saveResumeFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => SaveInput.parse(input))
  .handler(({ data }): Promise<SaveResult> => saveResume(data.value, data.version))

export const getCriteriaForEdit = createServerFn({ method: 'GET' }).handler(
  (): Promise<LoadResult<Criteria>> => loadCriteria(),
)

export const saveCriteriaFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => SaveInput.parse(input))
  .handler(({ data }): Promise<SaveResult> => saveCriteria(data.value, data.version))

export const previewRankingFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({ value: z.unknown() }).parse(input))
  .handler(async ({ data }) => {
    await startupSync() // the saved criteria are read on the first sync
    return previewRanking(data.value)
  })

export const getPromptForEdit = createServerFn({ method: 'GET' }).handler((): Promise<PromptLoad> =>
  loadPrompt(),
)

export const savePromptFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z.object({ text: z.string(), version: z.string().nullable() }).parse(input),
  )
  .handler(({ data }): Promise<SaveResult> => savePrompt(data.text, data.version))

/** Open jobs to try a prompt on, best-ranked first. */
export const getJobsToTry = createServerFn({ method: 'GET' }).handler(async () => {
  await startupSync() // ranking criteria are read on the first sync
  return jobsToTry()
})

/** Runs an unsaved prompt against one job (about 25 s). Nothing is saved. */
export const tryPromptFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z.object({ jobId: z.string().min(1), text: z.string().min(1).max(20_000) }).parse(input),
  )
  .handler(({ data }): Promise<TryResult> => tryPrompt(data.jobId, data.text))
