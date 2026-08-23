import { describe, expect, it } from 'vitest'
import { STYLE_GROUPS, STYLE_PROPERTIES } from '../../src/allowlists'

describe('STYLE_GROUPS', () => {
  // The renderer walks STYLE_GROUPS, so a property that is captured but ungrouped is
  // captured into the JSON and then silently dropped from the prompt-ready Markdown.
  // That is exactly the defect this test exists to prevent recurring.
  it('covers every captured property exactly once', () => {
    const grouped = Object.values(STYLE_GROUPS).flat()
    const missing = STYLE_PROPERTIES.filter(p => !grouped.includes(p))
    expect(missing, 'captured but ungrouped — would vanish from the Markdown brief').toEqual([])

    const dupes = grouped.filter((p, i) => grouped.indexOf(p) !== i)
    expect(dupes, 'listed in more than one group').toEqual([])
  })

  it('groups nothing that is not captured', () => {
    const stray = Object.values(STYLE_GROUPS).flat().filter(p => !STYLE_PROPERTIES.includes(p as never))
    expect(stray).toEqual([])
  })
})
