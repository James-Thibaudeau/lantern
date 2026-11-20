import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { parseJsonFile } from './json-file'
import { CompanySchema, ProfileSchema, type Company, type Profile } from './schema'

export { parseJsonFile }

export interface IngestConfig {
  companies: Company[]
  profiles: Profile[]
}

/** Parses companies.json and checks slugs are unique. */
export function parseCompanies(label: string, text: string): Company[] {
  const companies = parseJsonFile(label, text, z.array(CompanySchema))
  const seen = new Set<string>()
  for (const c of companies) {
    if (seen.has(c.slug)) throw new Error(`Duplicate company slug "${c.slug}" in companies.json`)
    seen.add(c.slug)
  }
  return companies
}

/** Parses and checks companies.json and profiles.json, wherever they were read from. */
export function parseConfig(files: {
  companies: { label: string; text: string }
  profiles: { label: string; text: string }
}): IngestConfig {
  const companies = parseCompanies(files.companies.label, files.companies.text)
  const profiles = parseJsonFile(files.profiles.label, files.profiles.text, z.array(ProfileSchema))
  if (!profiles.some((p) => p.enabled)) {
    throw new Error('profiles.json has no enabled profile, so every job would be filtered out')
  }
  return { companies, profiles }
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not read ${path}: ${reason}`, { cause: err })
  }
}

export async function loadConfig(dir: string): Promise<IngestConfig> {
  const companiesPath = join(dir, 'companies.json')
  const profilesPath = join(dir, 'profiles.json')
  return parseConfig({
    companies: { label: companiesPath, text: await readText(companiesPath) },
    profiles: { label: profilesPath, text: await readText(profilesPath) },
  })
}

function companyLine(c: Company): string {
  const fields = [
    `"name": ${JSON.stringify(c.name)}`,
    `"ats": ${JSON.stringify(c.ats)}`,
    `"slug": ${JSON.stringify(c.slug)}`,
  ]
  if (c.workday) {
    const w = c.workday
    fields.push(
      `"workday": { "tenant": ${JSON.stringify(w.tenant)}, "host": ${JSON.stringify(w.host)}, "site": ${JSON.stringify(w.site)} }`,
    )
  }
  if (c.region) fields.push(`"region": ${JSON.stringify(c.region)}`)
  return `  { ${fields.join(', ')} }`
}

/** companies.json in its hand-edited style: one company per line. */
export function formatCompanies(companies: Company[]): string {
  return `[\n${companies.map(companyLine).join(',\n')}\n]\n`
}
