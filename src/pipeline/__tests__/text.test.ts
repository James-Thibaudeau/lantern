import { describe, expect, it } from 'vitest'

import { htmlToText, normalizeKey, sha256, toIso } from '../text'

describe('htmlToText', () => {
  it('puts paragraphs and list items on their own lines', () => {
    expect(htmlToText('<p>Intro</p><ul><li>A</li><li>B</li></ul><p>End</p>')).toBe(
      'Intro\n\n• A\n• B\n\nEnd',
    )
  })

  it('turns <br> into newlines', () => {
    expect(htmlToText('one<br>two<br/>three<BR />four')).toBe('one\ntwo\nthree\nfour')
  })

  it('decodes entities, including &nbsp; as a plain space', () => {
    expect(htmlToText('<p>Salt &amp; Pepper&nbsp;Inc. &lt;3 &quot;hi&quot; &#39;yo&#39;</p>')).toBe(
      `Salt & Pepper Inc. <3 "hi" 'yo'`,
    )
  })

  it('drops script and style contents', () => {
    expect(htmlToText('<style>.a{color:red}</style><p>Hi</p><script>alert(1)</script>')).toBe('Hi')
  })

  it('collapses runs of spaces and blank lines', () => {
    expect(htmlToText('<div>a    b</div>\n\n\n\n<div>  c  </div>')).toBe('a b\n\nc')
  })

  it('returns an empty string for empty input', () => {
    expect(htmlToText('')).toBe('')
  })
})

describe('normalizeKey', () => {
  it('lowercases, strips accents and punctuation, collapses spaces', () => {
    expect(normalizeKey('  Montréal, QC — Senior   Engineer (Back-End)! ')).toBe(
      'montreal qc senior engineer back end',
    )
  })
})

describe('toIso', () => {
  it('returns null for empty or invalid values', () => {
    expect(toIso(null)).toBeNull()
    expect(toIso(undefined)).toBeNull()
    expect(toIso('')).toBeNull()
    expect(toIso('not a date')).toBeNull()
  })

  it('converts an offset timestamp to UTC ISO', () => {
    expect(toIso('2026-11-02T17:16:26-05:00')).toBe('2026-11-02T22:16:26.000Z')
  })

  it('converts epoch milliseconds (Lever createdAt)', () => {
    expect(toIso(0)).toBe('1970-01-01T00:00:00.000Z')
    expect(toIso(1793733833243)).toBe(new Date(1793733833243).toISOString())
  })
})

describe('sha256', () => {
  it('returns the hex digest, truncated on request', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256('abc', 24)).toBe('ba7816bf8f01cfea414140de')
  })
})
