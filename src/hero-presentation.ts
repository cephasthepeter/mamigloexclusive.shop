export interface HeroOverlayCampaign {
  title?: string | null
  description?: string | null
  primaryCtaText?: string | null
  primaryCtaUrl?: string | null
  secondaryCtaText?: string | null
  secondaryCtaUrl?: string | null
}

export interface HeroOverlayContent {
  title: string
  description: string
  primaryCta: { text: string; url: string } | null
  secondaryCta: { text: string; url: string } | null
}

export function getHeroOverlayContent(campaign?: HeroOverlayCampaign | null): HeroOverlayContent {
  const primaryText = campaign?.primaryCtaText?.trim() || ''
  const primaryUrl = campaign?.primaryCtaUrl?.trim() || ''
  const secondaryText = campaign?.secondaryCtaText?.trim() || ''
  const secondaryUrl = campaign?.secondaryCtaUrl?.trim() || ''

  return {
    title: campaign?.title?.trim() || '',
    description: campaign?.description?.trim() || '',
    primaryCta: primaryText && primaryUrl ? { text: primaryText, url: primaryUrl } : null,
    secondaryCta: secondaryText && secondaryUrl ? { text: secondaryText, url: secondaryUrl } : null,
  }
}

export function nextPlayableHeroIndex(
  current: number,
  campaigns: readonly { id: string }[],
  failed: ReadonlySet<string>,
) {
  if (campaigns.length < 2) return -1
  for (let step = 1; step < campaigns.length; step += 1) {
    const index = (current + step) % campaigns.length
    if (!failed.has(campaigns[index].id)) return index
  }
  return -1
}