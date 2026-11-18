import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import {
  acceptSuggestion,
  detectUrl,
  getWatchlist,
  mineHn,
  rejectSuggestion,
  type SuggestionView,
} from '#/server/watchlist'

export const Route = createFileRoute('/watchlist')({
  loader: () => getWatchlist(),
  head: () => ({ meta: [{ title: 'Watchlist · Lantern' }] }),
  component: WatchlistPage,
})

type Notice = { ok: boolean; message: string }

const VIA_LABEL: Record<SuggestionView['via'], string> = {
  link: 'linked',
  page: 'found on site',
  guess: 'guessed: check it',
}

const button =
  'rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900'
const primaryButton =
  'rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900'

function WatchlistPage() {
  const { repo, watchlist, suggestions, configError } = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [url, setUrl] = useState('')
  const [highlight, setHighlight] = useState<string[]>([])

  async function act(key: string, fn: () => Promise<Notice>) {
    setBusy(key)
    try {
      setNotice(await fn())
      await router.invalidate()
    } finally {
      setBusy(null)
    }
  }

  function onDetect(e: FormEvent) {
    e.preventDefault()
    void act('detect', async () => {
      const r = await detectUrl({ data: { url: url.trim() } })
      setHighlight(r.ids)
      if (r.ok) setUrl('')
      return r
    })
  }

  const supported = suggestions.filter((s) => s.supported)
  const unsupported = suggestions.filter((s) => !s.supported)

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 text-zinc-900 dark:text-zinc-100">
      <header className="mb-6">
        <p className="text-sm text-zinc-500">
          <Link to="/" className="hover:underline">
            Lantern
          </Link>{' '}
          /{' '}
          <Link to="/jobs" className="hover:underline">
            Jobs
          </Link>{' '}
          / Watchlist
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Watchlist</h1>
        {repo && <p className="mt-1 text-sm text-zinc-500">Stored in {repo}</p>}
      </header>

      {configError && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">
          Couldn’t read your watchlist: {configError} The watchlist needs the token’s{' '}
          <strong>Contents: Read and write</strong> permission.
        </p>
      )}
      {notice && (
        <output
          className={`mb-4 block text-sm ${notice.ok ? 'text-zinc-500' : 'text-red-700 dark:text-red-400'}`}
        >
          {notice.message}
        </output>
      )}

      <section className="mb-10">
        <h2 className="mb-2 text-lg font-semibold">Add a company</h2>
        <form onSubmit={onDetect} className="flex flex-wrap gap-2">
          <input
            type="url"
            required
            aria-label="Job posting or careers page URL"
            placeholder="Paste a job posting or careers page URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="min-w-72 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button type="submit" disabled={busy !== null} className={primaryButton}>
            {busy === 'detect' ? 'Checking…' : 'Find board'}
          </button>
        </form>
      </section>

      <section className="mb-10">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold">Suggestions</h2>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act('hn', () => mineHn())}
            className={button}
          >
            {busy === 'hn' ? 'Checking HN… (about a minute)' : 'Check HN “Who is hiring?”'}
          </button>
        </div>
        <p className="mb-3 text-sm text-zinc-500">
          Sorted by how many of their open jobs pass your profile today. “Guessed” boards were found
          by trying the company name, so open the board to make sure it’s the right company.
        </p>
        {suggestions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No suggestions waiting. Check HN, or add a company above.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {[...supported, ...unsupported].map((s) => (
              <li
                key={s.id}
                className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${highlight.includes(s.id) ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {s.name} ↗
                      </a>
                    ) : (
                      s.name
                    )}
                    <span className="ml-2 text-sm font-normal text-zinc-500">
                      {s.ats}/{s.slug}
                    </span>
                    {s.supported && (
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 align-middle text-xs ${s.via === 'guess' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
                      >
                        {VIA_LABEL[s.via]}
                      </span>
                    )}
                  </p>
                  {s.sourceText && (
                    <p className="truncate text-sm text-zinc-500">
                      {s.source === 'hn' && s.sourceUrl ? (
                        <a
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                        >
                          HN: {s.sourceText}
                        </a>
                      ) : (
                        s.sourceText
                      )}
                    </p>
                  )}
                </div>
                <p className="w-40 text-right text-sm tabular-nums">
                  {!s.supported ? (
                    <span className="text-zinc-500">{s.note ?? 'Not supported'}</span>
                  ) : s.checkError ? (
                    <span className="text-red-700 dark:text-red-400">Check failed</span>
                  ) : (
                    <>
                      <strong>{s.matchingJobs ?? 0}</strong> matching
                      <span className="text-zinc-500"> of {s.openJobs ?? 0}</span>
                    </>
                  )}
                </p>
                <div className="flex gap-2">
                  {s.supported && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void act(s.id, () => acceptSuggestion({ data: { id: s.id } }))}
                      className={primaryButton}
                    >
                      {busy === s.id ? 'Adding…' : 'Accept'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void act(`r:${s.id}`, () => rejectSuggestion({ data: { id: s.id } }))
                    }
                    className={button}
                  >
                    {s.supported ? 'Reject' : 'Dismiss'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">
          Watching {watchlist.length} {watchlist.length === 1 ? 'company' : 'companies'}
        </h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Board</th>
                <th className="px-3 py-2 font-medium">Last run</th>
                <th className="px-3 py-2 text-right font-medium">Open</th>
                <th className="px-3 py-2 text-right font-medium">Matching</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 tabular-nums dark:divide-zinc-800">
              {watchlist.map((c) => (
                <tr key={`${c.ats}:${c.slug}`}>
                  <td className="px-3 py-2">
                    {c.url ? (
                      <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {c.name}
                      </a>
                    ) : (
                      c.name
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">
                    {c.ats}/{c.slug}
                  </td>
                  <td className="px-3 py-2">
                    {c.lastStatus === null
                      ? 'Not run yet'
                      : c.lastStatus === 'ok'
                        ? c.lastComplete
                          ? 'OK'
                          : 'Partial'
                        : c.lastStatus}
                  </td>
                  <td className="px-3 py-2 text-right">{c.lastFetched ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{c.lastKept ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
