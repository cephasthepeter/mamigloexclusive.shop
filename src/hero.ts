import { getAdminEligibility, requireSupabase, supabase } from './supabase'
import { deleteCloudinaryAsset, uploadCloudinaryMedia } from './media'
import { cloudinaryImageUrl, cloudinaryVideoUrl } from './cloudinary'

export const heroVideoMaxBytes = 100 * 1024 * 1024
export const heroPosterMaxBytes = 5 * 1024 * 1024
export const heroSignedUrlSeconds = 6 * 60 * 60

export interface HeroCampaign {
  id: string
  name: string
  title: string
  description: string
  videoPath: string
  videoPublicId: string
  videoUrl: string
  posterPath: string
  posterPublicId: string
  posterUrl: string
  posterAltText: string
  mobileVideoPath: string
  mobileVideoPublicId: string
  mobileVideoUrl: string
  primaryCtaText: string
  primaryCtaUrl: string
  secondaryCtaText: string
  secondaryCtaUrl: string
  displayOrder: number
  durationSeconds: number | null
  isActive: boolean
  isPublished: boolean
  startsAt: string
  endsAt: string
  createdAt: string
  updatedAt: string
}

export interface HeroSettings {
  slideshowEnabled: boolean
  defaultDurationSeconds: number
  crossfadeMs: number
  fallbackPosterPath: string
  fallbackPosterPublicId: string
  fallbackPosterUrl: string
  fallbackPosterAltText: string
}

export type HeroCampaignInput = Omit<HeroCampaign, 'createdAt' | 'updatedAt'>

export const defaultHeroSettings: HeroSettings = {
  slideshowEnabled: true,
  defaultDurationSeconds: 12,
  crossfadeMs: 1000,
  fallbackPosterPath: '',
  fallbackPosterPublicId: '',
  fallbackPosterUrl: '',
  fallbackPosterAltText: '',
}

type CampaignRow = Record<string, unknown> & {
  id: string
  name: string
  title: string
  description: string
  video_path: string | null
  video_public_id?: string | null
  video_url?: string | null
  poster_path: string | null
  poster_public_id?: string | null
  poster_url?: string | null
  poster_alt_text?: string | null
  mobile_video_path: string | null
  mobile_video_public_id?: string | null
  mobile_video_url?: string | null
  primary_cta_text: string | null
  primary_cta_url: string | null
  secondary_cta_text: string | null
  secondary_cta_url: string | null
  display_order: number
  duration_seconds: number | null
  is_active?: boolean
  is_published?: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
  updated_at: string
}

type SettingsRow = Record<string, unknown> & {
  slideshow_enabled: boolean
  default_duration_seconds: number
  crossfade_ms: number
  fallback_poster_path: string | null
  fallback_poster_public_id?: string | null
  fallback_poster_url?: string | null
  fallback_poster_alt_text?: string | null
}

function throwIfError(error: { message: string; code?: string } | null) {
  if (!error) return
  throw new Error(error.code === '42501' ? 'Administrator access is required to manage homepage hero campaigns.' : error.message)
}

async function requireHeroAdmin() {
  requireSupabase()
  const { data, error } = await supabase.auth.getUser()
  throwIfError(error)
  if (!data.user?.email || !await getAdminEligibility(data.user.email)) {
    throw new Error('Administrator access is required to manage homepage hero campaigns.')
  }
}

function mapSettings(row?: SettingsRow | null): HeroSettings {
  if (!row) return { ...defaultHeroSettings }
  return {
    slideshowEnabled: row.slideshow_enabled,
    defaultDurationSeconds: Number(row.default_duration_seconds),
    crossfadeMs: Number(row.crossfade_ms),
    fallbackPosterPath: row.fallback_poster_path || '',
    fallbackPosterPublicId: row.fallback_poster_public_id || '',
    fallbackPosterUrl: row.fallback_poster_url || '',
    fallbackPosterAltText: row.fallback_poster_alt_text || '',
  }
}

async function signedUrl(path: string | null | undefined) {
  if (!path) return ''
  const { data, error } = await supabase.storage.from('hero-media').createSignedUrl(path, heroSignedUrlSeconds)
  if (error) return ''
  return data.signedUrl
}

async function mapCampaign(row: CampaignRow, optimize = false): Promise<HeroCampaign> {
  const [rawVideoUrl, rawPosterUrl, rawMobileVideoUrl] = await Promise.all([
    row.video_url || signedUrl(row.video_path),
    row.poster_url || signedUrl(row.poster_path),
    row.mobile_video_url || signedUrl(row.mobile_video_path),
  ])
  const videoUrl = optimize ? cloudinaryVideoUrl(rawVideoUrl) : rawVideoUrl
  const posterUrl = optimize ? cloudinaryImageUrl(rawPosterUrl, 1600) : rawPosterUrl
  const mobileVideoUrl = optimize ? cloudinaryVideoUrl(rawMobileVideoUrl, 900) : rawMobileVideoUrl
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description,
    videoPath: row.video_path || '',
    videoPublicId: row.video_public_id || '',
    videoUrl,
    posterPath: row.poster_path || '',
    posterPublicId: row.poster_public_id || '',
    posterUrl,
    posterAltText: row.poster_alt_text || '',
    mobileVideoPath: row.mobile_video_path || '',
    mobileVideoPublicId: row.mobile_video_public_id || '',
    mobileVideoUrl,
    primaryCtaText: row.primary_cta_text || '',
    primaryCtaUrl: row.primary_cta_url || '',
    secondaryCtaText: row.secondary_cta_text || '',
    secondaryCtaUrl: row.secondary_cta_url || '',
    displayOrder: Number(row.display_order),
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    isActive: row.is_active ?? true,
    isPublished: row.is_published ?? true,
    startsAt: row.starts_at || '',
    endsAt: row.ends_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const campaignColumns = 'id, name, title, description, video_path, video_public_id, video_url, poster_path, poster_public_id, poster_url, poster_alt_text, mobile_video_path, mobile_video_public_id, mobile_video_url, primary_cta_text, primary_cta_url, secondary_cta_text, secondary_cta_url, display_order, duration_seconds, starts_at, ends_at, created_at, updated_at'
const draftColumns = `${campaignColumns}, is_active, is_published`
const settingsColumns = 'slideshow_enabled, default_duration_seconds, crossfade_ms, fallback_poster_path, fallback_poster_public_id, fallback_poster_url, fallback_poster_alt_text'

export async function getPublicHeroContent() {
  requireSupabase()
  const [{ data: campaignRows, error: campaignsError }, { data: settingsRow, error: settingsError }] = await Promise.all([
    supabase.from('hero_campaigns').select(campaignColumns).order('display_order'),
    supabase.from('hero_settings').select(settingsColumns).eq('singleton', true).maybeSingle(),
  ])
  throwIfError(campaignsError)
  throwIfError(settingsError)
  const campaigns = await Promise.all(((campaignRows || []) as CampaignRow[]).map((row) => mapCampaign(row, true)))
  const settings = mapSettings(settingsRow as SettingsRow | null)
  settings.fallbackPosterUrl ||= await signedUrl(settings.fallbackPosterPath)
  if (settings.fallbackPosterPublicId && settings.fallbackPosterUrl) {
    settings.fallbackPosterUrl = cloudinaryImageUrl(settings.fallbackPosterUrl, 1600)
  }
  return { campaigns: campaigns.filter((campaign) => campaign.videoUrl), settings }
}

export async function getAdminHeroContent() {
  await requireHeroAdmin()
  const [{ data: campaignRows, error: campaignsError }, { data: settingsRow, error: settingsError }] = await Promise.all([
    supabase.from('hero_campaign_drafts').select(draftColumns).order('display_order').order('created_at'),
    supabase.from('hero_settings_drafts').select(settingsColumns).eq('singleton', true).maybeSingle(),
  ])
  throwIfError(campaignsError)
  throwIfError(settingsError)
  const campaigns = await Promise.all(((campaignRows || []) as CampaignRow[]).map((row) => mapCampaign(row)))
  const settings = mapSettings(settingsRow as SettingsRow | null)
  settings.fallbackPosterUrl ||= await signedUrl(settings.fallbackPosterPath)
  return { campaigns, settings }
}

export async function saveHeroCampaign(input: HeroCampaignInput) {
  await requireHeroAdmin()
  const row = {
    id: input.id,
    name: input.name.trim(),
    title: input.title.trim(),
    description: input.description.trim(),
    video_path: input.videoPath || null,
    video_public_id: input.videoPublicId || null,
    video_url: input.videoUrl || null,
    poster_path: input.posterPath || null,
    poster_public_id: input.posterPublicId || null,
    poster_url: input.posterUrl || null,
    poster_alt_text: input.posterAltText.slice(0, 250),
    mobile_video_path: input.mobileVideoPath || null,
    mobile_video_public_id: input.mobileVideoPublicId || null,
    mobile_video_url: input.mobileVideoUrl || null,
    primary_cta_text: input.primaryCtaText.trim() || null,
    primary_cta_url: input.primaryCtaText.trim() ? input.primaryCtaUrl : null,
    secondary_cta_text: input.secondaryCtaText.trim() || null,
    secondary_cta_url: input.secondaryCtaText.trim() ? input.secondaryCtaUrl : null,
    display_order: input.displayOrder,
    duration_seconds: input.durationSeconds,
    is_active: input.isActive,
    is_published: input.isPublished,
    starts_at: input.startsAt || null,
    ends_at: input.endsAt || null,
  }
  const { data, error } = await supabase.from('hero_campaign_drafts').upsert(row)
    .select(draftColumns).single()
  throwIfError(error)
  const publicIds = [input.videoPublicId, input.posterPublicId, input.mobileVideoPublicId].filter(Boolean)
  const { error: detachError } = await supabase.from('media_assets').update({ hero_campaign_id: null })
    .eq('hero_campaign_id', input.id)
  throwIfError(detachError)
  if (publicIds.length) {
    const { error: attachError } = await supabase.from('media_assets').update({ hero_campaign_id: input.id })
      .in('cloudinary_public_id', publicIds)
    throwIfError(attachError)
  }
  return mapCampaign(data as CampaignRow)
}

export async function saveHeroSettings(settings: HeroSettings) {
  await requireHeroAdmin()
  const { error } = await supabase.from('hero_settings_drafts').upsert({
    singleton: true,
    slideshow_enabled: settings.slideshowEnabled,
    default_duration_seconds: settings.defaultDurationSeconds,
    crossfade_ms: settings.crossfadeMs,
    fallback_poster_path: settings.fallbackPosterPath || null,
    fallback_poster_public_id: settings.fallbackPosterPublicId || null,
    fallback_poster_url: settings.fallbackPosterUrl || null,
    fallback_poster_alt_text: settings.fallbackPosterAltText.slice(0, 250),
  })
  throwIfError(error)
}

export async function publishHeroContent() {
  await requireHeroAdmin()
  const { data, error } = await supabase.rpc('admin_publish_hero_content')
  throwIfError(error)
  if (data !== true) throw new Error('The hero campaigns could not be published.')
}

export async function removeHeroCampaign(id: string) {
  await requireHeroAdmin()
  const { data, error: readError } = await supabase.from('hero_campaign_drafts')
    .select('video_path, poster_path, mobile_video_path, video_public_id, poster_public_id, mobile_video_public_id').eq('id', id).maybeSingle()
  throwIfError(readError)
  const { error } = await supabase.from('hero_campaign_drafts').delete().eq('id', id)
  throwIfError(error)
  if (data) await removeUnusedHeroAssets([data.video_path, data.poster_path, data.mobile_video_path,
    data.video_public_id, data.poster_public_id, data.mobile_video_public_id].filter((path): path is string => Boolean(path)))
}

export async function removeUnusedHeroAssets(candidatePaths: string[]) {
  await requireHeroAdmin()
  const paths = [...new Set(candidatePaths.filter(Boolean))]
  if (!paths.length) return
  const [{ data: liveRows, error: liveError }, { data: draftRows, error: draftError }, { data: liveSettings, error: liveSettingsError }, { data: draftSettings, error: draftSettingsError }] = await Promise.all([
    supabase.from('hero_campaigns').select('video_path, video_public_id, poster_path, poster_public_id, mobile_video_path, mobile_video_public_id'),
    supabase.from('hero_campaign_drafts').select('video_path, video_public_id, poster_path, poster_public_id, mobile_video_path, mobile_video_public_id'),
    supabase.from('hero_settings').select('fallback_poster_path, fallback_poster_public_id').eq('singleton', true).maybeSingle(),
    supabase.from('hero_settings_drafts').select('fallback_poster_path, fallback_poster_public_id').eq('singleton', true).maybeSingle(),
  ])
  throwIfError(liveError)
  throwIfError(draftError)
  throwIfError(liveSettingsError)
  throwIfError(draftSettingsError)
  const used = new Set<string>()
  for (const row of [...(liveRows || []), ...(draftRows || [])]) {
    for (const key of ['video_path', 'video_public_id', 'poster_path', 'poster_public_id', 'mobile_video_path', 'mobile_video_public_id'] as const) if (row[key]) used.add(row[key] as string)
  }
  if (liveSettings?.fallback_poster_path) used.add(liveSettings.fallback_poster_path)
  if (liveSettings?.fallback_poster_public_id) used.add(liveSettings.fallback_poster_public_id)
  if (draftSettings?.fallback_poster_path) used.add(draftSettings.fallback_poster_path)
  if (draftSettings?.fallback_poster_public_id) used.add(draftSettings.fallback_poster_public_id)
  const unused = paths.filter((path) => !used.has(path))
  if (!unused.length) return
  const publicIds = unused.filter((value) => value.startsWith('mamiglo/'))
  const storagePaths = unused.filter((value) => !value.startsWith('mamiglo/'))
  if (publicIds.length) {
    const { data, error } = await supabase.from('media_assets').select('id').in('cloudinary_public_id', publicIds)
    throwIfError(error)
    for (const asset of data || []) await deleteCloudinaryAsset(asset.id)
  }
  if (storagePaths.length) {
    const { error } = await supabase.storage.from('hero-media').remove(storagePaths)
    throwIfError(error)
  }
}

export async function uploadHeroAsset(file: File, kind: 'video' | 'poster', onProgress: (progress: number) => void, signal?: AbortSignal) {
  await requireHeroAdmin()
  const acceptedTypes = kind === 'video' ? ['video/mp4', 'video/webm'] : ['image/jpeg', 'image/png', 'image/webp']
  const maxBytes = kind === 'video' ? heroVideoMaxBytes : heroPosterMaxBytes
  if (!acceptedTypes.includes(file.type)) throw new Error(kind === 'video' ? 'Choose an MP4 or WebM video.' : 'Choose a JPG, PNG or WebP poster image.')
  if (file.size < 1 || file.size > maxBytes) throw new Error(kind === 'video' ? 'Videos must be 100 MB or smaller.' : 'Poster images must be 5 MB or smaller.')

  return uploadCloudinaryMedia(file, 'hero', onProgress, signal)
}
