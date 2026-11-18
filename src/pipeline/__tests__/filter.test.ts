import { describe, expect, it } from 'vitest'

import { createFilter } from '../filter'
import type { Eligibility, Profile } from '../schema'

const frontend: Profile = {
  id: 'frontend',
  enabled: true,
  titleInclude: ['frontend', 'front-end', 'software engineer', 'engineer'],
  titleExclude: ['intern', 'manager'],
  allowedEligibility: ['canada_onsite', 'canada_hybrid', 'remote_canada_ok'],
}

const job = (title: string, eligibility: Eligibility = 'remote_canada_ok') => ({
  title,
  eligibility,
})

describe('createFilter', () => {
  const filter = createFilter([frontend])

  it('keeps a matching title with an allowed eligibility', () => {
    expect(filter(job('Senior Frontend Engineer'))).toEqual({
      keep: true,
      profileIds: ['frontend'],
    })
  })

  it('matches include phrases case-insensitively', () => {
    expect(filter(job('SENIOR FRONTEND ENGINEER')).keep).toBe(true)
  })

  it('matches whole words only: "intern" does not exclude "International"', () => {
    expect(filter(job('International Payments Engineer'))).toEqual({
      keep: true,
      profileIds: ['frontend'],
    })
  })

  it('still excludes the whole word "intern"', () => {
    expect(filter(job('Software Engineer Intern'))).toEqual({ keep: false, reason: 'title' })
    expect(filter(job('Software Engineer (Intern)'))).toEqual({ keep: false, reason: 'title' })
  })

  it('excludes "Engineering Manager" via "manager"', () => {
    expect(filter(job('Engineering Manager'))).toEqual({ keep: false, reason: 'title' })
  })

  it('does not match an include phrase inside a longer word', () => {
    // "engineer" must not match "Engineering"
    expect(filter(job('Engineering Operations Lead'))).toEqual({ keep: false, reason: 'title' })
  })

  it('treats regex characters in phrases literally', () => {
    const f = createFilter([{ ...frontend, titleInclude: ['c++'], titleExclude: [] }])
    expect(f(job('C++ Developer')).keep).toBe(true)
    expect(f(job('C Developer')).keep).toBe(false)
  })

  it('rejects with reason "eligibility" when the title matches but eligibility is not allowed', () => {
    expect(filter(job('Senior Frontend Engineer', 'remote_us_only'))).toEqual({
      keep: false,
      reason: 'eligibility',
    })
  })

  it('rejects with reason "title" when no include phrase matches', () => {
    expect(filter(job('Account Executive'))).toEqual({ keep: false, reason: 'title' })
  })

  it('ignores disabled profiles', () => {
    const disabled: Profile = {
      ...frontend,
      id: 'off',
      enabled: false,
      allowedEligibility: ['remote_us_only'],
    }
    const f = createFilter([frontend, disabled])
    expect(f(job('Senior Frontend Engineer', 'remote_us_only'))).toEqual({
      keep: false,
      reason: 'eligibility',
    })
    expect(createFilter([disabled])(job('Senior Frontend Engineer', 'remote_us_only'))).toEqual({
      keep: false,
      reason: 'title',
    })
  })

  it('lists every enabled profile that matches', () => {
    const backend: Profile = {
      id: 'backend',
      enabled: true,
      titleInclude: ['engineer'],
      titleExclude: [],
      allowedEligibility: ['remote_canada_ok', 'unknown'],
    }
    const f = createFilter([frontend, backend])
    expect(f(job('Senior Frontend Engineer'))).toEqual({
      keep: true,
      profileIds: ['frontend', 'backend'],
    })
    expect(f(job('Senior Frontend Engineer', 'unknown'))).toEqual({
      keep: true,
      profileIds: ['backend'],
    })
  })

  it('an exclude in one profile does not block another profile', () => {
    const managers: Profile = {
      id: 'managers',
      enabled: true,
      titleInclude: ['engineering manager'],
      titleExclude: [],
      allowedEligibility: ['remote_canada_ok'],
    }
    const f = createFilter([frontend, managers])
    expect(f(job('Engineering Manager'))).toEqual({ keep: true, profileIds: ['managers'] })
  })
})
