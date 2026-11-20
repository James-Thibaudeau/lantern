import { newBulletId, newJobId } from '#/tailor/ids'
import type { Resume } from '#/tailor/resume'

import { Button } from '../ui'
import { CommaInput, RowActions, Section, TextArea, TextInput, move } from './fields'
import type { Edit } from './sections'

/**
 * Jobs and their bullets. Ids stay hidden: new ones come from `taken` (every id the resume has
 * ever had in this editor), so a deleted bullet's id is never given to a new bullet.
 */
export function ExperienceSection({
  resume,
  edit,
  taken,
}: {
  resume: Resume
  edit: Edit
  taken: Set<string>
}) {
  function addJob() {
    const id = newJobId('new job', String(new Date().getFullYear()), taken)
    taken.add(id)
    edit((d) =>
      d.experience.unshift({
        id,
        title: '',
        employer: '',
        dates: '',
        bullets: [],
        stack: [],
        compact: false,
      }),
    )
  }

  function addBullet(jobIndex: number, jobId: string) {
    const id = newBulletId(jobId, taken)
    taken.add(id)
    edit((d) => void d.experience[jobIndex].bullets.push({ id, text: '' }))
  }

  return (
    <Section
      title="Experience"
      action={
        <Button size="sm" onClick={addJob}>
          Add job
        </Button>
      }
    >
      {resume.experience.map((j, i) => (
        <article key={j.id} className="rounded-lg border border-line bg-sunken p-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="min-w-0 truncate pt-1 text-sm font-semibold">
              {j.title || 'New job'}
              {j.employer && <span className="font-normal text-muted"> · {j.employer}</span>}
            </p>
            <RowActions
              what={`job ${j.title || 'new job'}`}
              index={i}
              count={resume.experience.length}
              onMove={(to) => edit((d) => move(d.experience, i, to))}
              onDelete={() => {
                if (j.bullets.length === 0 || window.confirm(`Delete ${j.title || 'this job'}?`)) {
                  edit((d) => void d.experience.splice(i, 1))
                }
              }}
            />
          </div>
          <div className="grid gap-2 @md:grid-cols-2">
            <TextInput
              label="Title"
              value={j.title}
              onChange={(v) => edit((d) => (d.experience[i].title = v))}
            />
            <TextInput
              label="Employer"
              value={j.employer}
              onChange={(v) => edit((d) => (d.experience[i].employer = v))}
            />
            <TextInput
              label="Dates"
              value={j.dates}
              placeholder="2023 – Present"
              onChange={(v) => edit((d) => (d.experience[i].dates = v))}
            />
            <label className="flex items-center gap-2 self-end pb-1.5 text-sm text-muted">
              <input
                type="checkbox"
                className="accent-accent-600"
                checked={j.compact}
                onChange={(e) => edit((d) => (d.experience[i].compact = e.target.checked))}
              />
              Short entry (shown small, with internships)
            </label>
          </div>
          <div className="mt-2 space-y-2">
            <TextInput
              label="Context line"
              value={j.context ?? ''}
              placeholder="Team, or what the company does"
              onChange={(v) => edit((d) => (d.experience[i].context = v || undefined))}
            />
            <CommaInput
              label="Stack"
              value={j.stack}
              onChange={(v) => edit((d) => (d.experience[i].stack = v))}
            />
          </div>

          <h3 className="mt-3 mb-1 text-xs font-medium text-muted">Bullets</h3>
          <ol className="space-y-2">
            {j.bullets.map((b, k) => (
              <li
                key={b.id}
                className="flex flex-col-reverse gap-1 @md:flex-row @md:items-start @md:gap-2"
              >
                <div className="min-w-0 flex-1">
                  <TextArea
                    label={`Bullet ${k + 1}`}
                    hideLabel
                    value={b.text}
                    onChange={(v) => edit((d) => (d.experience[i].bullets[k].text = v))}
                  />
                </div>
                <RowActions
                  what={`bullet ${k + 1}`}
                  index={k}
                  count={j.bullets.length}
                  onMove={(to) => edit((d) => move(d.experience[i].bullets, k, to))}
                  onDelete={() => edit((d) => void d.experience[i].bullets.splice(k, 1))}
                />
              </li>
            ))}
          </ol>
          <Button size="sm" className="mt-2" onClick={() => addBullet(i, j.id)}>
            Add bullet
          </Button>
        </article>
      ))}
    </Section>
  )
}
