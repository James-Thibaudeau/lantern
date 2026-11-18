import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createServerFn } from '@tanstack/react-start'

import type { IngestReport } from '#/pipeline/ingest'
import type { Job } from '#/pipeline/schema'

/** What the jobs page needs per job: everything except the heavy HTML description. */
export type JobRow = Omit<Job, 'descriptionHtml'>

export interface JobsData {
  jobs: JobRow[]
  run: Pick<IngestReport, 'runId' | 'finishedAt' | 'totals'> | null
  /** Set when there's no ingest output to show yet. */
  missing: string | null
}

// Until local sync into SQLite exists (build step 7), the page reads the last
// `pnpm cli ingest` output straight from disk.
const OUT_DIR = process.env.LANTERN_OUT_DIR ?? 'out'

/**
 * A server function: this handler only ever runs on the server (so it can use node:fs),
 * and TanStack Start turns calls to it from the browser into an HTTP request.
 */
export const getJobs = createServerFn({ method: 'GET' }).handler(async (): Promise<JobsData> => {
  const jobsPath = join(OUT_DIR, 'jobs.jsonl')
  let jsonl: string
  try {
    jsonl = await readFile(jobsPath, 'utf8')
  } catch {
    return { jobs: [], run: null, missing: jobsPath }
  }

  const jobs = jsonl
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const { descriptionHtml: _html, ...row } = JSON.parse(line) as Job
      return row
    })
    .toSorted((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))

  let run: JobsData['run'] = null
  try {
    const report = JSON.parse(await readFile(join(OUT_DIR, 'report.json'), 'utf8')) as IngestReport
    run = { runId: report.runId, finishedAt: report.finishedAt, totals: report.totals }
  } catch {
    // The report is optional for this page.
  }

  return { jobs, run, missing: null }
})
