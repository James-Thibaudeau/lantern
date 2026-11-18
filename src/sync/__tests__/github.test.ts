import { strToU8, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

import { GitHubAuthError, GitHubRunner } from '../github'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function runnerWith(respond: (url: string, init: RequestInit | undefined) => Response) {
  const fetchImpl = vi.fn<typeof fetch>((input, init) =>
    Promise.resolve(respond(input as string, init)),
  )
  const runner = new GitHubRunner({ token: 'tok-123', repo: 'me/lantern-runner', fetchImpl })
  return { runner, fetchImpl }
}

describe('GitHubRunner', () => {
  it('lists successful runs and sends the auth and API version headers', async () => {
    const { runner, fetchImpl } = runnerWith(() =>
      json({
        total_count: 2,
        workflow_runs: [
          { id: 202, created_at: '2026-11-16T11:00:00Z', html_url: 'https://github.com/r/202' },
          { id: 101, created_at: '2026-11-15T11:00:00Z', html_url: 'https://github.com/r/101' },
        ],
      }),
    )

    const runs = await runner.listRuns()

    expect(runs).toEqual([
      { id: '202', createdAt: '2026-11-16T11:00:00.000Z', url: 'https://github.com/r/202' },
      { id: '101', createdAt: '2026-11-15T11:00:00.000Z', url: 'https://github.com/r/101' },
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe(
      'https://api.github.com/repos/me/lantern-runner/actions/workflows/run.yml/runs?status=success&per_page=100',
    )
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer tok-123',
      'X-GitHub-Api-Version': '2022-11-28',
    })
  })

  it('maps artifacts', async () => {
    const { runner, fetchImpl } = runnerWith(() =>
      json({
        artifacts: [
          { name: 'ingest-7', expired: false, archive_download_url: 'https://api.github.com/a/1' },
          { name: 'logs', expired: true, archive_download_url: 'https://api.github.com/a/2' },
        ],
      }),
    )

    expect(await runner.listArtifacts('7')).toEqual([
      { name: 'ingest-7', expired: false, downloadUrl: 'https://api.github.com/a/1' },
      { name: 'logs', expired: true, downloadUrl: 'https://api.github.com/a/2' },
    ])
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/me/lantern-runner/actions/runs/7/artifacts?per_page=100',
    )
  })

  it('throws GitHubAuthError mentioning the token on 401', async () => {
    const { runner } = runnerWith(() => json({ message: 'Bad credentials' }, 401))

    await expect(runner.listRuns()).rejects.toThrow(GitHubAuthError)
    await expect(runner.listRuns()).rejects.toThrow(/token/)
  })

  it('throws GitHubAuthError on 404', async () => {
    const { runner } = runnerWith(() => json({ message: 'Not Found' }, 404))

    await expect(runner.listRuns()).rejects.toThrow(GitHubAuthError)
    await expect(runner.listRuns()).rejects.toThrow(/me\/lantern-runner/)
  })

  it('throws a plain error on other failures', async () => {
    const { runner } = runnerWith(() => json({}, 500))

    const err: unknown = await runner.listRuns().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(GitHubAuthError)
    expect(err).toHaveProperty('message', expect.stringContaining('500'))
  })

  it('dispatches the workflow on main with string inputs', async () => {
    const { runner, fetchImpl } = runnerWith(() => new Response(null, { status: 204 }))

    await runner.dispatch({ fullResend: true, companies: 'acme,beta' })

    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe(
      'https://api.github.com/repos/me/lantern-runner/actions/workflows/run.yml/dispatches',
    )
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer tok-123',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(init?.body as string)).toEqual({
      ref: 'main',
      inputs: { fullResend: 'true', dryRun: 'false', companies: 'acme,beta' },
    })
  })

  it('downloads and unzips an artifact into a name to text map', async () => {
    const zip = zipSync({
      'jobs.jsonl': strToU8('{"id":"a1"}\n'),
      'open.json': strToU8('{"runId":"7"}'),
    })
    const { runner, fetchImpl } = runnerWith(() => new Response(zip as BodyInit))

    const files = await runner.downloadArtifact({
      name: 'ingest-7',
      expired: false,
      downloadUrl: 'https://api.github.com/a/1/zip',
    })

    expect(files).toEqual({ 'jobs.jsonl': '{"id":"a1"}\n', 'open.json': '{"runId":"7"}' })
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.github.com/a/1/zip')
  })

  it('rejects a repo that is not owner/name', () => {
    const fetchImpl = vi.fn<typeof fetch>()
    for (const repo of ['lantern-runner', 'me/lantern/extra', '', 'me/lantern runner']) {
      expect(() => new GitHubRunner({ token: 't', repo, fetchImpl })).toThrow(/owner\/name/)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
