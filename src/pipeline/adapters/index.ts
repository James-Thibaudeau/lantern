import type { Ats } from '../schema'
import { ashby } from './ashby'
import { greenhouse } from './greenhouse'
import { lever } from './lever'
import type { SourceAdapter } from './types'

/** Adapters per ATS. Workday and BambooHR come later (build steps 4 and 8). */
export const adapters: Partial<Record<Ats, SourceAdapter>> = {
  greenhouse,
  lever,
  ashby,
}

export type { SourceAdapter, FetchContext, FetchResult, NormalizeResult } from './types'
