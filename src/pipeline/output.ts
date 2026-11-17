import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IngestResult } from './ingest'

export interface WrittenFiles {
  jobs: string
  open: string
  report: string
}

/** Writes the three files the workflow uploads as the run's artifact. */
export async function writeOutputs(outDir: string, result: IngestResult): Promise<WrittenFiles> {
  await mkdir(outDir, { recursive: true })
  const files = {
    jobs: join(outDir, 'jobs.jsonl'),
    open: join(outDir, 'open.json'),
    report: join(outDir, 'report.json'),
  }
  const jsonl = result.kept.map((j) => JSON.stringify(j)).join('\n')
  await writeFile(files.jobs, jsonl ? `${jsonl}\n` : '')
  await writeFile(files.open, `${JSON.stringify(result.open, null, 2)}\n`)
  await writeFile(files.report, `${JSON.stringify(result.report, null, 2)}\n`)
  return files
}
