import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isNull } from 'drizzle-orm'
import type { z } from 'zod'

import { jobs } from '#/db/schema'
import { CriteriaSchema, type Criteria } from '#/rank/criteria'
import { rankingPreview, type RankingPreview } from '#/rank/preview'
import { createScorer } from '#/rank/score'
import { SYSTEM_PROMPT } from '#/tailor/prompt'
import { ResumeSchema, type Resume } from '#/tailor/resume'
import { ConfigConflictError, type EditableFile } from '#/watchlist/runner-config'

import {
  configStoreForApp,
  getDb,
  rankingStatus,
  reloadCriteria,
  reloadPrompt,
  reloadResume,
} from './db'

// Server-only logic for the resume and criteria editors. The server functions in
// ./config-editor.ts call into this only from inside their handlers, so file and SQLite access
// stays out of the browser bundle.

export interface Editable<T> {
  value: T
  /** The version it was read at; null when the file doesn't exist yet (value is a starter). */
  version: string | null
  /** Where it's saved, e.g. "you/lantern-runner (GitHub)". */
  where: string
}

export type LoadResult<T> = ({ ok: true } & Editable<T>) | { ok: false; message: string }

export type SaveResult =
  | { ok: true; version: string; message: string }
  | { ok: false; conflict: boolean; message: string; issues?: string[] }

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Field-by-field messages, e.g. "experience.2.bullets.0.text: Too small". */
export function issueList(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || '(top)'}: ${i.message}`)
}

async function starter<T>(file: EditableFile, schema: z.ZodType<T>): Promise<T> {
  const name = file.replace('.json', '.example.json')
  const text = await readFile(join(process.cwd(), 'runner-template', 'config', name), 'utf8')
  return schema.parse(JSON.parse(text))
}

async function load<T>(file: EditableFile, schema: z.ZodType<T>): Promise<LoadResult<T>> {
  try {
    const store = await configStoreForApp()
    const current = await store.readConfigFile(file)
    if (!current) {
      return { ok: true, value: await starter(file, schema), version: null, where: store.describe }
    }
    let raw: unknown
    try {
      raw = JSON.parse(current.text)
    } catch (err) {
      return {
        ok: false,
        message: `${file} isn't valid JSON: ${errorMessage(err)}. Fix it by hand first.`,
      }
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return {
        ok: false,
        message: `${file} doesn't match the expected format, so it can't be edited here:\n${issueList(parsed.error).join('\n')}`,
      }
    }
    return { ok: true, value: parsed.data, version: current.version, where: store.describe }
  } catch (err) {
    return { ok: false, message: `Couldn't read ${file}: ${errorMessage(err)}` }
  }
}

async function save<T>(
  file: EditableFile,
  schema: z.ZodType<T>,
  value: unknown,
  version: string | null,
  message: string,
): Promise<SaveResult> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      conflict: false,
      message: `Not saved: fix the fields below first.`,
      issues: issueList(parsed.error),
    }
  }
  try {
    const store = await configStoreForApp()
    const text = `${JSON.stringify(parsed.data, null, 2)}\n`
    const next = await store.writeConfigFile(file, text, version, message)
    return { ok: true, version: next, message: `Saved to ${store.describe}.` }
  } catch (err) {
    return { ok: false, conflict: err instanceof ConfigConflictError, message: errorMessage(err) }
  }
}

export const loadResume = (): Promise<LoadResult<Resume>> => load('resume.json', ResumeSchema)

export async function saveResume(value: unknown, version: string | null): Promise<SaveResult> {
  const r = await save('resume.json', ResumeSchema, value, version, 'Update resume (via Lantern)')
  if (r.ok) await reloadResume() // tailoring uses it straight away
  return r
}

export const loadCriteria = (): Promise<LoadResult<Criteria>> =>
  load('criteria.json', CriteriaSchema)

export async function saveCriteria(value: unknown, version: string | null): Promise<SaveResult> {
  const r = await save(
    'criteria.json',
    CriteriaSchema,
    value,
    version,
    'Update ranking criteria (via Lantern)',
  )
  if (r.ok) await reloadCriteria() // /jobs re-ranks on its next load
  return r
}

/** How these (unsaved) criteria would rank your open jobs, compared with the saved ones. */
export function previewRanking(
  value: unknown,
): { ok: true; preview: RankingPreview } | { ok: false; issues: string[] } {
  const parsed = CriteriaSchema.safeParse(value)
  if (!parsed.success) return { ok: false, issues: issueList(parsed.error) }
  const open = getDb().select().from(jobs).where(isNull(jobs.closedAt)).all()
  return {
    ok: true,
    preview: rankingPreview(open, createScorer(parsed.data), rankingStatus().score),
  }
}

// ---------- The tailoring prompt (config/tailoring-prompt.md) ----------

/** Longest prompt accepted; the resume and posting are sent on top of it. */
export const MAX_PROMPT_LENGTH = 20_000

export type PromptLoad =
  | ({ ok: true; builtIn: string } & Editable<string>)
  | { ok: false; message: string }

export async function loadPrompt(): Promise<PromptLoad> {
  try {
    const store = await configStoreForApp()
    const file = await store.readConfigFile('tailoring-prompt.md')
    return {
      ok: true,
      // No file yet: you start from the built-in prompt, and saving creates the file.
      value: file && file.text.trim() ? file.text.trimEnd() : SYSTEM_PROMPT,
      version: file?.version ?? null,
      where: store.describe,
      builtIn: SYSTEM_PROMPT,
    }
  } catch (err) {
    return { ok: false, message: `Couldn't read tailoring-prompt.md: ${errorMessage(err)}` }
  }
}

export async function savePrompt(text: string, version: string | null): Promise<SaveResult> {
  const trimmed = text.trim()
  if (!trimmed) {
    return { ok: false, conflict: false, message: 'Not saved: the prompt is empty.' }
  }
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    return {
      ok: false,
      conflict: false,
      message: `Not saved: the prompt is ${trimmed.length.toLocaleString()} characters; keep it under ${MAX_PROMPT_LENGTH.toLocaleString()}.`,
    }
  }
  try {
    const store = await configStoreForApp()
    const next = await store.writeConfigFile(
      'tailoring-prompt.md',
      `${trimmed}\n`,
      version,
      'Update tailoring prompt (via Lantern)',
    )
    await reloadPrompt()
    return {
      ok: true,
      version: next,
      message: `Saved to ${store.describe}. New tailorings use it now.`,
    }
  } catch (err) {
    return { ok: false, conflict: err instanceof ConfigConflictError, message: errorMessage(err) }
  }
}
