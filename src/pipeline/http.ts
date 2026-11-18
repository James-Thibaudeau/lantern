export const USER_AGENT = 'lantern-job-ingest/0.1 (personal job search; polite, once a day)'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpError'
  }
}

export interface HttpClient {
  getJson(url: string): Promise<unknown>
  postJson(url: string, body: unknown): Promise<unknown>
}

export interface HttpOptions {
  timeoutMs?: number
  retries?: number
  /** Base backoff; attempt n waits base * 3^n (1s, 3s by default). */
  backoffMs?: number
  fetchImpl?: typeof fetch
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500
  return true // network errors and timeouts
}

export function createHttpClient(opts: HttpOptions = {}): HttpClient {
  const { timeoutMs = 20_000, retries = 2, backoffMs = 1_000, fetchImpl = fetch } = opts

  // Retries are sequential on purpose: each attempt waits for the previous one to fail.
  /* oxlint-disable no-await-in-loop */
  async function request(url: string, init: RequestInit): Promise<unknown> {
    let lastErr: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchImpl(url, {
          ...init,
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...init.headers },
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!res.ok) throw new HttpError(res.status, url)
        return await res.json()
      } catch (err) {
        lastErr = err
        if (attempt === retries || !isRetryable(err)) break
        await sleep(backoffMs * 3 ** attempt)
      }
    }
    if (lastErr instanceof Error && lastErr.name === 'TimeoutError') {
      throw new Error(`Timed out after ${timeoutMs / 1000}s: ${url}`, { cause: lastErr })
    }
    throw lastErr
  }
  /* oxlint-enable no-await-in-loop */

  return {
    getJson: (url) => request(url, { method: 'GET' }),
    postJson: (url, body) =>
      request(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }),
  }
}

/** Run fn over items with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      // Each worker handles one item at a time; the `limit` workers run in parallel.
      // oxlint-disable-next-line no-await-in-loop
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export { sleep }
