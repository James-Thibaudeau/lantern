import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { LocalConfigStore } from '../../watchlist/runner-config'
import { loadConfig } from '../config'
import { initRunner } from '../init-runner'

const run = promisify(execFile)

// CI machines have no git identity; initRunner's commit needs one.
process.env.GIT_AUTHOR_NAME ??= 'Lantern Test'
process.env.GIT_AUTHOR_EMAIL ??= 'test@example.com'
process.env.GIT_COMMITTER_NAME ??= 'Lantern Test'
process.env.GIT_COMMITTER_EMAIL ??= 'test@example.com'

describe('runner-template', () => {
  it('has example configs that load', async () => {
    // loadConfig wants companies.json / profiles.json, so check the examples via a copy.
    const dir = join(await mkdtemp(join(tmpdir(), 'lantern-init-')), 'runner')
    await initRunner({ name: 'runner', dir, localOnly: true, log: () => {} })
    const config = await loadConfig(join(dir, 'config'))
    expect(config.companies.length).toBeGreaterThan(0)
    expect(config.profiles.some((p) => p.enabled)).toBe(true)
    const criteria = await new LocalConfigStore(join(dir, 'config')).readCriteria()
    expect(criteria?.signals.length).toBeGreaterThan(0)
  })

  it('pins the runner workflow to a matching tag and lantern_ref', async () => {
    const yml = await readFile(
      new URL('../../../runner-template/.github/workflows/run.yml', import.meta.url),
      'utf8',
    )
    const tag = /ingest\.yml@(v\d+)/.exec(yml)?.[1]
    expect(tag).toBeDefined()
    expect(yml).toContain(`lantern_ref: ${tag}`)
  })
})

describe('initRunner (local only)', () => {
  it('copies the template, renames example configs and commits', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'lantern-init-')), 'my-runner')
    const lines: string[] = []
    const result = await initRunner({
      name: 'my-runner',
      dir,
      localOnly: true,
      log: (l) => lines.push(l),
    })

    expect(result).toEqual({ dir })
    expect((await readdir(join(dir, 'config'))).toSorted()).toEqual([
      'companies.json',
      'criteria.json',
      'profiles.json',
      'resume.json',
    ])
    expect(await readdir(join(dir, '.github', 'workflows'))).toEqual(['run.yml'])
    const { stdout } = await run('git', ['log', '--format=%s'], { cwd: dir })
    expect(stdout.trim()).toBe('Initial Lantern runner')
  })

  it('refuses an existing folder and a bad repo name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lantern-init-'))
    await expect(initRunner({ name: 'x', dir, localOnly: true })).rejects.toThrow('already exists')
    await expect(initRunner({ name: 'bad name', localOnly: true })).rejects.toThrow('valid')
  })
})
