import { unzipSync, strFromU8 } from 'fflate'
import { z } from 'zod'

import { USER_AGENT } from '#/pipeline/http'

/** Where sync gets runs and their artifacts. GitHub in real use; a fake in tests. */
export interface RunSource {
  /** Successful runs of the runner workflow, newest first. */
  listRuns(): Promise<RunnerRun[]>
  listArtifacts(runId: string): Promise<RunArtifact[]>
  /** The artifact's files, by name. */
  downloadArtifact(artifact: RunArtifact): Promise<Record<string, string>>
}

export interface RunnerRun {
  id: string
  createdAt: string
  url: string
}

export interface RunArtifact {
  name: string
  expired: boolean
  downloadUrl: string
}

export class GitHubAuthError extends Error {
  override name = 'GitHubAuthError'
}

const RunsResponse = z.object({
  workflow_runs: z.array(
    z.object({ id: z.number(), created_at: z.string(), html_url: z.string() }),
  ),
})
const ArtifactsResponse = z.object({
  artifacts: z.array(
    z.object({ name: z.string(), expired: z.boolean(), archive_download_url: z.string() }),
  ),
})

export interface GitHubOptions {
  token: string
  /** owner/name of the private runner repo. */
  repo: string
  workflow?: string
  fetchImpl?: typeof fetch
}

export class GitHubRunner implements RunSource {
  private readonly api: string
  private readonly workflow: string
  private readonly fetchImpl: typeof fetch

  constructor(private readonly opts: GitHubOptions) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) {
      throw new Error(`"${opts.repo}" isn't an owner/name repo`)
    }
    this.api = `https://api.github.com/repos/${opts.repo}`
    this.workflow = opts.workflow ?? 'run.yml'
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.fetchImpl(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.opts.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': USER_AGENT,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 401) {
      throw new GitHubAuthError('GitHub token expired or invalid. Create a new one (see README).')
    }
    if (res.status === 403 || res.status === 404) {
      throw new GitHubAuthError(
        `GitHub said ${res.status} for ${this.opts.repo}: the repo doesn't exist, or the token ` +
          "can't access it (it needs Actions read/write on that repo).",
      )
    }
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`)
    return res
  }

  async listRuns(): Promise<RunnerRun[]> {
    const url = `${this.api}/actions/workflows/${this.workflow}/runs?status=success&per_page=100`
    const body = RunsResponse.parse(await (await this.request(url)).json())
    return body.workflow_runs.map((r) => ({
      id: String(r.id),
      createdAt: new Date(r.created_at).toISOString(),
      url: r.html_url,
    }))
  }

  async listArtifacts(runId: string): Promise<RunArtifact[]> {
    const url = `${this.api}/actions/runs/${encodeURIComponent(runId)}/artifacts?per_page=100`
    const body = ArtifactsResponse.parse(await (await this.request(url)).json())
    return body.artifacts.map((a) => ({
      name: a.name,
      expired: a.expired,
      downloadUrl: a.archive_download_url,
    }))
  }

  async downloadArtifact(artifact: RunArtifact): Promise<Record<string, string>> {
    // GitHub answers with a redirect to blob storage; fetch drops the Authorization
    // header when following a redirect to another host, which is what we want.
    const res = await this.request(artifact.downloadUrl)
    const zip = new Uint8Array(await res.arrayBuffer())
    const files: Record<string, string> = {}
    for (const [name, bytes] of Object.entries(unzipSync(zip))) files[name] = strFromU8(bytes)
    return files
  }

  /** Starts the runner workflow ("Run now"). GitHub doesn't return the new run's id. */
  async dispatch(inputs: { fullResend?: boolean; dryRun?: boolean; companies?: string }) {
    await this.request(`${this.api}/actions/workflows/${this.workflow}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          fullResend: String(inputs.fullResend ?? false),
          dryRun: String(inputs.dryRun ?? false),
          companies: inputs.companies ?? '',
        },
      }),
    })
  }

  get actionsUrl(): string {
    return `https://github.com/${this.opts.repo}/actions/workflows/${this.workflow}`
  }
}
