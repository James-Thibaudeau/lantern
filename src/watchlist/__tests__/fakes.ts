import { readFileSync } from 'node:fs'

import { HttpError, type HttpClient } from '../../pipeline/http'
import type { Profile } from '../../pipeline/schema'

/** The Ashby fixture from the pipeline tests (Wealthsimple, 4 listed jobs). */
export function ashbyFixture(): { jobs: unknown[] } {
  return JSON.parse(
    readFileSync(new URL('../../pipeline/__tests__/fixtures/ashby.json', import.meta.url), 'utf8'),
  ) as { jobs: unknown[] }
}

/**
 * The fixture has 4 jobs: two "Remote (Canada)" (a treasury manager and a quantitative
 * trader), one "Remote (US)" designer and one hybrid Toronto assistant. This profile keeps
 * the two Canadian remote jobs.
 */
export const profile: Profile = {
  id: 'test',
  enabled: true,
  titleInclude: ['manager', 'trader', 'designer'],
  titleExclude: [],
  allowedEligibility: ['remote_canada_ok'],
}

export type Route = (url: string) => unknown

/**
 * An HttpClient that answers GETs from a list of [url, response] pairs (matched on the URL
 * without its query string; first match wins) and throws HttpError(404) for anything else. A response that is a function is
 * called with the URL; throw from it to fail. Every requested URL is recorded.
 */
export function fakeHttp(routes: [string, unknown][]): HttpClient & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async getJson(url) {
      calls.push(url)
      const path = url.split('?')[0]
      const hit = routes.find(([u]) => u === url || u === path)
      if (!hit) throw new HttpError(404, url)
      const res = hit[1]
      return typeof res === 'function' ? (res as Route)(url) : structuredClone(res)
    },
    async postJson() {
      throw new Error('postJson not used')
    },
  }
}
