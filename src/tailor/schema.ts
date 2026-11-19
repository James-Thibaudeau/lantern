import { z } from 'zod'

// What the model may send back. Employers, titles, dates, education and contact details are
// deliberately absent: those always come from the master resume. Every bullet points at the
// master bullet it came from, which is what lets the checks catch invented facts.

export const TailoringSchema = z.strictObject({
  summary: z.string().describe('The summary, rewritten for this posting from facts in the resume'),
  skills: z
    .array(
      z.strictObject({
        group: z.string().describe('A skill group name exactly as in the resume'),
        items: z
          .array(z.string())
          .describe('Items from that group only, most relevant first; leave out irrelevant ones'),
      }),
    )
    .describe('Every skill group from the resume, in the order to show them'),
  experience: z
    .array(
      z.strictObject({
        id: z.string().describe('The job id exactly as in the resume'),
        bullets: z
          .array(
            z.strictObject({
              sourceId: z.string().describe('The id of the resume bullet this one comes from'),
              text: z
                .string()
                .describe(
                  'That bullet, unchanged or lightly reworded, with the same facts and numbers',
                ),
            }),
          )
          .describe('The bullets to keep for this job, most relevant first'),
      }),
    )
    .describe('Every job from the resume, in resume order'),
  fitNotes: z.strictObject({
    matches: z.array(z.string()).describe("The posting's requirements the resume shows, briefly"),
    gaps: z.array(z.string()).describe("The posting's requirements the resume doesn't show"),
    interviewTopics: z.array(z.string()).describe('3–5 topics likely to come up in an interview'),
  }),
})
export type Tailoring = z.infer<typeof TailoringSchema>

/** The JSON Schema handed to `claude -p --json-schema`. */
export function tailoringJsonSchema(): Record<string, unknown> {
  const { $schema: _, ...schema } = z.toJSONSchema(TailoringSchema)
  return schema
}
