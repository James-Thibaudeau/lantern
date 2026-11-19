import { spawn } from 'node:child_process'

import { z } from 'zod'

/**
 * Runs the Claude Code CLI in print mode as a child process, so tailoring bills to the
 * user's Claude subscription instead of an API key.
 */
export interface ClaudeCallOptions {
  /** Passed as --system-prompt. */
  system: string
  /** Written to the child's stdin, which avoids argv length limits for long job descriptions. */
  prompt: string
  /** JSON Schema the CLI enforces on the reply. */
  jsonSchema: object
  /** Defaults to LANTERN_TAILOR_MODEL, then 'opus'. */
  model?: string
  /** Defaults to LANTERN_TAILOR_EFFORT, then 'medium'. */
  effort?: string
  /** Defaults to 180 s. */
  timeoutMs?: number
  /** Defaults to LANTERN_CLAUDE_BIN, then 'claude' on PATH. */
  bin?: string
}

export interface ClaudeUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export interface ClaudeCallResult {
  output: unknown
  usage: ClaudeUsage
  /** The model the CLI reports it used, or '' when it doesn't say. */
  model: string
  durationMs: number
}

/** Every way a CLI call can fail, with a message fit to show the user. */
export class ClaudeCliError extends Error {
  override name = 'ClaudeCliError'
}

const DEFAULT_TIMEOUT_MS = 180_000

/**
 * CLI arguments for one structured call. No --bare: bare mode only accepts API keys and
 * ignores the subscription login. `--tools ''` disables every tool, so the model can only answer.
 */
export function claudeArgs(
  o: Required<Pick<ClaudeCallOptions, 'system' | 'jsonSchema' | 'model' | 'effort'>>,
): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(o.jsonSchema),
    '--tools',
    '',
    '--system-prompt',
    o.system,
    '--model',
    o.model,
    '--effort',
    o.effort,
    '--no-session-persistence',
    '--strict-mcp-config',
  ]
}

/** The child's environment, minus API credentials so the CLI never falls back to API billing. */
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env }
  delete copy.ANTHROPIC_API_KEY
  delete copy.ANTHROPIC_AUTH_TOKEN
  return copy
}

const tokens = z.number().optional().catch(undefined)

// Only the fields we read; the CLI adds more over time.
const CliResult = z.looseObject({
  is_error: z.boolean().optional().catch(undefined),
  result: z.unknown().optional(),
  terminal_reason: z.string().nullish().catch(undefined),
  structured_output: z.unknown().optional(),
  usage: z
    .looseObject({
      input_tokens: tokens,
      output_tokens: tokens,
      cache_read_input_tokens: tokens,
      cache_creation_input_tokens: tokens,
    })
    .nullish()
    .catch(undefined),
  modelUsage: z.record(z.string(), z.unknown()).nullish().catch(undefined),
})

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value: unknown = JSON.parse(text)
    return { ok: true, value }
  } catch {
    return { ok: false }
  }
}

/** Models sometimes wrap JSON in a ```json fence even when asked not to. */
function unfence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text)
  return fenced ? fenced[1] : text
}

/** Turns the CLI's `--output-format json` stdout into a result, or throws ClaudeCliError. */
export function parseClaudeOutput(stdout: string): Omit<ClaudeCallResult, 'durationMs'> {
  const json = tryParseJson(stdout.trim())
  const parsed = json.ok ? CliResult.safeParse(json.value) : undefined
  if (!parsed?.success) {
    throw new ClaudeCliError(`Claude CLI returned output that isn't JSON: ${stdout.slice(0, 200)}`)
  }
  const r = parsed.data

  if (r.is_error === true) {
    const message = typeof r.result === 'string' ? r.result : undefined
    if (message && (message.includes('Not logged in') || message.includes('/login'))) {
      throw new ClaudeCliError(
        "The claude CLI isn't signed in. Run `claude auth login` with your Claude subscription, then try again.",
      )
    }
    throw new ClaudeCliError(`Claude CLI error: ${message ?? r.terminal_reason ?? 'unknown'}`)
  }

  let output: unknown
  if (r.structured_output !== undefined && r.structured_output !== null) {
    output = r.structured_output
  } else if (typeof r.result === 'string') {
    const inner = tryParseJson(unfence(r.result))
    if (!inner.ok) {
      throw new ClaudeCliError(`Claude's reply wasn't valid JSON: ${r.result.slice(0, 200)}`)
    }
    output = inner.value
  } else {
    throw new ClaudeCliError('Claude returned no structured output')
  }

  return {
    output,
    usage: {
      inputTokens: r.usage?.input_tokens ?? 0,
      outputTokens: r.usage?.output_tokens ?? 0,
      cacheReadTokens: r.usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: r.usage?.cache_creation_input_tokens ?? 0,
    },
    model: Object.keys(r.modelUsage ?? {})[0] ?? '',
  }
}

/**
 * Runs one structured call. A non-zero exit isn't fatal on its own: the CLI exits 1 on API
 * errors but still prints its JSON, which carries the more useful message.
 */
export async function callClaude(o: ClaudeCallOptions): Promise<ClaudeCallResult> {
  const bin = o.bin ?? process.env.LANTERN_CLAUDE_BIN ?? 'claude'
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const args = claudeArgs({
    system: o.system,
    jsonSchema: o.jsonSchema,
    model: o.model ?? process.env.LANTERN_TAILOR_MODEL ?? 'opus',
    effort: o.effort ?? process.env.LANTERN_TAILOR_EFFORT ?? 'medium',
  })
  const started = performance.now()

  const { code, stdout, stderr } = await new Promise<{
    code: number | null
    stdout: string
    stderr: string
  }>((resolve, reject) => {
    const child = spawn(bin, args, { env: childEnv(process.env), stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (out += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (err += chunk))
    child.on('error', (e: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          e.code === 'ENOENT'
            ? new ClaudeCliError(
                `The Claude Code CLI wasn't found (tried "${bin}"). Install Claude Code, or set LANTERN_CLAUDE_BIN in .env to its path.`,
              )
            : new ClaudeCliError(`Couldn't run the Claude CLI: ${e.message}`),
        ),
      )
    })
    child.on('close', (exitCode) => {
      finish(() => {
        if (timedOut) {
          reject(new ClaudeCliError(`Tailoring timed out after ${timeoutMs / 1000} s`))
        } else {
          resolve({ code: exitCode, stdout: out, stderr: err })
        }
      })
    })

    // A child that exits without reading stdin (or never starts) makes this write fail with
    // EPIPE; the 'error'/'close' handlers above report the real problem.
    child.stdin.on('error', () => {})
    child.stdin.end(o.prompt)
  })

  const durationMs = Math.round(performance.now() - started)
  if (!tryParseJson(stdout.trim()).ok) {
    throw new ClaudeCliError(
      `Claude CLI exited with code ${code ?? 'unknown'}: ${stderr.slice(0, 500) || '(no stderr)'}`,
    )
  }
  return { ...parseClaudeOutput(stdout), durationMs }
}
