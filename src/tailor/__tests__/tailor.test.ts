import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LocalConfigStore } from '../../watchlist/runner-config'
import { applyDecisions, listChanges } from '../changes'
import { checkTailoring, numbersIn, termsIn } from '../check'
import { SYSTEM_PROMPT } from '../prompt'
import { renderResume } from '../render'
import { ResumeSchema, parseResume, type Resume } from '../resume'
import type { Tailoring } from '../schema'
import { readTailoring, resumeFileName, storeTailoring } from '../stored'
import { promptHash, tailorResume, type TailorModel } from '../tailor'

const master: Resume = ResumeSchema.parse({
  basics: {
    name: 'Ada Example',
    headline: 'Frontend Engineer',
    email: 'ada@example.com',
    links: [{ label: 'GitHub', url: 'https://github.com/example' }],
  },
  summary: 'Frontend engineer with 8 years building React apps.',
  skills: [
    { group: 'Languages', items: ['TypeScript', 'JavaScript', 'Go'] },
    { group: 'Tools', items: ['Vite', 'Vitest'] },
  ],
  experience: [
    {
      id: 'acme',
      title: 'Senior Engineer',
      employer: 'Acme',
      dates: '2020 – Present',
      bullets: [
        { id: 'acme-ci', text: 'Cut CI time 50% (10 min to 5 min) by caching builds.' },
        { id: 'acme-ui', text: 'Built the design system used by 4 product teams.' },
        { id: 'acme-ops', text: 'Ran the on-call rotation.' },
      ],
      stack: ['React', 'Vite'],
    },
    {
      id: 'initech',
      title: 'Developer',
      employer: 'Initech',
      dates: '2016 – 2020',
      bullets: [{ id: 'ini-reports', text: 'Rewrote the reporting UI in React.' }],
    },
    { id: 'intern', title: 'Intern', employer: 'Startup <Co>', dates: '2015', compact: true },
  ],
  education: [{ credential: 'BSc Computer Science', school: 'Example U', year: '2015' }],
})

const tailoring = (over: Partial<Tailoring> = {}): Tailoring => ({
  summary: master.summary,
  skills: master.skills.map((g) => ({ group: g.group, items: [...g.items] })),
  experience: master.experience.map((j) => ({
    id: j.id,
    bullets: j.bullets.map((b) => ({ sourceId: b.id, text: b.text })),
  })),
  fitNotes: { matches: ['React'], gaps: ['Kubernetes'], interviewTopics: ['CI'] },
  ...over,
})

describe('numbersIn / termsIn', () => {
  it('reads numbers without thousands separators', () => {
    expect([...numbersIn('1,000+ files, 7–8x faster, 2.4 s, 94%')]).toEqual([
      '1000',
      '7',
      '8',
      '2.4',
      '94',
    ])
  })

  it('finds product-like terms but not sentence-initial words', () => {
    expect(termsIn('Built apps with Next.js and Kubernetes. Shipped it.')).toEqual([
      'Next.js',
      'Kubernetes',
    ])
  })
})

describe('checkTailoring', () => {
  it('passes a faithful tailoring through unchanged', () => {
    const t = tailoring({
      experience: [
        {
          id: 'acme',
          bullets: [
            { sourceId: 'acme-ui', text: 'Built the design system 4 product teams use.' },
            { sourceId: 'acme-ci', text: 'Cut CI time 50% (10 min to 5 min) by caching builds.' },
          ],
        },
        {
          id: 'initech',
          bullets: [{ sourceId: 'ini-reports', text: 'Rewrote the reporting UI in React.' }],
        },
        { id: 'intern', bullets: [] },
      ],
    })
    const r = checkTailoring(master, t)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.tailoring.experience[0].bullets.map((b) => b.sourceId)).toEqual(['acme-ui', 'acme-ci'])
  })

  it('keeps the original wording when a bullet gains a number', () => {
    const t = tailoring({
      experience: [
        {
          id: 'acme',
          bullets: [{ sourceId: 'acme-ci', text: 'Cut CI time 80% by caching builds.' }],
        },
      ],
    })
    const r = checkTailoring(master, t)
    expect(r.errors).toEqual([expect.objectContaining({ key: 'reword:acme-ci' })])
    expect(r.errors[0].message).toContain('80')
    expect(r.tailoring.experience[0].bullets[0].text).toBe(master.experience[0].bullets[0].text)
  })

  it('drops bullets that are unknown or belong to another job', () => {
    const t = tailoring({
      experience: [
        {
          id: 'acme',
          bullets: [
            { sourceId: 'ini-reports', text: 'Rewrote the reporting UI in React.' },
            { sourceId: 'made-up', text: 'Led a team of 20.' },
            { sourceId: 'acme-ops', text: 'Ran the on-call rotation.' },
          ],
        },
      ],
    })
    const r = checkTailoring(master, t)
    expect(r.errors.map((e) => e.message)).toEqual([
      expect.stringContaining('belongs to initech'),
      expect.stringContaining('unknown id "made-up"'),
    ])
    expect(r.tailoring.experience[0].bullets.map((b) => b.sourceId)).toEqual(['acme-ops'])
  })

  it('drops skills and jobs that are not in the resume', () => {
    const t = tailoring({
      skills: [
        { group: 'Languages', items: ['typescript', 'Rust'] },
        { group: 'Cloud', items: ['AWS'] },
      ],
      experience: [{ id: 'globex', bullets: [] }],
    })
    const r = checkTailoring(master, t)
    expect(r.tailoring.skills).toEqual([{ group: 'Languages', items: ['TypeScript'] }])
    expect(r.tailoring.experience).toEqual([])
    expect(r.errors).toHaveLength(3)
  })

  it('reverts a summary with invented numbers, and warns about new terms', () => {
    const invented = checkTailoring(
      master,
      tailoring({ summary: 'Engineer with 12 years of React.' }),
    )
    expect(invented.tailoring.summary).toBe(master.summary)
    expect(invented.errors[0].key).toBe('summary')

    const newTerm = checkTailoring(
      master,
      tailoring({ summary: 'Frontend engineer with 8 years building React and Kubernetes apps.' }),
    )
    expect(newTerm.errors).toEqual([])
    expect(newTerm.warnings[0].message).toContain('Kubernetes')
  })

  it('warns when the years-of-experience claim gains a technology', () => {
    const r = checkTailoring(
      master,
      tailoring({
        summary: 'Frontend engineer with 8 years building TypeScript apps. Uses React.',
      }),
    )
    expect(r.warnings).toEqual([
      expect.objectContaining({ key: 'summary', message: expect.stringContaining('TypeScript') }),
    ])
    // React was already in the original years sentence, so it isn't flagged.
    expect(r.warnings[0].message).not.toContain('React')
  })

  it('warns when a bullet is heavily reworded', () => {
    const t = tailoring({
      experience: [
        {
          id: 'acme',
          bullets: [{ sourceId: 'acme-ops', text: 'Owned production reliability end to end.' }],
        },
      ],
    })
    expect(checkTailoring(master, t).warnings).toEqual([
      expect.objectContaining({
        key: 'reword:acme-ops',
        message: expect.stringContaining('Heavily'),
      }),
    ])
  })
})

describe('listChanges / applyDecisions', () => {
  const t = tailoring({
    summary: 'React-focused frontend engineer with 8 years of experience.',
    skills: [
      { group: 'Languages', items: ['TypeScript', 'JavaScript'] },
      { group: 'Tools', items: ['Vite', 'Vitest'] },
    ],
    experience: [
      {
        id: 'acme',
        bullets: [
          { sourceId: 'acme-ui', text: 'Built the design system 4 product teams use.' },
          { sourceId: 'acme-ci', text: 'Cut CI time 50% (10 min to 5 min) by caching builds.' },
        ],
      },
      {
        id: 'initech',
        bullets: [{ sourceId: 'ini-reports', text: 'Rewrote the reporting UI in React.' }],
      },
      { id: 'intern', bullets: [] },
    ],
  })

  it('lists each difference once', () => {
    expect(listChanges(master, t).map((c) => c.key)).toEqual([
      'summary',
      'skills:Languages',
      'bullets:acme',
      'reword:acme-ui',
    ])
    expect(listChanges(master, tailoring())).toEqual([])
  })

  it('applies every change by default', () => {
    const r = applyDecisions(master, t, {})
    expect(r.summary).toBe(t.summary)
    expect(r.skills[0].items).toEqual(['TypeScript', 'JavaScript'])
    expect(r.experience[0].bullets.map((b) => b.text)).toEqual([
      'Built the design system 4 product teams use.',
      'Cut CI time 50% (10 min to 5 min) by caching builds.',
    ])
    expect(r.experience[0].title).toBe('Senior Engineer')
  })

  it('reverts changes one by one', () => {
    const r = applyDecisions(master, t, {
      summary: false,
      'skills:Languages': false,
      'bullets:acme': false,
      'reword:acme-ui': false,
    })
    expect(r).toEqual(master)

    const keepOrderOnly = applyDecisions(master, t, { 'reword:acme-ui': false })
    expect(keepOrderOnly.experience[0].bullets[0].text).toBe(
      'Built the design system used by 4 product teams.',
    )
  })
})

describe('renderResume', () => {
  it('renders every part of the resume, escaped', () => {
    const html = renderResume(master)
    for (const text of [
      'Ada Example',
      'Frontend Engineer',
      master.summary,
      'TypeScript, JavaScript, Go',
      'Cut CI time 50% (10 min to 5 min) by caching builds.',
      'Startup &lt;Co&gt;',
      'BSc Computer Science',
      'href="https://github.com/example"',
      '@page { size: letter',
    ]) {
      expect(html).toContain(text)
    }
    expect(html).not.toContain('<Co>')
    expect(html).toContain('<div class="compact">')
  })
})

describe('storage helpers', () => {
  it('reads back a stored tailoring with decisions applied', () => {
    const t = tailoring({ summary: 'React engineer with 8 years of experience.' })
    const read = readTailoring(
      storeTailoring(master, t),
      { errors: [], warnings: [], fitNotes: t.fitNotes },
      {
        summary: false,
      },
    )
    expect(read?.changes.map((c) => c.key)).toEqual(['summary'])
    expect(read?.final.summary).toBe(master.summary)
    expect(readTailoring({ something: 'else' }, null, {})).toBeNull()
  })

  it('builds a safe file name', () => {
    expect(resumeFileName('Ada Example', 'Acme/Co', 'Senior: Engineer?')).toBe(
      'Ada Example - Acme Co - Senior Engineer.html',
    )
  })
})

describe('tailorResume', () => {
  it('validates the reply and checks it against the resume', async () => {
    const model: TailorModel = {
      run: async () => ({
        output: tailoring({ summary: 'Engineer with 30 years of React.' }),
        usage: null,
        model: 'fake',
      }),
    }
    const r = await tailorResume(
      master,
      { title: 'FE', company: 'X', locationText: '', salary: null, descriptionText: '' },
      model,
    )
    expect(r.tailoring.summary).toBe(master.summary)
    expect(r.checks.errors).toHaveLength(1)
    expect(r.model).toBe('fake')
  })

  it('sends the prompt it is given and records its hash', async () => {
    const seen: string[] = []
    const model: TailorModel = {
      run: async ({ system }) => {
        seen.push(system)
        return { output: tailoring(), usage: null, model: 'fake' }
      },
    }
    const posting = {
      title: 'FE',
      company: 'X',
      locationText: '',
      salary: null,
      descriptionText: '',
    }
    const builtIn = await tailorResume(master, posting, model)
    const custom = await tailorResume(master, posting, model, '  Be brief.\n')
    expect(seen[0]).toBe(SYSTEM_PROMPT)
    expect(seen[1]).toBe('Be brief.')
    expect(custom.promptHash).toBe(promptHash('Be brief.'))
    expect(custom.promptHash).not.toBe(builtIn.promptHash)
    expect(custom.request).toContain('<posting>')
  })

  it('rejects a reply in the wrong shape', async () => {
    const model: TailorModel = {
      run: async () => ({ output: { summary: 1 }, usage: null, model: 'fake' }),
    }
    await expect(
      tailorResume(
        master,
        { title: '', company: '', locationText: '', salary: null, descriptionText: '' },
        model,
      ),
    ).rejects.toThrow('expected shape')
  })
})

describe('resume.json', () => {
  it('reads it from a local folder, or null when missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lantern-resume-'))
    try {
      const store = new LocalConfigStore(dir)
      await expect(store.readResume()).resolves.toBeNull()
      await writeFile(join(dir, 'resume.json'), JSON.stringify(master))
      await expect(store.readResume()).resolves.toEqual(master)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects duplicate ids and unknown fields', () => {
    const dup = { ...master, experience: [master.experience[0], master.experience[0]] }
    expect(() => parseResume('resume.json', JSON.stringify(dup))).toThrow('Duplicate id')
    expect(() => parseResume('resume.json', JSON.stringify({ ...master, sumary: 'x' }))).toThrow(
      'sumary',
    )
  })

  it('has a valid example in the runner template', async () => {
    const text = await readFile(
      new URL('../../../runner-template/config/resume.example.json', import.meta.url),
      'utf8',
    )
    expect(parseResume('resume.example.json', text).experience.length).toBeGreaterThan(0)
  })
})
