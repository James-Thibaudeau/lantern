import { describe, expect, it } from 'vitest'

import { mentionsCanada } from '../../pipeline/eligibility'

describe('mentionsCanada', () => {
  it.each(['Toronto', 'Remote (Canada)', 'Vancouver, BC', 'KOHO (CAN)'])(
    '%j mentions Canada',
    (text) => {
      expect(mentionsCanada(text)).toBe(true)
    },
  )

  it.each(['Remote (US)', 'London, UK', 'San Francisco, CA', 'Berlin, DE'])(
    '%j does not mention Canada',
    (text) => {
      expect(mentionsCanada(text)).toBe(false)
    },
  )
})
