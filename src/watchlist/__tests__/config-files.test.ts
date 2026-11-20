import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GitHubRunner } from '../../sync/github'
import { ConfigConflictError, GitHubConfigStore, LocalConfigStore } from '../runner-config'

// Reading and saving the files the app edits (resume.json, criteria.json).

describe('LocalConfigStore config files', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lantern-config-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('creates a missing file, then saves over the version it read', async () => {
    const store = new LocalConfigStore(dir)
    await expect(store.readConfigFile('criteria.json')).resolves.toBeNull()
    const v1 = await store.writeConfigFile('criteria.json', '{"signals":[]}\n', null, 'm')
    const read = await store.readConfigFile('criteria.json')
    expect(read).toEqual({ text: '{"signals":[]}\n', version: v1 })
    const v2 = await store.writeConfigFile('criteria.json', '{}\n', v1, 'm')
    expect(v2).not.toBe(v1)
  })

  it('refuses to save over a file that changed on disk since it was read', async () => {
    const store = new LocalConfigStore(dir)
    await writeFile(join(dir, 'resume.json'), 'one')
    const read = await store.readConfigFile('resume.json')
    await writeFile(join(dir, 'resume.json'), 'edited elsewhere')
    await expect(
      store.writeConfigFile('resume.json', 'mine', read!.version, 'm'),
    ).rejects.toBeInstanceOf(ConfigConflictError)
    // Creating a file that someone else just created is a conflict too.
    await expect(store.writeConfigFile('criteria.json', 'x', null, 'm')).resolves.toBeTruthy()
    await expect(store.writeConfigFile('criteria.json', 'y', null, 'm')).rejects.toThrow('changed')
  })
})

function github(respond: (url: string, init: RequestInit) => Response) {
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) =>
    respond(input instanceof Request ? input.url : input.toString(), init ?? {}),
  )
  const runner = new GitHubRunner({ token: 't0k', repo: 'me/runner', fetchImpl })
  return { store: new GitHubConfigStore(runner, 'me/runner'), fetchImpl }
}

const API = 'https://api.github.com/repos/me/runner/contents/config/resume.json'

/** The JSON body a PUT sent. */
function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
}

describe('GitHubConfigStore config files', () => {
  it('reads the text and sha', async () => {
    const { store } = github(() =>
      Response.json({
        content: Buffer.from('hello').toString('base64'),
        encoding: 'base64',
        sha: 's1',
      }),
    )
    await expect(store.readConfigFile('resume.json')).resolves.toEqual({
      text: 'hello',
      version: 's1',
    })
  })

  it('commits with the sha it read and returns the new one', async () => {
    const { store, fetchImpl } = github(() => Response.json({ content: { sha: 's2' } }))
    await expect(store.writeConfigFile('resume.json', 'new', 's1', 'Update resume')).resolves.toBe(
      's2',
    )
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(API)
    const body = bodyOf(init)
    expect(body).toMatchObject({ message: 'Update resume', sha: 's1', branch: 'main' })
    expect(Buffer.from(String(body.content), 'base64').toString()).toBe('new')
  })

  it('creates a file without a sha', async () => {
    const { store, fetchImpl } = github(() => Response.json({ content: { sha: 's1' } }))
    await store.writeConfigFile('resume.json', 'new', null, 'Add resume')
    const body = bodyOf(fetchImpl.mock.calls[0][1])
    expect(body).not.toHaveProperty('sha')
  })

  it.each([409, 422])('turns a %d into a conflict', async (status) => {
    const { store } = github(() => new Response('nope', { status }))
    await expect(store.writeConfigFile('resume.json', 'x', 's1', 'm')).rejects.toBeInstanceOf(
      ConfigConflictError,
    )
  })
})
