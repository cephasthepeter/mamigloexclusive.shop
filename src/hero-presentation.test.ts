import { describe, expect, it } from 'vitest'
import { getHeroOverlayContent, nextPlayableHeroIndex } from './hero-presentation'

describe('hero presentation', () => {
  it('leaves the video clean when campaign overlay fields are empty', () => {
    expect(getHeroOverlayContent({})).toEqual({
      title: '',
      description: '',
      primaryCta: null,
      secondaryCta: null,
    })
  })

  it('uses only supplied campaign copy and complete CTA pairs', () => {
    expect(getHeroOverlayContent({
      title: '  Evening edit  ',
      description: '  Refined finishing details. ',
      primaryCtaText: ' Discover the edit ',
      primaryCtaUrl: '/shop',
      secondaryCtaText: 'Incomplete CTA',
    })).toEqual({
      title: 'Evening edit',
      description: 'Refined finishing details.',
      primaryCta: { text: 'Discover the edit', url: '/shop' },
      secondaryCta: null,
    })
  })

  it('selects the next ordered campaign that has not failed', () => {
    const campaigns = [{ id: 'one' }, { id: 'two' }, { id: 'three' }]
    expect(nextPlayableHeroIndex(0, campaigns, new Set(['two']))).toBe(2)
    expect(nextPlayableHeroIndex(2, campaigns, new Set(['one', 'two']))).toBe(-1)
    expect(nextPlayableHeroIndex(0, campaigns.slice(0, 1), new Set())).toBe(-1)
  })
})