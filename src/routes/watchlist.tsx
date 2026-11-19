import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Notice,
  PageHeader,
  SectionTitle,
  inputClass,
  tableClass,
  tableWrap,
  tbodyClass,
  tdClass,
  theadClass,
  thClass,
  type BadgeTone,
} from '#/components/ui'
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
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Watchlist" subtitle={repo ? `Stored in ${repo}` : undefined} />

      {configError && (
        <Callout tone="error">
          Couldn’t read your watchlist: {configError} The watchlist needs the token’s{' '}
          <strong>Contents: Read and write</strong> permission.
        </Callout>
      )}
      {notice && (
        <div className="mb-4">
          <Notice ok={notice.ok}>{notice.message}</Notice>
        </div>
      )}

      <section className="mb-10">
        <SectionTitle>Add a company</SectionTitle>
        <form onSubmit={onDetect} className="flex gap-2">
          <input
            type="url"
            required
            aria-label="Job posting or careers page URL"
            placeholder="Paste a job posting or careers page URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={`${inputClass} min-w-0 flex-1`}
          />
          <Button type="submit" variant="primary" disabled={busy !== null}>
            {busy === 'detect' ? 'Checking…' : 'Find board'}
          </Button>
        </form>
      </section>

      <section className="mb-10">
        <SectionTitle
          actions={
            <Button disabled={busy !== null} onClick={() => void act('hn', () => mineHn())}>
              {busy === 'hn' ? 'Checking HN… (about a minute)' : 'Check HN “Who is hiring?”'}
            </Button>
          }
        >
          Suggestions
        </SectionTitle>
        <p className="mb-3 text-sm text-muted">
          Sorted by how many of their open jobs pass your profile today. “Guessed” boards were found
          by trying the company name, so open the board to make sure it’s the right company.
        </p>
        {suggestions.length === 0 ? (
          <EmptyState title="No suggestions waiting">Check HN, or add a company above.</EmptyState>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {[...supported, ...unsupported].map((s) => (
              <li
                key={s.id}
                className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${highlight.includes(s.id) ? 'bg-accent-50 dark:bg-accent-500/10' : ''}`}
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
                    <span className="ml-2 text-sm font-normal text-muted">
                      {s.ats}/{s.slug}
                    </span>
                    {s.supported && (
                      <Badge
                        tone={s.via === 'guess' ? 'warning' : 'neutral'}
                        className="ml-2 align-middle"
                      >
                        {VIA_LABEL[s.via]}
                      </Badge>
                    )}
                  </p>
                  {s.sourceText && (
                    <p className="truncate text-sm text-muted">
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
                <p className="text-sm tabular-nums sm:w-40 sm:text-right">
                  {!s.supported ? (
                    <span className="text-muted">{s.note ?? 'Not supported'}</span>
                  ) : s.checkError ? (
                    <span className="text-red-700 dark:text-red-400">Check failed</span>
                  ) : (
                    <>
                      <strong>{s.matchingJobs ?? 0}</strong> matching
                      <span className="text-muted"> of {s.openJobs ?? 0}</span>
                    </>
                  )}
                </p>
                <div className="flex gap-2">
                  {s.supported && (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void act(s.id, () => acceptSuggestion({ data: { id: s.id } }))}
                    >
                      {busy === s.id ? 'Adding…' : 'Accept'}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      void act(`r:${s.id}`, () => rejectSuggestion({ data: { id: s.id } }))
                    }
                  >
                    {s.supported ? 'Reject' : 'Dismiss'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>
          Watching {watchlist.length} {watchlist.length === 1 ? 'company' : 'companies'}
        </SectionTitle>
        <div className={tableWrap}>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>Company</th>
                <th className={thClass}>Board</th>
                <th className={thClass}>Last run</th>
                <th className={`${thClass} text-right`}>Open</th>
                <th className={`${thClass} text-right`}>Matching</th>
              </tr>
            </thead>
            <tbody className={tbodyClass}>
              {watchlist.map((c) => {
                const label =
                  c.lastStatus === null
                    ? 'Not run yet'
                    : c.lastStatus === 'ok'
                      ? c.lastComplete
                        ? 'OK'
                        : 'Partial'
                      : c.lastStatus
                const tone: BadgeTone =
                  c.lastStatus === null
                    ? 'neutral'
                    : label === 'OK'
                      ? 'green'
                      : label === 'Partial'
                        ? 'warning'
                        : 'red'
                return (
                  <tr key={`${c.ats}:${c.slug}`}>
                    <td className={tdClass}>
                      {c.url ? (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                        >
                          {c.name}
                        </a>
                      ) : (
                        c.name
                      )}
                    </td>
                    <td className={`${tdClass} text-muted`}>
                      {c.ats}/{c.slug}
                    </td>
                    <td className={tdClass}>
                      <Badge tone={tone}>{label}</Badge>
                    </td>
                    <td className={`${tdClass} text-right`}>{c.lastFetched ?? '—'}</td>
                    <td className={`${tdClass} text-right`}>{c.lastKept ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
