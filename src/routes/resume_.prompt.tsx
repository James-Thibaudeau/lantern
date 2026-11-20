import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { PromptEditor } from '#/components/resume/PromptEditor'
import { Callout } from '#/components/ui'
import { getJobsToTry, getPromptForEdit } from '#/server/config-editor'

// /resume/prompt: the tailoring prompt, a second tab on the Resume page (not nested under it).
export const Route = createFileRoute('/resume_/prompt')({
  loader: async () => {
    const [prompt, jobs] = await Promise.all([getPromptForEdit(), getJobsToTry()])
    return { prompt, jobs }
  },
  // The editor keeps its own draft; don't reload the file under it (e.g. after Sync).
  staleTime: Infinity,
  shouldReload: false,
  head: () => ({ meta: [{ title: 'Tailoring prompt · Lantern' }] }),
  component: PromptPage,
})

function PromptPage() {
  const { prompt, jobs } = Route.useLoaderData()
  // Bumped by Reload after a conflict, to start the editor over from the fresh file.
  const [loaded, setLoaded] = useState(prompt.ok ? { ...prompt, n: 0 } : null)

  if (!prompt.ok || !loaded) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Callout tone="error">{prompt.ok ? 'Couldn’t load the prompt.' : prompt.message}</Callout>
      </div>
    )
  }
  return (
    <PromptEditor
      key={loaded.n}
      loaded={loaded}
      jobs={jobs}
      onReload={(l) => setLoaded({ ...l, ok: true, n: loaded.n + 1 })}
    />
  )
}
