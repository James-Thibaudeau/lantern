import { z } from 'zod'

import { sha256 } from '#/pipeline/text'

import { checkTailoring, type Issue } from './check'
import { callClaude, type ClaudeUsage } from './claude-cli'
import { SYSTEM_PROMPT, userPrompt, type PostingInput } from './prompt'
import type { Resume } from './resume'
import { TailoringSchema, tailoringJsonSchema, type Tailoring } from './schema'

// One tailoring: ask the model, validate the shape, then check it against the master resume.

/** Whatever produces a tailoring. Today that's `claude -p`; an API SDK version could slot in. */
export interface TailorModel {
  run(input: { system: string; prompt: string; jsonSchema: object }): Promise<{
    output: unknown
    usage: ClaudeUsage | null
    model: string
  }>
}

export const claudeCliModel: TailorModel = {
  async run(input) {
    const r = await callClaude(input)
    return { output: r.output, usage: r.usage, model: r.model || 'claude-cli' }
  },
}

export const ChecksSchema = z.object({
  errors: z.array(z.object({ key: z.string().optional(), message: z.string() })),
  warnings: z.array(z.object({ key: z.string().optional(), message: z.string() })),
  fitNotes: TailoringSchema.shape.fitNotes,
})

export interface TailorResult {
  tailoring: Tailoring
  checks: { errors: Issue[]; warnings: Issue[] }
  usage: ClaudeUsage | null
  model: string
  resumeHash: string
  promptHash: string
  /** The request sent with the prompt: your resume and the posting. */
  request: string
}

/** Identifies a version of the master resume, to spot tailorings made from an older one. */
export const resumeHash = (r: Resume) => sha256(JSON.stringify(r), 16)

/** Identifies a version of the tailoring prompt. Whitespace at the ends doesn't count. */
export const promptHash = (system: string) => sha256(system.trim(), 16)

/**
 * Tailors the resume to the posting. `system` is the tailoring prompt: config/tailoring-prompt.md
 * when you've edited it, else the built-in one. Whatever it says, the reply is checked against
 * the resume before anything is kept.
 */
export async function tailorResume(
  resume: Resume,
  posting: PostingInput,
  model: TailorModel = claudeCliModel,
  system: string = SYSTEM_PROMPT,
): Promise<TailorResult> {
  const request = userPrompt(resume, posting)
  const reply = await model.run({
    system: system.trim(),
    prompt: request,
    jsonSchema: tailoringJsonSchema(),
  })
  const parsed = TailoringSchema.safeParse(reply.output)
  if (!parsed.success) {
    throw new Error(
      `Claude's reply didn't match the expected shape:\n${z.prettifyError(parsed.error)}`,
    )
  }
  const { tailoring, errors, warnings } = checkTailoring(resume, parsed.data)
  return {
    tailoring,
    checks: { errors, warnings },
    usage: reply.usage,
    model: reply.model,
    resumeHash: resumeHash(resume),
    promptHash: promptHash(system),
    request,
  }
}
