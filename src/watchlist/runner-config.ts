import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { formatCompanies, parseCompanies, parseConfig, type IngestConfig } from '#/pipeline/config'
import type { Company } from '#/pipeline/schema'
import { parseCriteria, type Criteria } from '#/rank/criteria'
import { GitHubConflictError, type GitHubRunner } from '#/sync/github'
import { parseResume, type Resume } from '#/tailor/resume'

import { boardKey } from './detect'

/** Where the watchlist and profiles live: the runner repo on GitHub, or a local folder. */
export interface ConfigStore {
  /** For messages, e.g. "you/lantern-runner (GitHub)". */
  describe: string
  read(): Promise<IngestConfig>
  /** Adds a company to companies.json unless it's already there. */
  addCompany(company: Company): Promise<'added' | 'exists'>
  /** Reads criteria.json for ranking; null when there isn't one. */
  readCriteria(): Promise<Criteria | null>
  /** Reads resume.json, the master resume for tailoring; null when there isn't one. */
  readResume(): Promise<Resume | null>
}

function withCompany(companies: Company[], company: Company): Company[] | null {
  const key = boardKey(company)
  if (companies.some((c) => boardKey(c) === key || c.slug === company.slug)) return null
  return [...companies, company]
}

/** A file's text, or null when it doesn't exist. */
async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null
    throw err
  }
}

export class LocalConfigStore implements ConfigStore {
  readonly describe: string
  constructor(private readonly dir: string) {
    this.describe = `${dir} (local folder)`
  }

  async read(): Promise<IngestConfig> {
    const c = join(this.dir, 'companies.json')
    const p = join(this.dir, 'profiles.json')
    const [companies, profiles] = await Promise.all([readFile(c, 'utf8'), readFile(p, 'utf8')])
    return parseConfig({
      companies: { label: c, text: companies },
      profiles: { label: p, text: profiles },
    })
  }

  async addCompany(company: Company): Promise<'added' | 'exists'> {
    const { companies } = await this.read()
    const next = withCompany(companies, company)
    if (!next) return 'exists'
    await writeFile(join(this.dir, 'companies.json'), formatCompanies(next))
    return 'added'
  }

  async readCriteria(): Promise<Criteria | null> {
    const path = join(this.dir, 'criteria.json')
    const text = await readOptional(path)
    return text === null ? null : parseCriteria(path, text)
  }

  async readResume(): Promise<Resume | null> {
    const path = join(this.dir, 'resume.json')
    const text = await readOptional(path)
    return text === null ? null : parseResume(path, text)
  }
}

/** Reads and commits config/*.json in the private runner repo through the GitHub API. */
export class GitHubConfigStore implements ConfigStore {
  readonly describe: string
  constructor(
    private readonly runner: GitHubRunner,
    repo: string,
  ) {
    this.describe = `${repo} (GitHub)`
  }

  async read(): Promise<IngestConfig> {
    const [companies, profiles] = await Promise.all([
      this.runner.getFile('config/companies.json'),
      this.runner.getFile('config/profiles.json'),
    ])
    return parseConfig({
      companies: { label: 'config/companies.json', text: companies.text },
      profiles: { label: 'config/profiles.json', text: profiles.text },
    })
  }

  async addCompany(company: Company): Promise<'added' | 'exists'> {
    // If the file changes between reading and writing (another edit), read it again once.
    for (let attempt = 0; ; attempt++) {
      // oxlint-disable-next-line no-await-in-loop -- read-modify-write, retried at most once
      const file = await this.runner.getFile('config/companies.json')
      const companies = parseCompanies('config/companies.json', file.text)
      const next = withCompany(companies, company)
      if (!next) return 'exists'
      try {
        // oxlint-disable-next-line no-await-in-loop
        await this.runner.putFile(
          'config/companies.json',
          formatCompanies(next),
          file.sha,
          `Add ${company.name} to the watchlist (via Lantern)`,
        )
        return 'added'
      } catch (err) {
        if (!(err instanceof GitHubConflictError) || attempt >= 1) throw err
      }
    }
  }
  async readCriteria(): Promise<Criteria | null> {
    const file = await this.runner.getOptionalFile('config/criteria.json')
    return file ? parseCriteria('config/criteria.json', file.text) : null
  }

  async readResume(): Promise<Resume | null> {
    const file = await this.runner.getOptionalFile('config/resume.json')
    return file ? parseResume('config/resume.json', file.text) : null
  }
}
