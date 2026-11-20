import { z } from 'zod'

import { parseJsonFile } from '#/pipeline/json-file'

// The master resume: config/resume.json in the private runner repo. Tailoring only ever
// selects, orders and rewords what's here, so this file is the source of truth for every fact
// (employers, titles, dates, numbers). Objects are strict so a typo is reported, not ignored.

const id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'use lowercase letters, digits and dashes (e.g. "acme-2021")')

export const BulletSchema = z.strictObject({
  /** Stable id, so a tailored bullet can point back at the one it came from. */
  id,
  text: z.string().trim().min(1),
})
export type Bullet = z.infer<typeof BulletSchema>

export const JobEntrySchema = z.strictObject({
  id,
  title: z.string().min(1),
  employer: z.string().min(1),
  dates: z.string().min(1),
  /** A line under the title: team, or what the company does. */
  context: z.string().optional(),
  bullets: z.array(BulletSchema).default([]),
  stack: z.array(z.string().min(1)).default([]),
  /** Short entries (internships) shown together, smaller, at the end of Experience. */
  compact: z.boolean().default(false),
})
export type JobEntry = z.infer<typeof JobEntrySchema>

export const SkillGroupSchema = z.strictObject({
  group: z.string().min(1),
  items: z.array(z.string().min(1)).min(1),
})
export type SkillGroup = z.infer<typeof SkillGroupSchema>

export const ResumeSchema = z
  .strictObject({
    basics: z.strictObject({
      name: z.string().min(1),
      headline: z.string().min(1),
      location: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      links: z.array(z.strictObject({ label: z.string().min(1), url: z.url() })).default([]),
    }),
    summary: z.string().min(1),
    skills: z.array(SkillGroupSchema).default([]),
    experience: z.array(JobEntrySchema).min(1),
    patents: z
      .array(
        z.strictObject({
          title: z.string().min(1),
          number: z.string().optional(),
          url: z.url().optional(),
        }),
      )
      .default([]),
    education: z
      .array(
        z.strictObject({
          credential: z.string().min(1),
          school: z.string().min(1),
          year: z.string().min(1),
        }),
      )
      .default([]),
  })
  .superRefine((r, ctx) => {
    // Ids must be unique across the whole resume: a tailored bullet names only its id.
    const seen = new Set<string>()
    for (const [i, job] of r.experience.entries()) {
      for (const key of [job.id, ...job.bullets.map((b) => b.id)]) {
        if (seen.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['experience', i],
            message: `Duplicate id "${key}"`,
          })
        }
        seen.add(key)
      }
    }
    const groups = new Set<string>()
    for (const [i, g] of r.skills.entries()) {
      if (groups.has(g.group)) {
        ctx.addIssue({
          code: 'custom',
          path: ['skills', i],
          message: `Duplicate group "${g.group}"`,
        })
      }
      groups.add(g.group)
    }
  })
export type Resume = z.infer<typeof ResumeSchema>

export function parseResume(label: string, text: string): Resume {
  return parseJsonFile(label, text, ResumeSchema)
}
