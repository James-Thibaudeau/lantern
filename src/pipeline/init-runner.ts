import { execFile } from 'node:child_process'
import { access, cp, readdir, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** runner-template/ at the repo root, found relative to this file (src/pipeline/). */
export const TEMPLATE_DIR = fileURLToPath(new URL('../../runner-template', import.meta.url))

export interface InitRunnerOptions {
  /** GitHub repo name, e.g. "my-lantern-runner". */
  name: string
  /** Where to create it. Default: a sibling folder of the current directory. */
  dir?: string
  /** Skip creating and pushing the GitHub repo. */
  localOnly?: boolean
  templateDir?: string
  log?: (line: string) => void
}

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Creates a private runner repo from runner-template/: copies it, turns
 * *.example.json configs into real ones, commits, and (unless localOnly) creates the
 * private GitHub repo with `gh` and pushes.
 */
export async function initRunner(opts: InitRunnerOptions): Promise<{ dir: string; url?: string }> {
  const log = opts.log ?? console.log
  if (!REPO_NAME.test(opts.name)) {
    throw new Error(`"${opts.name}" isn't a valid GitHub repo name`)
  }
  const dir = resolve(opts.dir ?? join('..', opts.name))
  if (await exists(dir)) throw new Error(`${dir} already exists`)

  if (!opts.localOnly) {
    try {
      await run('gh', ['auth', 'status'])
    } catch (err) {
      throw new Error('The GitHub CLI (gh) must be installed and signed in: run `gh auth login`', {
        cause: err,
      })
    }
  }

  await cp(opts.templateDir ?? TEMPLATE_DIR, dir, { recursive: true })
  const configDir = join(dir, 'config')
  for (const file of await readdir(configDir)) {
    if (file.endsWith('.example.json')) {
      // oxlint-disable-next-line no-await-in-loop -- two small files, order doesn't matter
      await rename(join(configDir, file), join(configDir, file.replace('.example.json', '.json')))
    }
  }
  log(`Created ${dir}`)

  const git = (...args: string[]) => run('git', args, { cwd: dir })
  await git('init', '-q', '-b', 'main')
  await git('add', '-A')
  await git('commit', '-q', '-m', 'Initial Lantern runner')
  log('Committed the initial files')

  if (opts.localOnly) return { dir }

  try {
    await run(
      'gh',
      ['repo', 'create', opts.name, '--private', '--source', dir, '--remote', 'origin', '--push'],
      { cwd: dir },
    )
  } catch (err) {
    const stderr =
      typeof err === 'object' && err !== null && 'stderr' in err && typeof err.stderr === 'string'
        ? err.stderr
        : ''
    const hint = /workflow/i.test(stderr)
      ? '\nYour gh token needs the workflow scope to push workflow files: gh auth refresh -s workflow'
      : ''
    throw new Error(`Creating or pushing the GitHub repo failed:\n${stderr.trim()}${hint}`, {
      cause: err,
    })
  }
  const { stdout } = await run('gh', ['repo', 'view', '--json', 'url', '--jq', '.url'], {
    cwd: dir,
  })
  const url = stdout.trim()
  log(`Pushed to ${url} (private)`)
  return { dir, url }
}
