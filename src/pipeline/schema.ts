import { z } from 'zod'

// ---------- Config (lives in the private runner repo) ----------

export const ATS = ['greenhouse', 'lever', 'ashby', 'workday', 'bamboohr'] as const
export type Ats = (typeof ATS)[number]

export const CompanySchema = z.object({
  name: z.string().min(1),
  ats: z.enum(ATS),
  slug: z.string().min(1),
  workday: z.object({ tenant: z.string(), host: z.string(), site: z.string() }).optional(),
})
export type Company = z.infer<typeof CompanySchema>

export const ELIGIBILITY = [
  'canada_onsite',
  'canada_hybrid',
  'remote_canada_ok',
  'remote_us_only',
  'remote_non_canada',
  'non_canada_onsite',
  'unknown',
] as const
export const EligibilitySchema = z.enum(ELIGIBILITY)
export type Eligibility = z.infer<typeof EligibilitySchema>

export const ProfileSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  titleInclude: z.array(z.string().min(1)).min(1),
  titleExclude: z.array(z.string().min(1)).default([]),
  allowedEligibility: z.array(EligibilitySchema).min(1),
})
export type Profile = z.infer<typeof ProfileSchema>

// ---------- Normalized job ----------

export const WorkplaceTypeSchema = z.enum(['onsite', 'hybrid', 'remote'])
export type WorkplaceType = z.infer<typeof WorkplaceTypeSchema>

export const SalarySchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
  currency: z.string().nullable(),
  period: z.enum(['year', 'month', 'week', 'day', 'hour']).nullable(),
})
export type Salary = z.infer<typeof SalarySchema>

export const SourceIdSchema = z.enum([
  'greenhouse',
  'lever',
  'ashby',
  'workday',
  'remotive',
  'bamboohr',
])
export type SourceId = z.infer<typeof SourceIdSchema>

export const JobSchema = z.object({
  /** hash(source + companySlug + sourceJobId) — sourceJobId alone isn't unique for every ATS. */
  id: z.string(),
  /** normalized company + title + location; used to group the same job seen on two sources. */
  dedupeKey: z.string(),
  source: SourceIdSchema,
  sourceJobId: z.string().min(1),
  companySlug: z.string(),
  company: z.string(),
  title: z.string().min(1),
  url: z.url(),
  applyUrl: z.url().nullable(),
  locationText: z.string(),
  /** 'CA', 'US', another country name, or null when unknown. */
  country: z.string().nullable(),
  workplaceType: WorkplaceTypeSchema.nullable(),
  eligibility: EligibilitySchema,
  salary: SalarySchema.nullable(),
  descriptionHtml: z.string(),
  descriptionText: z.string(),
  postedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Changes when anything a person would care about changes. */
  contentHash: z.string(),
})
export type Job = z.infer<typeof JobSchema>
