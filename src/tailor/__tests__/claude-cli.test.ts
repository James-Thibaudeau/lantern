import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import {
  callClaude,
  ClaudeCliError,
  childEnv,
  claudeArgs,
  mainModel,
  parseClaudeOutput,
} from '../claude-cli'

function cliJson(fields: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    modelUsage: {},
    ...fields,
  })
}

describe('claudeArgs', () => {
  it('builds print-mode args in order, with tools disabled and no --bare', () => {
    const args = claudeArgs({
      system: 'be brief',
      jsonSchema: { type: 'object' },
      model: 'opus',
      effort: 'medium',
    })
    expect(args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      '{"type":"object"}',
      '--tools',
      '',
      '--system-prompt',
      'be brief',
      '--model',
      'opus',
      '--effort',
      'medium',
      '--no-session-persistence',
      '--strict-mcp-config',
    ])
    expect(args).not.toContain('--bare')
  })
})

describe('childEnv', () => {
  it('drops API credentials, keeps everything else, and leaves the input alone', () => {
    const env = { ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', PATH: '/bin', HOME: '/h' }
    expect(childEnv(env)).toEqual({ PATH: '/bin', HOME: '/h' })
    expect(env.ANTHROPIC_API_KEY).toBe('k')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('t')
  })
})

describe('parseClaudeOutput', () => {
  it('reads structured_output, usage and model', () => {
    const parsed = parseClaudeOutput(
      cliJson({
        result: 'ignored',
        structured_output: { summary: 'hi' },
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 40,
        },
        modelUsage: { 'claude-opus-4-5': { inputTokens: 10 } },
      }),
    )
    expect(parsed).toEqual({
      output: { summary: 'hi' },
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheCreationTokens: 40 },
      model: 'claude-opus-4-5',
    })
  })

  it('defaults missing usage and model', () => {
    const parsed = parseClaudeOutput(JSON.stringify({ structured_output: [1] }))
    expect(parsed.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })
    expect(parsed.model).toBe('')
  })

  it('falls back to a JSON string in result', () => {
    expect(parseClaudeOutput(cliJson({ result: '{"a":1}' })).output).toEqual({ a: 1 })
  })

  it('unwraps a ```json fence in result', () => {
    const result = '```json\n{"a":[1,2]}\n```'
    expect(parseClaudeOutput(cliJson({ result })).output).toEqual({ a: [1, 2] })
  })

  it('explains how to sign in when the CLI is logged out', () => {
    const stdout = cliJson({
      is_error: true,
      result: 'Not logged in · Please run /login',
      terminal_reason: 'api_error',
    })
    expect(() => parseClaudeOutput(stdout)).toThrow(/isn't signed in. Run `claude auth login`/)
  })

  it('passes other CLI errors through', () => {
    const stdout = cliJson({ is_error: true, result: 'Overloaded' })
    expect(() => parseClaudeOutput(stdout)).toThrow('Claude CLI error: Overloaded')
    const noResult = cliJson({ is_error: true, terminal_reason: 'api_error' })
    expect(() => parseClaudeOutput(noResult)).toThrow('Claude CLI error: api_error')
  })

  it('rejects stdout that is not a JSON object', () => {
    expect(() => parseClaudeOutput('oops')).toThrow(ClaudeCliError)
    expect(() => parseClaudeOutput('oops')).toThrow("output that isn't JSON: oops")
    expect(() => parseClaudeOutput('[1]')).toThrow("isn't JSON")
  })

  it('rejects a result with no output', () => {
    expect(() => parseClaudeOutput(cliJson({}))).toThrow('Claude returned no structured output')
  })
})

describe('callClaude', () => {
  let dir: string

  async function fakeBin(name: string, body: string): Promise<string> {
    const path = join(dir, name)
    await writeFile(path, `#!/usr/bin/env node\n${body}\n`)
    await chmod(path, 0o755)
    return path
  }

  const base = { system: 's', prompt: 'tailor this', jsonSchema: { type: 'object' } }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lantern-claude-'))
  })

  it('sends the prompt on stdin and returns the parsed result', async () => {
    const bin = await fakeBin(
      'echo-claude',
      `let input = ''
process.stdin.on('data', (c) => (input += c))
process.stdin.on('end', () => {
  const args = process.argv.slice(2)
  process.stdout.write(JSON.stringify({
    type: 'result',
    is_error: false,
    structured_output: {
      prompt: input,
      model: args[args.indexOf('--model') + 1],
      hasApiKey: 'ANTHROPIC_API_KEY' in process.env,
    },
    usage: { input_tokens: 5, output_tokens: 7 },
    modelUsage: { 'claude-test': {} },
  }))
})`,
    )
    process.env.ANTHROPIC_API_KEY = 'should-not-leak'
    try {
      const res = await callClaude({ ...base, bin, model: 'sonnet' })
      expect(res.output).toEqual({ prompt: 'tailor this', model: 'sonnet', hasApiKey: false })
      expect(res.usage.inputTokens).toBe(5)
      expect(res.usage.outputTokens).toBe(7)
      expect(res.model).toBe('claude-test')
      expect(res.durationMs).toBeGreaterThanOrEqual(0)
    } finally {
      delete process.env.ANTHROPIC_API_KEY
    }
  })

  it('uses the JSON error even when the CLI exits non-zero', async () => {
    const bin = await fakeBin(
      'logged-out',
      `process.stdout.write(JSON.stringify({ is_error: true, result: 'Not logged in · Please run /login' }))
process.exit(1)`,
    )
    await expect(callClaude({ ...base, bin })).rejects.toThrow(/isn't signed in/)
  })

  it('reports the exit code and stderr when stdout is not JSON', async () => {
    const bin = await fakeBin('crash', `process.stderr.write('boom'); process.exit(3)`)
    await expect(callClaude({ ...base, bin })).rejects.toThrow('exited with code 3: boom')
  })

  it('times out and kills a hung CLI', async () => {
    const bin = await fakeBin('hang', 'setTimeout(() => {}, 60_000)')
    await expect(callClaude({ ...base, bin, timeoutMs: 300 })).rejects.toThrow(
      /Tailoring timed out after/,
    )
  })

  it('explains a missing binary', async () => {
    const bin = join(dir, 'does-not-exist')
    const err = await callClaude({ ...base, bin }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ClaudeCliError)
    expect(String(err)).toMatch(/wasn't found.*LANTERN_CLAUDE_BIN/)
  })
})

describe('mainModel', () => {
  it('picks the model that produced the most output, not the first listed', () => {
    expect(
      mainModel({
        'claude-haiku-5-5': { inputTokens: 300, outputTokens: 40 },
        'claude-opus-5-5': { inputTokens: 8000, outputTokens: 3200 },
      }),
    ).toBe('claude-opus-5-5')
    expect(mainModel({ only: {} })).toBe('only')
    expect(mainModel(undefined)).toBe('')
  })
})
