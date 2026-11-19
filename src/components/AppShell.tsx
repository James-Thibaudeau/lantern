import { Link, Outlet, useLoaderData, useRouter } from '@tanstack/react-router'
import { useState, useSyncExternalStore, type ReactNode } from 'react'

import { syncNow } from '#/server/jobs'
import { runNow } from '#/server/runs'

import { LanternMark } from './LanternMark'
import { Button } from './ui'

// A shared clock that ticks every 30 s. The server snapshot is null, so the server-rendered
// HTML shows a plain time and the browser switches to "3 min ago" after hydrating.
let clock = Date.now()
function subscribeClock(onTick: () => void): () => void {
  clock = Date.now()
  const timer = setInterval(() => {
    clock = Date.now()
    onTick()
  }, 30_000)
  return () => clearInterval(timer)
}

function useNow(): number | null {
  return useSyncExternalStore(
    subscribeClock,
    () => clock,
    () => null,
  )
}

function ago(iso: string, now: number | null): string {
  const then = new Date(iso)
  if (now === null) {
    return then.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
  }
  const minutes = Math.round((now - then.getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return then.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

function NavLink({
  to,
  label,
  count,
  onNavigate,
}: {
  to: string
  label: string
  count?: number
  onNavigate?: () => void
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className="flex h-8 items-center justify-between rounded-md px-2.5 text-sm text-muted hover:bg-hover hover:text-ink"
      activeProps={{ className: 'bg-hover font-medium !text-ink' }}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-accent-500/15 px-1.5 text-xs font-semibold text-accent-800 tabular-nums dark:text-accent-300">
          {count}
        </span>
      )}
    </Link>
  )
}

/** `onNavigate` closes the phone menu when a link is chosen. */
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { sync, inbox, pendingSuggestions } = useLoaderData({ from: '__root__' })
  const router = useRouter()
  const now = useNow()
  const [busy, setBusy] = useState<'sync' | 'run' | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; message: string; url?: string } | null>(null)

  async function act(kind: 'sync' | 'run') {
    setBusy(kind)
    setNotice(null)
    try {
      if (kind === 'sync') {
        const status = await syncNow()
        if (!status.ok) setNotice(status)
        await router.invalidate() // reloads every loader, so pages show the synced jobs
      } else {
        setNotice(await runNow({ data: { fullResend: false } }))
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Link to="/jobs" className="mb-6 flex items-center gap-2 px-2.5 text-ink">
        <LanternMark className="size-6 text-stone-700 dark:text-stone-300" />
        <span className="text-[15px] font-semibold tracking-tight">Lantern</span>
      </Link>

      <nav aria-label="Main" className="flex flex-col gap-0.5">
        <NavLink to="/jobs" label="Jobs" count={inbox} onNavigate={onNavigate} />
        <NavLink
          to="/watchlist"
          label="Watchlist"
          count={pendingSuggestions}
          onNavigate={onNavigate}
        />
        <NavLink to="/runs" label="Runs" onNavigate={onNavigate} />
      </nav>

      <div className="mt-auto border-t border-line pt-4">
        <p className="flex items-center gap-2 px-1 text-xs text-muted" title={sync.message}>
          <span
            className={`size-1.5 shrink-0 rounded-full ${sync.ok ? 'bg-emerald-500' : 'bg-red-500'}`}
          />
          <span className="truncate">
            {busy === 'sync'
              ? 'Syncing…'
              : sync.ok
                ? `Synced ${ago(sync.at, now)}`
                : `Sync failed ${ago(sync.at, now)}`}
          </span>
        </p>
        {!sync.ok && busy !== 'sync' && (
          <p className="mt-1 line-clamp-3 px-1 text-xs text-red-700 dark:text-red-400">
            {sync.message}
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="primary" disabled={busy !== null} onClick={() => void act('sync')}>
            {busy === 'sync' ? 'Syncing…' : 'Sync'}
          </Button>
          <Button disabled={busy !== null} onClick={() => void act('run')}>
            {busy === 'run' ? 'Starting…' : 'Run now'}
          </Button>
        </div>
        {notice && (
          <p
            className={`mt-2 px-1 text-xs ${notice.ok ? 'text-muted' : 'text-red-700 dark:text-red-400'}`}
          >
            {notice.message}{' '}
            {notice.url && (
              <a href={notice.url} target="_blank" rel="noreferrer" className="underline">
                GitHub ↗
              </a>
            )}
          </p>
        )}
      </div>
    </div>
  )
}

/** Sidebar on wide screens; a top bar with a menu on phones. Pages render in <Outlet/>. */
export function AppShell(): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <aside className="hidden w-56 shrink-0 border-r border-line bg-surface px-3 py-4 md:block">
        <SidebarContent />
      </aside>

      <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2 md:hidden">
        <Link to="/jobs" className="flex items-center gap-2">
          <LanternMark className="size-5 text-stone-700 dark:text-stone-300" />
          <span className="font-semibold tracking-tight">Lantern</span>
        </Link>
        <Button
          variant="ghost"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? 'Close' : 'Menu'}
        </Button>
      </div>
      {menuOpen && (
        <div id="mobile-menu" className="border-b border-line bg-surface px-3 py-4 md:hidden">
          <SidebarContent onNavigate={() => setMenuOpen(false)} />
        </div>
      )}

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
