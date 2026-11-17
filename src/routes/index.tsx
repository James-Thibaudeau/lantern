import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 text-zinc-900 dark:text-zinc-100">
      <h1 className="text-4xl font-bold tracking-tight">Lantern</h1>
      <p className="mt-2 text-lg text-zinc-500">Job postings from company job boards, filtered for you.</p>
      <Link
        to="/jobs"
        className="mt-6 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
      >
        View jobs
      </Link>
    </main>
  )
}
