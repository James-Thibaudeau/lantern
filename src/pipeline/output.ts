import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { IngestResult } from './ingest'
import type { Job } from './schema'

export interface WrittenFiles {
  jobs: string
  open: string
  report: string
}

/**
 * Writes the three files the workflow uploads as the run's artifact.
 * `emit` is what goes in jobs.jsonl: every kept job, or only new and updated ones when
 * seen-jobs state is in use. open.json always lists every kept job.
 */
export async function writeOutputs(
  outDir: string,
  result: IngestResult,
  emit: Job[] = result.kept,
): Promise<WrittenFiles> {
  await mkdir(outDir, { recursive: true })
  const files = {
    jobs: join(outDir, 'jobs.jsonl'),
    open: join(outDir, 'open.json'),
    report: join(outDir, 'report.json'),
  }
  const jsonl = emit.map((j) => JSON.stringify(j)).join('\n')
  await writeFile(files.jobs, jsonl ? `${jsonl}\n` : '')
  await writeFile(files.open, `${JSON.stringify(result.open, null, 2)}\n`)
  await writeFile(files.report, `${JSON.stringify(result.report, null, 2)}\n`)
  return files
}
