import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatCompanies, parseCompanies } from '../../pipeline/config'
import type { Company, Profile } from '../../pipeline/schema'
import { GitHubAuthError, GitHubConflictError, GitHubRunner } from '../../sync/github'
import { GitHubConfigStore, LocalConfigStore } from '../runner-config'

const COMPANIES_TEXT =
  '[\n' +
  '  { "name": "Wealthsimple", "ats": "ashby", "slug": "wealthsimple" },\n' +
  '  { "name": "Fullscript", "ats": "lever", "slug": "fullscript" }\n' +
  ']\n'

const PROFILES: Profile[] = [
  {
    id: 'fe',
    enabled: true,
    titleInclude: ['frontend'],
    titleExclude: [],
    allowedEligibility: ['remote_canada_ok'],
  },
]

const API = 'https://api.github.com/repos/me/runner'

const koho: Company = { name: 'KOHO', ats: 'greenhouse', slug: 'koho' }

describe('formatCompanies', () => {
  it('round-trips the hand-edited style byte for byte', () => {
    expect(formatCompanies(parseCompanies('companies.json', COMPANIES_TEXT))).toBe(COMPANIES_TEXT)
  })

  it('formats a Workday entry on one line', () => {
    const text = formatCompanies([
      {
        name: 'Acme',
        ats: 'workday',
        slug: 'acme',
        workday: { tenant: 'acme', host: 'acme.wd5.myworkdayjobs.com', site: 'External' },
      },
    ])
    expect(text).toBe(
      '[\n' +
        '  { "name": "Acme", "ats": "workday", "slug": "acme", "workday": { "tenant": "acme", ' +
        '"host": "acme.wd5.myworkdayjobs.com", "site": "External" } }\n' +
        ']\n',
    )
    expect(parseCompanies('companies.json', text)).toEqual([
      {
        name: 'Acme',
        ats: 'workday',
        slug: 'acme',
        workday: { tenant: 'acme', host: 'acme.wd5.myworkdayjobs.com', site: 'External' },
      },
    ])
  })

  it('formats an empty list', () => {
    expect(parseCompanies('companies.json', formatCompanies([]))).toEqual([])
  })
})

describe('parseCompanies', () => {
  it('rejects duplicate slugs', () => {
    const text = JSON.stringify([
      { name: 'A', ats: 'ashby', slug: 'acme' },
      { name: 'B', ats: 'lever', slug: 'acme' },
    ])
    expect(() => parseCompanies('companies.json', text)).toThrow(/Duplicate company slug "acme"/)
  })
})

describe('LocalConfigStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lantern-store-'))
    await writeFile(join(dir, 'companies.json'), COMPANIES_TEXT)
    await writeFile(join(dir, 'profiles.json'), JSON.stringify(PROFILES))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads companies and profiles', async () => {
    const store = new LocalConfigStore(dir)
    expect(store.describe).toBe(`${dir} (local folder)`)
    const config = await store.read()
    expect(config.companies.map((c) => c.slug)).toEqual(['wealthsimple', 'fullscript'])
    expect(config.profiles).toEqual(PROFILES)
  })

  it('appends a new company as one line', async () => {
    const store = new LocalConfigStore(dir)
    await expect(store.addCompany(koho)).resolves.toBe('added')
    expect(await readFile(join(dir, 'companies.json'), 'utf8')).toBe(
      '[\n' +
        '  { "name": "Wealthsimple", "ats": "ashby", "slug": "wealthsimple" },\n' +
        '  { "name": "Fullscript", "ats": "lever", "slug": "fullscript" },\n' +
        '  { "name": "KOHO", "ats": "greenhouse", "slug": "koho" }\n' +
        ']\n',
    )
  })

  it('does not add a company twice', async () => {
    const store = new LocalConfigStore(dir)
    await expect(store.addCompany(koho)).resolves.toBe('added')
    const after = await readFile(join(dir, 'companies.json'), 'utf8')
    await expect(store.addCompany(koho)).resolves.toBe('exists')
    await expect(
      store.addCompany({ name: 'Wealthsimple', ats: 'ashby', slug: 'wealthsimple' }),
    ).resolves.toBe('exists')
    expect(await readFile(join(dir, 'companies.json'), 'utf8')).toBe(after)
  })

  it('treats the same slug on another ATS as existing', async () => {
    const store = new LocalConfigStore(dir)
    await expect(
      store.addCompany({ name: 'Wealthsimple', ats: 'greenhouse', slug: 'wealthsimple' }),
    ).resolves.toBe('exists')
    expect(await readFile(join(dir, 'companies.json'), 'utf8')).toBe(COMPANIES_TEXT)
  })
})

function fakeRunner(files: { text: string; sha: string }[], putErrors: Error[] = []) {
  let reads = 0
  const getFile = vi.fn<(path: string) => Promise<{ text: string; sha: string }>>(
    async (path: string) => {
      if (path === 'config/profiles.json') return { text: JSON.stringify(PROFILES), sha: 'p1' }
      const file = files[Math.min(reads, files.length - 1)]
      reads++
      return file
    },
  )
  const putFile = vi.fn<
    (path: string, text: string, sha: string, message: string) => Promise<void>
  >(async () => {
    const err = putErrors.shift()
    if (err) throw err
  })
  return { getFile, putFile }
}

function runnerWith(respond: (url: string, init: RequestInit) => Response) {
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) =>
    respond(input instanceof Request ? input.url : input.toString(), init ?? {}),
  )
  const runner = new GitHubRunner({ token: 't0k', repo: 'me/runner', fetchImpl })
  return { runner, fetchImpl }
}

describe('GitHubConfigStore', () => {
  it('reads both config files', async () => {
    const runner = fakeRunner([{ text: COMPANIES_TEXT, sha: 'c1' }])
    const store = new GitHubConfigStore(runner as never, 'me/runner')
    expect(store.describe).toBe('me/runner (GitHub)')
    const config = await store.read()
    expect(config.companies).toHaveLength(2)
    expect(config.profiles).toEqual(PROFILES)
  })

  it('commits the formatted file with the sha it read', async () => {
    const runner = fakeRunner([{ text: COMPANIES_TEXT, sha: 'c1' }])
    const store = new GitHubConfigStore(runner as never, 'me/runner')
    await expect(store.addCompany(koho)).resolves.toBe('added')
    expect(runner.putFile).toHaveBeenCalledTimes(1)
    const [path, text, sha, message] = runner.putFile.mock.calls[0]
    expect(path).toBe('config/companies.json')
    expect(text).toBe(formatCompanies([...parseCompanies('companies.json', COMPANIES_TEXT), koho]))
    expect(sha).toBe('c1')
    expect(message).toContain('KOHO')
  })

  it('does not commit when the company is already there', async () => {
    const runner = fakeRunner([{ text: COMPANIES_TEXT, sha: 'c1' }])
    const store = new GitHubConfigStore(runner as never, 'me/runner')
    await expect(
      store.addCompany({ name: 'Fullscript', ats: 'lever', slug: 'fullscript' }),
    ).resolves.toBe('exists')
    expect(runner.putFile).not.toHaveBeenCalled()
  })

  it('re-reads and retries once after a conflict', async () => {
    const newer = '[\n  { "name": "Wealthsimple", "ats": "ashby", "slug": "wealthsimple" }\n]\n'
    const runner = fakeRunner(
      [
        { text: COMPANIES_TEXT, sha: 'c1' },
        { text: newer, sha: 'c2' },
      ],
      [new GitHubConflictError('409')],
    )
    const store = new GitHubConfigStore(runner as never, 'me/runner')
    await expect(store.addCompany(koho)).resolves.toBe('added')
    expect(runner.getFile).toHaveBeenCalledTimes(2)
    expect(runner.putFile).toHaveBeenCalledTimes(2)
    const [, text, sha] = runner.putFile.mock.calls[1]
    expect(sha).toBe('c2')
    expect(text).toBe(formatCompanies([...parseCompanies('companies.json', newer), koho]))
  })

  it('returns exists when the retry finds the company already added', async () => {
    const withKoho = formatCompanies([...parseCompanies('companies.json', COMPANIES_TEXT), koho])
    const runner = fakeRunner(
      [
        { text: COMPANIES_TEXT, sha: 'c1' },
        { text: withKoho, sha: 'c2' },
      ],
      [new GitHubConflictError('409')],
    )
    const store = new GitHubConfigStore(runner as never, 'me/runner')
    await expect(store.addCompany(koho)).resolves.toBe('exists')
    expect(runner.putFile).toHaveBeenCalledTimes(1)
  })

  it('gives up after a second conflict', async () => {
    const runner = fakeRunner(
      [{ text: COMPANIES_TEXT, sha: 'c1' }],
      [new GitHubConflictError('409'), new GitHubConflictError('409 again')],
    )
    const store = new GitHubConfigStore(runner as never, 'me/runner')
    await expect(store.addCompany(koho)).rejects.toThrow('409 again')
    expect(runner.putFile).toHaveBeenCalledTimes(2)
  })

  it('passes on other errors without retrying', async () => {
    const runner = fakeRunner([{ text: COMPANIES_TEXT, sha: 'c1' }], [new Error('boom')])
    const store = new GitHubConfigStore(runner as never, 'me/runner')
    await expect(store.addCompany(koho)).rejects.toThrow('boom')
    expect(runner.putFile).toHaveBeenCalledTimes(1)
  })
})

describe('GitHubRunner contents API', () => {
  it('reads and decodes a file from main', async () => {
    // GitHub wraps base64 content at 60 characters.
    const b64 = Buffer.from(COMPANIES_TEXT, 'utf8').toString('base64')
    const content = b64.replace(/(.{60})/g, '$1\n')
    const { runner, fetchImpl } = runnerWith(() =>
      Response.json({ content, sha: 'abc', encoding: 'base64' }),
    )
    await expect(runner.getFile('config/companies.json')).resolves.toEqual({
      text: COMPANIES_TEXT,
      sha: 'abc',
    })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${API}/contents/config/companies.json?ref=main`)
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer t0k')
  })

  it('commits a file to main with the sha it replaces', async () => {
    const { runner, fetchImpl } = runnerWith(() => Response.json({}))
    await runner.putFile('config/companies.json', 'héllo\n', 'abc', 'Add KOHO')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${API}/contents/config/companies.json`)
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init?.body as string)).toEqual({
      message: 'Add KOHO',
      content: Buffer.from('héllo\n', 'utf8').toString('base64'),
      sha: 'abc',
      branch: 'main',
    })
    expect((init!.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('explains a 403 in terms of the Contents permission', async () => {
    const { runner } = runnerWith(() => new Response('{}', { status: 403 }))
    const err: unknown = await runner.getFile('config/companies.json').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitHubAuthError)
    expect((err as Error).message).toContain('Contents')
  })

  it('turns a 409 into a conflict', async () => {
    const { runner } = runnerWith(() => new Response('{}', { status: 409 }))
    await expect(runner.putFile('config/companies.json', 'x', 'old', 'msg')).rejects.toBeInstanceOf(
      GitHubConflictError,
    )
  })
})
