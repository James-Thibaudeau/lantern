import type { Ats } from '../schema'
import { ashby } from './ashby'
import { greenhouse } from './greenhouse'
import { lever } from './lever'
import { recruitee } from './recruitee'
import type { SourceAdapter } from './types'
import { workable } from './workable'

/**
 * Adapters per ATS. Workday's career sites block scripted clients, and BambooHR isn't built
 * yet, so companies on either are skipped.
 */
export const adapters: Partial<Record<Ats, SourceAdapter>> = {
  greenhouse,
  lever,
  ashby,
  workable,
  recruitee,
}

export type { SourceAdapter, FetchContext, FetchResult, NormalizeResult } from './types'
