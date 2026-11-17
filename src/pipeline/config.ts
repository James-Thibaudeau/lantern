import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { CompanySchema, ProfileSchema, type Company, type Profile } from './schema'

export interface IngestConfig {
  companies: Company[]
  profiles: Profile[]
}

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    throw new Error(`Could not read ${path}: ${(err as Error).message}`)
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid ${path}:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

export async function loadConfig(dir: string): Promise<IngestConfig> {
  const companies = await readJson(join(dir, 'companies.json'), z.array(CompanySchema))
  const profiles = await readJson(join(dir, 'profiles.json'), z.array(ProfileSchema))

  const seen = new Set<string>()
  for (const c of companies) {
    if (seen.has(c.slug)) throw new Error(`Duplicate company slug "${c.slug}" in companies.json`)
    seen.add(c.slug)
  }
  if (!profiles.some((p) => p.enabled)) {
    throw new Error('profiles.json has no enabled profile, so every job would be filtered out')
  }
  return { companies, profiles }
}
