import { describe, expect, it } from 'vitest'

import { idsIn, newBulletId, newJobId, slugify } from '../ids'
import { ResumeSchema } from '../resume'

describe('resume ids', () => {
  it('slugifies names', () => {
    expect(slugify('Acme Corp.')).toBe('acme-corp')
    expect(slugify('  Société Générale ')).toBe('societe-generale')
    expect(slugify('***')).toBe('')
  })

  it('makes job ids from the employer and start year, unique among taken ids', () => {
    const taken = new Set(['acme-2024'])
    expect(newJobId('Acme', '2024 – Present', taken)).toBe('acme-2024-2')
    expect(newJobId('', 'sometime', new Set())).toBe('job')
  })

  it('makes bullet ids that never collide with taken ones', () => {
    let n = 0
    // The first suffix collides with a taken (e.g. deleted) id, so the next one is used.
    const random = () => [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5][n++ % 8]
    const taken = new Set(['acme-0000'])
    expect(newBulletId('acme', taken, random)).toBe('acme-iiii')
  })

  it('collects every job and bullet id, and new ids pass the schema', () => {
    const resume = ResumeSchema.parse({
      basics: { name: 'A', headline: 'B' },
      summary: 'S',
      experience: [
        {
          id: newJobId('Acme Corp', '2020', new Set()),
          title: 'T',
          employer: 'Acme Corp',
          dates: '2020',
          bullets: [{ id: newBulletId('acme-corp-2020', new Set()), text: 'Did things' }],
        },
      ],
    })
    expect(idsIn(resume).size).toBe(2)
  })
})
