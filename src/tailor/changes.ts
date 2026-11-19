import type { Resume } from './resume'
import type { Tailoring } from './schema'

// A tailoring as a list of changes you can accept or revert one by one, and the resume you
// get from your decisions. Changes are accepted unless you revert them.
//
// Keys: "summary", "skills:<group>", "bullets:<jobId>" (which bullets, in what order) and
// "reword:<bulletId>" (one bullet's new wording).

export type Change =
  | { key: string; kind: 'summary'; before: string; after: string }
  | { key: string; kind: 'skills'; group: string; before: string[]; after: string[] }
  | {
      key: string
      kind: 'bullets'
      jobId: string
      employer: string
      title: string
      /** Bullet ids in order. */
      before: string[]
      after: string[]
      dropped: string[]
    }
  | { key: string; kind: 'reword'; jobId: string; bulletId: string; before: string; after: string }

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** The differences between the master resume and a (checked) tailoring. */
export function listChanges(master: Resume, t: Tailoring): Change[] {
  const changes: Change[] = []
  if (t.summary !== master.summary) {
    changes.push({ key: 'summary', kind: 'summary', before: master.summary, after: t.summary })
  }
  for (const g of master.skills) {
    const after = t.skills.find((s) => s.group === g.group)?.items
    if (after && !same(after, g.items)) {
      changes.push({
        key: `skills:${g.group}`,
        kind: 'skills',
        group: g.group,
        before: g.items,
        after,
      })
    }
  }
  for (const j of master.experience) {
    const tj = t.experience.find((e) => e.id === j.id)
    if (!tj) continue
    const before = j.bullets.map((b) => b.id)
    const after = tj.bullets.map((b) => b.sourceId)
    if (!same(before, after)) {
      changes.push({
        key: `bullets:${j.id}`,
        kind: 'bullets',
        jobId: j.id,
        employer: j.employer,
        title: j.title,
        before,
        after,
        dropped: before.filter((id) => !after.includes(id)),
      })
    }
    for (const b of tj.bullets) {
      const source = j.bullets.find((x) => x.id === b.sourceId)
      if (source && source.text !== b.text) {
        changes.push({
          key: `reword:${b.sourceId}`,
          kind: 'reword',
          jobId: j.id,
          bulletId: b.sourceId,
          before: source.text,
          after: b.text,
        })
      }
    }
  }
  return changes
}

/** The resume with every change applied except the ones you reverted. */
export function applyDecisions(
  master: Resume,
  t: Tailoring,
  decisions: Record<string, boolean>,
): Resume {
  const accepted = (key: string) => !Object.hasOwn(decisions, key) || decisions[key]
  return {
    ...master,
    summary: accepted('summary') ? t.summary : master.summary,
    skills: master.skills.map((g) => {
      const after = t.skills.find((s) => s.group === g.group)?.items
      return after && accepted(`skills:${g.group}`) ? { ...g, items: after } : g
    }),
    experience: master.experience.map((j) => {
      const tj = t.experience.find((e) => e.id === j.id)
      if (!tj) return j
      const reworded = new Map(tj.bullets.map((b) => [b.sourceId, b.text]))
      const ids = accepted(`bullets:${j.id}`)
        ? tj.bullets.map((b) => b.sourceId)
        : j.bullets.map((b) => b.id)
      const bullets = ids.flatMap((id) => {
        const source = j.bullets.find((b) => b.id === id)
        if (!source) return []
        const text = reworded.get(id)
        return [{ id, text: text !== undefined && accepted(`reword:${id}`) ? text : source.text }]
      })
      return { ...j, bullets }
    }),
  }
}
