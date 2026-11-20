import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { formatCompanies, parseCompanies, parseConfig, type IngestConfig } from '#/pipeline/config'
import type { Company } from '#/pipeline/schema'
import { sha256 } from '#/pipeline/text'
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
  /** A config file's text and version (to detect edits made elsewhere); null when missing. */
  readConfigFile(name: EditableFile): Promise<ConfigFile | null>
  /**
   * Saves a config file and returns its new version. `version` is the one it was read at
   * (null for a new file); if the file changed since, throws ConfigConflictError.
   */
  writeConfigFile(
    name: EditableFile,
    text: string,
    version: string | null,
    message: string,
  ): Promise<string>
}

/** The config files the app edits. */
export type EditableFile = 'resume.json' | 'criteria.json' | 'tailoring-prompt.md'

export interface ConfigFile {
  text: string
  /** GitHub's sha, or a hash of a local file's content. */
  version: string
}

/** The file changed (on GitHub or on disk) after it was read for editing. */
export class ConfigConflictError extends Error {
  constructor(name: string, where: string) {
    super(`${name} changed in ${where} since you opened it. Reload to get the latest version.`)
    this.name = 'ConfigConflictError'
  }
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

  async readConfigFile(name: EditableFile): Promise<ConfigFile | null> {
    const text = await readOptional(join(this.dir, name))
    return text === null ? null : { text, version: sha256(text, 16) }
  }

  /** The commit message is unused: a local folder has no history. */
  async writeConfigFile(
    name: EditableFile,
    text: string,
    version: string | null,
    _message?: string,
  ): Promise<string> {
    const path = join(this.dir, name)
    const current = await readOptional(path)
    const currentVersion = current === null ? null : sha256(current, 16)
    if (currentVersion !== version) throw new ConfigConflictError(name, this.describe)
    await writeFile(path, text)
    return sha256(text, 16)
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

  async readConfigFile(name: EditableFile): Promise<ConfigFile | null> {
    const file = await this.runner.getOptionalFile(`config/${name}`)
    return file ? { text: file.text, version: file.sha } : null
  }

  async writeConfigFile(
    name: EditableFile,
    text: string,
    version: string | null,
    message: string,
  ): Promise<string> {
    try {
      return await this.runner.putFile(`config/${name}`, text, version, message)
    } catch (err) {
      if (err instanceof GitHubConflictError) throw new ConfigConflictError(name, this.describe)
      throw err
    }
  }
}
