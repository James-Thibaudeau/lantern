import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SYSTEM_PROMPT } from '#/tailor/prompt'

import { loadPrompt, MAX_PROMPT_LENGTH, savePrompt } from '../config-editing'
import { promptStatus } from '../db'

// Saving the tailoring prompt to a local config folder (LANTERN_CONFIG_DIR).

describe('tailoring prompt', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lantern-prompt-'))
    process.env.LANTERN_CONFIG_DIR = dir
  })
  afterEach(async () => {
    delete process.env.LANTERN_CONFIG_DIR
    await rm(dir, { recursive: true, force: true })
  })

  it('starts from the built-in prompt, then saves and uses yours', async () => {
    expect(await loadPrompt()).toMatchObject({ ok: true, value: SYSTEM_PROMPT, version: null })

    expect((await savePrompt('  Keep it short.  ', null)).ok).toBe(true)
    expect(await readFile(join(dir, 'tailoring-prompt.md'), 'utf8')).toBe('Keep it short.\n')
    expect(promptStatus()).toMatchObject({ text: 'Keep it short.\n', custom: true })
    expect(await loadPrompt()).toMatchObject({ ok: true, value: 'Keep it short.' })
  })

  it('rejects an empty or oversized prompt, and a stale version', async () => {
    expect(await savePrompt('   ', null)).toMatchObject({
      ok: false,
      message: expect.stringContaining('empty'),
    })
    expect(await savePrompt('x'.repeat(MAX_PROMPT_LENGTH + 1), null)).toMatchObject({ ok: false })
    await savePrompt('One', null)
    expect(await savePrompt('Two', null)).toMatchObject({ ok: false, conflict: true })
  })
})
