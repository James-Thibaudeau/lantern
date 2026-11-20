import { z } from 'zod'

// Kept free of Node APIs, so config schemas can be validated in the browser too.

/** Parses a JSON config file and checks it against a schema, with errors that name the file. */
export function parseJsonFile<T>(label: string, text: string, schema: z.ZodType<T>): T {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not read ${label}: ${reason}`, { cause: err })
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid ${label}:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}
