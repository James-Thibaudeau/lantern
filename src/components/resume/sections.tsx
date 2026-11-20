import type { Resume } from '#/tailor/resume'

import { Button } from '../ui'
import { CommaInput, RowActions, Section, TextArea, TextInput, move } from './fields'

/** Applies a change to a copy of the draft. */
export type Edit = (change: (draft: Resume) => void) => void

export function BasicsSection({ resume, edit }: { resume: Resume; edit: Edit }) {
  const b = resume.basics
  return (
    <Section title="Basics">
      <div className="grid gap-3 @md:grid-cols-2">
        <TextInput label="Name" value={b.name} onChange={(v) => edit((d) => (d.basics.name = v))} />
        <TextInput
          label="Headline"
          value={b.headline}
          onChange={(v) => edit((d) => (d.basics.headline = v))}
        />
        <TextInput
          label="Location"
          value={b.location ?? ''}
          onChange={(v) => edit((d) => (d.basics.location = v || undefined))}
        />
        <TextInput
          label="Phone"
          value={b.phone ?? ''}
          onChange={(v) => edit((d) => (d.basics.phone = v || undefined))}
        />
        <TextInput
          label="Email"
          value={b.email ?? ''}
          onChange={(v) => edit((d) => (d.basics.email = v || undefined))}
          className="sm:col-span-2"
        />
      </div>
      {b.links.map((l, i) => (
        // These items have no ids and their inputs are controlled, so position keys are safe.
        // oxlint-disable-next-line react/no-array-index-key
        <div key={i} className="rounded-lg bg-sunken p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted">Link {i + 1}</span>
            <RowActions
              what={`link ${l.label}`}
              index={i}
              count={b.links.length}
              onMove={(to) => edit((d) => move(d.basics.links, i, to))}
              onDelete={() => edit((d) => void d.basics.links.splice(i, 1))}
            />
          </div>
          <div className="grid gap-2 @md:grid-cols-[8rem_minmax(0,1fr)]">
            <TextInput
              label="Label"
              value={l.label}
              onChange={(v) => edit((d) => (d.basics.links[i].label = v))}
            />
            <TextInput
              label="URL"
              value={l.url}
              onChange={(v) => edit((d) => (d.basics.links[i].url = v))}
            />
          </div>
        </div>
      ))}
      <Button
        size="sm"
        onClick={() => edit((d) => void d.basics.links.push({ label: 'Website', url: 'https://' }))}
      >
        Add link
      </Button>
    </Section>
  )
}

export function SummarySection({ resume, edit }: { resume: Resume; edit: Edit }) {
  return (
    <Section title="Summary">
      <TextArea
        label="Summary"
        hideLabel
        minRows={3}
        value={resume.summary}
        onChange={(v) => edit((d) => (d.summary = v))}
      />
    </Section>
  )
}

export function SkillsSection({ resume, edit }: { resume: Resume; edit: Edit }) {
  return (
    <Section
      title="Skills"
      action={
        <Button
          size="sm"
          onClick={() => edit((d) => void d.skills.push({ group: 'New group', items: [] }))}
        >
          Add group
        </Button>
      }
    >
      {resume.skills.map((g, i) => (
        // These items have no ids and their inputs are controlled, so position keys are safe.
        // oxlint-disable-next-line react/no-array-index-key
        <div key={i} className="rounded-lg bg-sunken p-3">
          <div className="mb-2 flex items-end gap-2">
            <TextInput
              label="Group"
              value={g.group}
              onChange={(v) => edit((d) => (d.skills[i].group = v))}
              className="min-w-0 flex-1"
            />
            <RowActions
              what={`skill group ${g.group}`}
              index={i}
              count={resume.skills.length}
              onMove={(to) => edit((d) => move(d.skills, i, to))}
              onDelete={() => edit((d) => void d.skills.splice(i, 1))}
            />
          </div>
          {/* Keyed by position on purpose: moving a group restarts this field with its items. */}
          <CommaInput
            // oxlint-disable-next-line react/no-array-index-key
            key={`${i}:${g.group}`}
            label="Skills"
            value={g.items}
            onChange={(v) => edit((d) => (d.skills[i].items = v))}
          />
        </div>
      ))}
    </Section>
  )
}

export function PatentsSection({ resume, edit }: { resume: Resume; edit: Edit }) {
  return (
    <Section
      title="Patents"
      action={
        <Button size="sm" onClick={() => edit((d) => void d.patents.push({ title: '' }))}>
          Add patent
        </Button>
      }
    >
      {resume.patents.length === 0 && <p className="text-sm text-muted">None.</p>}
      {resume.patents.map((p, i) => (
        // These items have no ids and their inputs are controlled, so position keys are safe.
        // oxlint-disable-next-line react/no-array-index-key
        <div key={i} className="space-y-2 rounded-lg bg-sunken p-3">
          <div className="flex items-end gap-2">
            <TextInput
              label="Title"
              value={p.title}
              onChange={(v) => edit((d) => (d.patents[i].title = v))}
              className="min-w-0 flex-1"
            />
            <RowActions
              what="patent"
              index={i}
              count={resume.patents.length}
              onMove={(to) => edit((d) => move(d.patents, i, to))}
              onDelete={() => edit((d) => void d.patents.splice(i, 1))}
            />
          </div>
          <div className="grid gap-2 @md:grid-cols-2">
            <TextInput
              label="Number"
              value={p.number ?? ''}
              onChange={(v) => edit((d) => (d.patents[i].number = v || undefined))}
            />
            <TextInput
              label="Link"
              value={p.url ?? ''}
              onChange={(v) => edit((d) => (d.patents[i].url = v || undefined))}
            />
          </div>
        </div>
      ))}
    </Section>
  )
}

export function EducationSection({ resume, edit }: { resume: Resume; edit: Edit }) {
  return (
    <Section
      title="Education"
      action={
        <Button
          size="sm"
          onClick={() =>
            edit((d) => void d.education.push({ credential: '', school: '', year: '' }))
          }
        >
          Add
        </Button>
      }
    >
      {resume.education.map((e, i) => (
        // These items have no ids and their inputs are controlled, so position keys are safe.
        // oxlint-disable-next-line react/no-array-index-key
        <div key={i} className="flex flex-wrap items-end gap-2">
          <TextInput
            label="Credential"
            value={e.credential}
            onChange={(v) => edit((d) => (d.education[i].credential = v))}
            className="min-w-40 flex-1"
          />
          <TextInput
            label="School"
            value={e.school}
            onChange={(v) => edit((d) => (d.education[i].school = v))}
            className="min-w-40 flex-1"
          />
          <TextInput
            label="Year"
            value={e.year}
            onChange={(v) => edit((d) => (d.education[i].year = v))}
            className="w-20"
          />
          <RowActions
            what="education entry"
            index={i}
            count={resume.education.length}
            onMove={(to) => edit((d) => move(d.education, i, to))}
            onDelete={() => edit((d) => void d.education.splice(i, 1))}
          />
        </div>
      ))}
    </Section>
  )
}
