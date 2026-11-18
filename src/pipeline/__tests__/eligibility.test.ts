import { describe, expect, it } from 'vitest'

import { classifyEligibility, mentionsCanada, type EligibilityInput } from '../eligibility'
import type { Eligibility, WorkplaceType } from '../schema'

// Inputs are shaped the way each adapter builds them (see adapters/*.ts), so these
// cases mirror what the real watchlist postings produce.

/** Greenhouse: location text only, no structured country or workplace type. */
function gh(text: string, descriptionText?: string): EligibilityInput {
  return { locations: [{ text }], workplaceType: null, descriptionText }
}

/** Ashby: primary location carries country + workplace type; secondaries carry text + country. */
function ashby(opts: {
  location: string
  workplaceType: WorkplaceType | null
  country?: string | null
  secondary?: { location: string; country?: string | null }[]
}): EligibilityInput {
  return {
    locations: [
      { text: opts.location, country: opts.country, workplaceType: opts.workplaceType },
      ...(opts.secondary ?? []).map((s) => ({ text: s.location, country: s.country })),
    ],
    workplaceType: opts.workplaceType,
  }
}

/** Lever: primary location carries ISO country + workplace type. */
function lever(opts: {
  location: string
  country: string | null
  workplaceType: WorkplaceType | null
}): EligibilityInput {
  return {
    locations: [{ text: opts.location, country: opts.country, workplaceType: opts.workplaceType }],
    workplaceType: opts.workplaceType,
  }
}

const label = (input: EligibilityInput) => classifyEligibility(input).eligibility

describe('classifyEligibility: Greenhouse location text', () => {
  const cases: [string, Eligibility][] = [
    ['Remote (Canada)', 'remote_canada_ok'],
    ['Remote, Canada; Remote, United States', 'remote_canada_ok'],
    ['Remote - Canada', 'remote_canada_ok'],
    ['Remote, United States', 'remote_us_only'],
    ['Remote, US', 'remote_us_only'],
    ['Remote (United States)', 'remote_us_only'],
    ['Remote, United Kingdom', 'remote_non_canada'],
    ['Remote, Australia; Remote, Singapore', 'remote_non_canada'],
    ['New York City, NY; San Francisco, CA', 'non_canada_onsite'],
    ['Bangalore, India', 'non_canada_onsite'],
    ['Kitchener-Waterloo, ON; Toronto, ON', 'canada_onsite'],
    ['Hybrid (Toronto, Ontario)', 'canada_hybrid'],
    ['Remote, North America', 'remote_canada_ok'],
    ['London, UK', 'non_canada_onsite'],
  ]

  it.each(cases)('%s → %s', (text, expected) => {
    expect(label(gh(text))).toBe(expected)
  })
})

describe('classifyEligibility: description phrases when the location is just "Remote"', () => {
  it('stays unknown with no description hints', () => {
    expect(label(gh('Remote'))).toBe('unknown')
    expect(label(gh('Remote', 'We are a friendly team building great software.'))).toBe('unknown')
  })

  it('US work authorization → remote_us_only', () => {
    const r = classifyEligibility(gh('Remote', 'You must be authorized to work in the U.S.'))
    expect(r).toEqual({ eligibility: 'remote_us_only', country: 'US', workplaceType: 'remote' })
  })

  it('"remote within Canada" → remote_canada_ok', () => {
    const r = classifyEligibility(gh('Remote', 'This role is remote within Canada.'))
    expect(r).toEqual({ eligibility: 'remote_canada_ok', country: 'CA', workplaceType: 'remote' })
  })

  it('a Canada phrase wins over a US phrase', () => {
    const desc =
      'This role is remote within Canada. Candidates in the US must be authorized to work in the U.S.'
    expect(label(gh('Remote', desc))).toBe('remote_canada_ok')
  })

  it('ignores description phrases when the location already names a country', () => {
    expect(label(gh('Remote, United Kingdom', 'This role is remote within Canada.'))).toBe(
      'remote_non_canada',
    )
  })
})

describe('classifyEligibility: Ashby structured fields', () => {
  it('"Remote (United States | Canada)", remote → remote_canada_ok', () => {
    expect(
      label(ashby({ location: 'Remote (United States | Canada)', workplaceType: 'remote' })),
    ).toBe('remote_canada_ok')
  })

  it('"KOHO (CAN)", remote, country Canada → remote_canada_ok', () => {
    expect(
      label(ashby({ location: 'KOHO (CAN)', workplaceType: 'remote', country: 'Canada' })),
    ).toBe('remote_canada_ok')
  })

  it('"KOHO (CAN)" is recognized from the text alone', () => {
    expect(label(ashby({ location: 'KOHO (CAN)', workplaceType: 'remote' }))).toBe(
      'remote_canada_ok',
    )
  })

  it('"San Francisco, California", hybrid, country United States → non_canada_onsite', () => {
    const r = classifyEligibility(
      ashby({
        location: 'San Francisco, California',
        workplaceType: 'hybrid',
        country: 'United States',
      }),
    )
    expect(r.eligibility).toBe('non_canada_onsite')
    expect(r.country).toBe('US')
    expect(r.workplaceType).toBe('hybrid')
  })

  it('"Toronto, ON", hybrid, secondary "Austin, TX" → canada_hybrid', () => {
    const r = classifyEligibility(
      ashby({
        location: 'Toronto, ON',
        workplaceType: 'hybrid',
        secondary: [{ location: 'Austin, TX' }],
      }),
    )
    expect(r).toEqual({ eligibility: 'canada_hybrid', country: 'CA', workplaceType: 'hybrid' })
  })

  it('"United States", onsite, secondary "Canada" → canada_onsite', () => {
    const r = classifyEligibility(
      ashby({
        location: 'United States',
        workplaceType: 'onsite',
        country: 'United States',
        secondary: [{ location: 'Canada', country: 'Canada' }],
      }),
    )
    expect(r).toEqual({ eligibility: 'canada_onsite', country: 'CA', workplaceType: 'onsite' })
  })

  it('uses the structured country when the text names no place', () => {
    expect(
      label(ashby({ location: 'Headquarters', workplaceType: 'onsite', country: 'Canada' })),
    ).toBe('canada_onsite')
    expect(
      label(ashby({ location: 'Headquarters', workplaceType: 'remote', country: 'United States' })),
    ).toBe('remote_us_only')
  })
})

describe('classifyEligibility: Lever structured fields', () => {
  it('"Ottawa, ON", country CA, remote → remote_canada_ok', () => {
    const r = classifyEligibility(
      lever({ location: 'Ottawa, ON', country: 'CA', workplaceType: 'remote' }),
    )
    expect(r).toEqual({ eligibility: 'remote_canada_ok', country: 'CA', workplaceType: 'remote' })
  })

  it('"Ashland, VA", country US, onsite → non_canada_onsite', () => {
    const r = classifyEligibility(
      lever({ location: 'Ashland, VA', country: 'US', workplaceType: 'onsite' }),
    )
    expect(r).toEqual({ eligibility: 'non_canada_onsite', country: 'US', workplaceType: 'onsite' })
  })
})

describe('classifyEligibility: edge cases', () => {
  it('no locations at all → unknown', () => {
    expect(classifyEligibility({ locations: [] })).toEqual({
      eligibility: 'unknown',
      country: null,
      workplaceType: null,
    })
  })

  it('empty text with no structured data → unknown', () => {
    expect(label({ locations: [{ text: '' }] })).toBe('unknown')
  })

  it('a region that includes Canada only counts when the job is remote', () => {
    expect(label(gh('North America'))).toBe('unknown')
    expect(label(gh('Remote - Americas'))).toBe('remote_canada_ok')
  })

  it('reports another country by name for non-Canadian onsite jobs', () => {
    expect(classifyEligibility(gh('Bangalore, India')).country).toMatch(/bangalore|india/i)
  })
})

describe('classifyEligibility: fixes found on the first real run', () => {
  it('matches "United States" in any case', () => {
    expect(classifyEligibility(gh('remote, united states')).eligibility).toBe('remote_us_only')
  })

  it('ignores a bare "Remote" piece when another piece names a place', () => {
    const input: EligibilityInput = {
      locations: [{ text: 'Remote', workplaceType: 'remote' }, { text: 'Turkey' }],
      workplaceType: 'remote',
    }
    expect(classifyEligibility(input).eligibility).toBe('remote_non_canada')
  })

  it('a named place beats "anywhere"', () => {
    expect(classifyEligibility(gh('Remote, anywhere in Europe')).eligibility).toBe(
      'remote_non_canada',
    )
    expect(classifyEligibility(gh('Remote, anywhere')).eligibility).toBe('remote_canada_ok')
  })
})

describe('classifyEligibility: two-letter region codes', () => {
  it.each([
    // Codes that are also country codes give way to a foreign place before them.
    ['Amsterdam, NL', 'non_canada_onsite', 'Amsterdam'],
    ['Berlin, DE', 'non_canada_onsite', 'Berlin'],
    ['Bangalore, IN', 'non_canada_onsite', 'Bangalore'],
    ['Tel Aviv, IL', 'non_canada_onsite', 'Tel Aviv'],
    // ...but still mean the province or state after a city that isn't foreign.
    ["St. John's, NL", 'canada_onsite', 'CA'],
    ['Indianapolis, IN', 'non_canada_onsite', 'US'],
    ['San Francisco, CA', 'non_canada_onsite', 'US'],
    // A province or state code beats a city name in the other country.
    ['Vancouver, WA', 'non_canada_onsite', 'US'],
    ['London, ON', 'canada_onsite', 'CA'],
    ['Toronto, ON', 'canada_onsite', 'CA'],
    // With nothing but a work mode, an ambiguous code is left for the LLM pass.
    ['Remote, DE', 'unknown', null],
    ['Remote, CA', 'unknown', null],
    // Codes that are only a province or state still decide on their own.
    ['Remote, TX', 'remote_us_only', 'US'],
    ['Remote (BC)', 'remote_canada_ok', 'CA'],
  ] as const)('%s → %s', (text, eligibility, country) => {
    const r = classifyEligibility(gh(text))
    expect(r.eligibility).toBe(eligibility)
    expect(r.country).toBe(country)
  })
})

describe('mentionsCanada', () => {
  it.each([
    ['Toronto', true],
    ['Remote (Canada)', true],
    ['Vancouver, BC', true],
    ['KOHO (CAN)', true],
    ['Remote (US)', false],
    ['London, UK', false],
    ['San Francisco, CA', false],
    ['Berlin, DE', false],
  ])('%j → %s', (text, expected) => {
    expect(mentionsCanada(text)).toBe(expected)
  })
})
