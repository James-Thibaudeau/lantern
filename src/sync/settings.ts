import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

import { GitHubRunner } from './github'

let envLoaded = false

/** Loads .env from the repo root once (Node's built-in loader; real env vars win). */
export function loadLocalEnv(): void {
  if (envLoaded) return
  envLoaded = true
  if (existsSync('.env')) process.loadEnvFile('.env')
}

export interface RunnerSettings {
  repo: string
  token: string
  /** Where the token came from, for messages. */
  tokenSource: 'LANTERN_GITHUB_TOKEN' | 'gh CLI'
}

/**
 * Reads the runner repo and GitHub token. The token should be a fine-grained personal
 * access token for the runner repo only (LANTERN_GITHUB_TOKEN in .env). If that's not
 * set, the GitHub CLI's own login is used as a fallback for local development.
 */
export async function runnerSettings(): Promise<RunnerSettings> {
  loadLocalEnv()
  const repo = process.env.LANTERN_RUNNER_REPO?.trim()
  if (!repo) {
    throw new Error(
      'Set LANTERN_RUNNER_REPO in .env to your private runner repo, e.g. you/lantern-runner',
    )
  }
  const token = process.env.LANTERN_GITHUB_TOKEN?.trim()
  if (token) return { repo, token, tokenSource: 'LANTERN_GITHUB_TOKEN' }

  try {
    const { stdout } = await promisify(execFile)('gh', ['auth', 'token'])
    const ghToken = stdout.trim()
    if (ghToken) return { repo, token: ghToken, tokenSource: 'gh CLI' }
  } catch {
    // fall through
  }
  throw new Error(
    'No GitHub token: set LANTERN_GITHUB_TOKEN in .env (a fine-grained token for the runner ' +
      'repo with Actions read/write), or sign in with `gh auth login`.',
  )
}

export async function githubRunner(): Promise<{ runner: GitHubRunner; settings: RunnerSettings }> {
  const settings = await runnerSettings()
  return { runner: new GitHubRunner(settings), settings }
}
