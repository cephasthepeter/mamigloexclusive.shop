import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const uploadRules = {
  image: { maxBytes: 10 * 1024 * 1024, formats: ['jpg', 'jpeg', 'png', 'webp'] },
  video: { maxBytes: 100 * 1024 * 1024, formats: ['mp4', 'webm'] },
} as const
const folders = {
  product: 'mamiglo/products',
  hero: 'mamiglo/hero',
  journal: 'mamiglo/journal',
  profile: 'mamiglo/profiles',
} as const

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function signature(parameters: Record<string, string>, secret: string) {
  const canonical = Object.entries(parameters)
    .filter(([, value]) => value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${canonical}${secret}`))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function deleteCloudinaryAsset(
  cloudName: string,
  apiKey: string,
  apiSecret: string,
  publicId: string,
  resourceType: string,
) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const parameters = { invalidate: 'true', public_id: publicId, timestamp }
  const signed = await signature(parameters, apiSecret)
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/destroy`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ ...parameters, api_key: apiKey, signature: signed }),
  })
  if (!response.ok) return false
  const result = await response.json() as { result?: string }
  return result.result === 'ok' || result.result === 'not found'
}

async function verifyAdministrator(request: Request) {
  const accessToken = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) return { error: json(401, { error: 'Administrator sign-in is required.' }) }

  const projectUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!projectUrl || !serviceKey) return { error: json(503, { error: 'Media management is not configured.' }) }

  const admin = createClient(projectUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await admin.auth.getUser(accessToken)
  const email = data.user?.email?.trim().toLowerCase()
  if (error || !email || !data.user?.email_confirmed_at) {
    return { error: json(401, { error: 'The administrator session is invalid or unconfirmed.' }) }
  }

  const { data: allowlistEntry, error: allowlistError } = await admin
    .from('admin_allowlist').select('email').eq('email', email).maybeSingle()
  if (allowlistError) return { error: json(500, { error: 'Administrator permissions could not be verified.' }) }
  if (!allowlistEntry) return { error: json(403, { error: 'This account is not authorised to manage media.' }) }
  return { admin, email }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' })

  const verified = await verifyAdministrator(request)
  if ('error' in verified) return verified.error

  const cloudName = Deno.env.get('CLOUDINARY_CLOUD_NAME')
  const apiKey = Deno.env.get('CLOUDINARY_API_KEY')
  const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET')
  const imageUploadPreset = Deno.env.get('CLOUDINARY_IMAGE_UPLOAD_PRESET')
  const videoUploadPreset = Deno.env.get('CLOUDINARY_VIDEO_UPLOAD_PRESET')
  if (!cloudName || !apiKey || !apiSecret || !imageUploadPreset || !videoUploadPreset) {
    return json(503, { error: 'Cloudinary media uploads are not configured.' })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return json(400, { error: 'The media request is invalid.' })
  }

  if (body.action === 'delete-asset') {
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) {
      return json(400, { error: 'The media reference is invalid.' })
    }
    const { data: asset, error: assetError } = await verified.admin.from('media_assets')
      .select('id, cloudinary_public_id, secure_url, folder, resource_type, product_id, hero_campaign_id, journal_article_id')
      .eq('id', body.id).maybeSingle()
    if (assetError) return json(500, { error: 'The media reference could not be verified.' })
    if (!asset) return json(404, { error: 'The media reference no longer exists.' })
    if (asset.product_id || asset.hero_campaign_id || asset.journal_article_id) {
      return json(409, { error: 'This media is still attached to published or draft content.' })
    }
    if (!Object.values(folders).includes(asset.folder as typeof folders[keyof typeof folders]) ||
      !asset.cloudinary_public_id || asset.cloudinary_public_id.length > 255 ||
      !['image', 'video'].includes(asset.resource_type) ||
      !asset.secure_url.startsWith(`https://res.cloudinary.com/${cloudName}/`)) {
      return json(403, { error: 'This media reference is outside the managed Cloudinary folders.' })
    }

    const [{ data: products, error: productError }, { data: campaigns, error: campaignError }, { data: drafts, error: draftError }, { data: settings, error: settingsError }, { data: draftSettings, error: draftSettingsError }, { data: articles, error: articleError }] = await Promise.all([
      verified.admin.from('products').select('image_url, image_urls'),
      verified.admin.from('hero_campaigns').select('video_public_id, poster_public_id, mobile_video_public_id, video_url, poster_url, mobile_video_url'),
      verified.admin.from('hero_campaign_drafts').select('video_public_id, poster_public_id, mobile_video_public_id, video_url, poster_url, mobile_video_url'),
      verified.admin.from('hero_settings').select('fallback_poster_public_id, fallback_poster_url'),
      verified.admin.from('hero_settings_drafts').select('fallback_poster_public_id, fallback_poster_url'),
      verified.admin.from('journal_articles').select('cover_image_url, content'),
    ])
    if (productError || campaignError || draftError || settingsError || draftSettingsError || articleError) {
      return json(500, { error: 'Media usage could not be verified. The Cloudinary file was not deleted.' })
    }
    const referencedByProduct = (products || []).some((product) =>
      product.image_url === asset.secure_url || (product.image_urls || []).includes(asset.secure_url))
    const referencedByHero = (campaigns || []).some((campaign) =>
      [campaign.video_public_id, campaign.poster_public_id, campaign.mobile_video_public_id].includes(asset.cloudinary_public_id) ||
      [campaign.video_url, campaign.poster_url, campaign.mobile_video_url].includes(asset.secure_url))
      || (drafts || []).some((campaign) =>
        [campaign.video_public_id, campaign.poster_public_id, campaign.mobile_video_public_id].includes(asset.cloudinary_public_id) ||
        [campaign.video_url, campaign.poster_url, campaign.mobile_video_url].includes(asset.secure_url))
      || (settings || []).some((row) => row.fallback_poster_public_id === asset.cloudinary_public_id || row.fallback_poster_url === asset.secure_url)
      || (draftSettings || []).some((row) => row.fallback_poster_public_id === asset.cloudinary_public_id || row.fallback_poster_url === asset.secure_url)
    const referencedByJournal = (articles || []).some((article) =>
      article.cover_image_url === asset.secure_url || article.content.includes(asset.secure_url))
    if (referencedByProduct || referencedByHero || referencedByJournal) {
      return json(409, { error: 'This media is still used by store content and cannot be deleted.' })
    }

    const deleted = await deleteCloudinaryAsset(cloudName, apiKey, apiSecret, asset.cloudinary_public_id, asset.resource_type)
    if (!deleted) return json(502, { error: 'Cloudinary could not delete this asset. Its reference was kept so you can retry.' })
    const { error: removeError } = await verified.admin.from('media_assets').delete().eq('id', asset.id)
    if (removeError) return json(500, { error: 'The Cloudinary asset was deleted, but its reference could not be removed.' })
    return json(200, { deleted: true })
  }

  if (body.action === 'cleanup-orphan') {
    const publicId = typeof body.publicId === 'string' ? body.publicId : ''
    const secureUrl = typeof body.secureUrl === 'string' ? body.secureUrl : ''
    const folder = typeof body.folder === 'string' ? body.folder : ''
    const resourceType = body.resourceType === 'video' || body.resourceType === 'image' ? body.resourceType : ''
    const allowedFolders = Object.values(folders) as string[]
    const publicIdMatchesUpload = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId) ||
      allowedFolders.some((managedFolder) => publicId.startsWith(`${managedFolder}/`) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId.slice(managedFolder.length + 1)))
    if (!resourceType || !allowedFolders.includes(folder) || !publicIdMatchesUpload ||
      publicId.length > 255 || !secureUrl.startsWith(`https://res.cloudinary.com/${cloudName}/`)) {
      return json(400, { error: 'The uploaded media reference is invalid.' })
    }

    const { data: savedAsset, error: savedAssetError } = await verified.admin.from('media_assets')
      .select('id').eq('cloudinary_public_id', publicId).maybeSingle()
    if (savedAssetError) return json(500, { error: 'The media reference could not be checked.' })
    if (savedAsset) return json(409, { error: 'The uploaded media is already recorded and was kept.' })

    const [{ data: products, error: productError }, { data: campaigns, error: campaignError }, { data: drafts, error: draftError }, { data: settings, error: settingsError }, { data: draftSettings, error: draftSettingsError }, { data: articles, error: articleError }] = await Promise.all([
      verified.admin.from('products').select('image_url, image_urls'),
      verified.admin.from('hero_campaigns').select('video_public_id, poster_public_id, mobile_video_public_id, video_url, poster_url, mobile_video_url'),
      verified.admin.from('hero_campaign_drafts').select('video_public_id, poster_public_id, mobile_video_public_id, video_url, poster_url, mobile_video_url'),
      verified.admin.from('hero_settings').select('fallback_poster_public_id, fallback_poster_url'),
      verified.admin.from('hero_settings_drafts').select('fallback_poster_public_id, fallback_poster_url'),
      verified.admin.from('journal_articles').select('cover_image_url, content'),
    ])
    if (productError || campaignError || draftError || settingsError || draftSettingsError || articleError) {
      return json(500, { error: 'Media usage could not be verified. The Cloudinary file was kept.' })
    }
    const containsReference = (value: unknown) => typeof value === 'string' &&
      (value.includes(publicId) || value.includes(secureUrl))
    const referenced = (products || []).some((product) => containsReference(product.image_url) ||
      (Array.isArray(product.image_urls) && product.image_urls.some(containsReference)))
      || [...(campaigns || []), ...(drafts || [])].some((campaign) =>
        [campaign.video_public_id, campaign.poster_public_id, campaign.mobile_video_public_id,
          campaign.video_url, campaign.poster_url, campaign.mobile_video_url].some(containsReference))
      || [...(settings || []), ...(draftSettings || [])].some((row) =>
        [row.fallback_poster_public_id, row.fallback_poster_url].some(containsReference))
      || (articles || []).some((article) => containsReference(article.cover_image_url) ||
        containsReference(JSON.stringify(article.content)))
    if (referenced) return json(409, { error: 'The Cloudinary file is referenced by store content and was kept.' })

    const deleted = await deleteCloudinaryAsset(cloudName, apiKey, apiSecret, publicId, resourceType)
    if (!deleted) return json(502, { error: 'Cloudinary could not remove the unreferenced upload. It was kept for manual review.' })
    return json(200, { deleted: true })
  }

  if (body.action !== 'sign-upload') {
    return json(400, { error: 'Unsupported media operation.' })
  }
  if (body.mediaType !== 'image' && body.mediaType !== 'video') {
    return json(400, { error: 'Choose an image or video file.' })
  }
  if (typeof body.scope !== 'string' || !(body.scope in folders)) {
    return json(400, { error: 'The media destination is invalid.' })
  }

  const mediaType = body.mediaType
  const scope = body.scope as keyof typeof folders
  if ((scope === 'product' || scope === 'journal' || scope === 'profile') && mediaType !== 'image') {
    return json(415, { error: 'This destination accepts image uploads only.' })
  }
  const rules = uploadRules[mediaType]
  const fileSize = Number(body.fileSize)
  const mimeType = String(body.mimeType || '').toLowerCase()
  const allowedMimeTypes = mediaType === 'image'
    ? ['image/jpeg', 'image/png', 'image/webp']
    : ['video/mp4', 'video/webm']
  if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > rules.maxBytes) {
    return json(413, { error: `This ${mediaType} exceeds the ${Math.floor(rules.maxBytes / (1024 * 1024))} MB upload limit.` })
  }
  if (!allowedMimeTypes.includes(mimeType)) return json(415, { error: 'This file format is not supported.' })

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const folder = folders[scope]
  const publicId = crypto.randomUUID()
  const uploadPreset = mediaType === 'image' ? imageUploadPreset : videoUploadPreset
  const parameters = {
    folder,
    overwrite: 'false',
    public_id: publicId,
    timestamp,
    unique_filename: 'false',
    upload_preset: uploadPreset,
  }
  const signed = await signature(parameters, apiSecret)
  return json(200, {
    apiKey,
    cloudName,
    folder,
    mediaType,
    publicId,
    signature: signed,
    timestamp,
    uploadPreset,
    allowedFormats: rules.formats,
    maxBytes: rules.maxBytes,
  })
})