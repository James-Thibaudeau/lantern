import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { ResumeEditor } from '#/components/resume/ResumeEditor'
import { Callout } from '#/components/ui'
import { getResumeForEdit } from '#/server/config-editor'

export const Route = createFileRoute('/resume')({
  loader: () => getResumeForEdit(),
  // The editor keeps its own draft; don't reload the file under it (e.g. after Sync).
  staleTime: Infinity,
  shouldReload: false,
  head: () => ({ meta: [{ title: 'Resume · Lantern' }] }),
  component: ResumePage,
})

function ResumePage() {
  const first = Route.useLoaderData()
  // Bumped by Reload after a conflict, to start the editor over from the fresh file.
  const [loaded, setLoaded] = useState(first.ok ? { ...first, n: 0 } : null)

  if (!first.ok || !loaded) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Callout tone="error">
          <p className="whitespace-pre-line">
            {first.ok ? 'Couldn’t load resume.json.' : first.message}
          </p>
        </Callout>
      </div>
    )
  }
  return (
    <ResumeEditor
      key={loaded.n}
      loaded={loaded}
      onReload={(l) => setLoaded({ ...l, ok: true, n: loaded.n + 1 })}
    />
  )
}
