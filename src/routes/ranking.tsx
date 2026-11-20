import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { CriteriaEditor } from '#/components/ranking/CriteriaEditor'
import { Callout, PageHeader } from '#/components/ui'
import { getCriteriaForEdit } from '#/server/config-editor'

export const Route = createFileRoute('/ranking')({
  loader: () => getCriteriaForEdit(),
  head: () => ({ meta: [{ title: 'Ranking · Lantern' }] }),
  component: RankingPage,
})

function RankingPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  // Bumped after a reload, so the editor starts over from the freshly loaded criteria.
  const [generation, setGeneration] = useState(0)

  async function reload() {
    await router.invalidate()
    setGeneration((g) => g + 1)
  }

  if (!data.ok) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <PageHeader title="Ranking" subtitle="How jobs are scored" />
        <Callout tone="error">
          <p className="whitespace-pre-line">{data.message}</p>
        </Callout>
      </div>
    )
  }
  return <CriteriaEditor key={generation} loaded={data} onReload={reload} />
}
