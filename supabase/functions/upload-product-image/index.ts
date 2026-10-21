import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const maxBytes = 5 * 1024 * 1024

function json(status: number, body: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function detectImage(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' }
  }
  if (bytes.length >= 8 && bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10') {
    return { contentType: 'image/png', extension: 'png' }
  }
  if (bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    return { contentType: 'image/webp', extension: 'webp' }
  }
  return null
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' })

  const authorization = request.headers.get('Authorization') || ''
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) return json(401, { error: 'Administrator sign-in is required.' })

  const projectUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!projectUrl || !serviceKey) return json(503, { error: 'Image storage is not configured.' })

  const admin = createClient(projectUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: authData, error: authError } = await admin.auth.getUser(accessToken)
  const user = authData.user
  if (authError || !user?.email || !user.email_confirmed_at) {
    return json(401, { error: 'The administrator session is invalid or unconfirmed.' })
  }

  const { data: allowlistEntry, error: allowlistError } = await admin
    .from('admin_allowlist').select('email').eq('email', user.email.toLowerCase()).maybeSingle()
  if (allowlistError) return json(500, { error: 'Administrator permissions could not be verified.' })
  if (!allowlistEntry) return json(403, { error: 'This account is not authorised to manage the store.' })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json(400, { error: 'Choose a product photo to upload.' })
  }
  const image = form.get('image')
  if (!(image instanceof File)) return json(400, { error: 'Choose a product photo to upload.' })
  if (image.size < 1 || image.size > maxBytes) return json(400, { error: 'Images must be 5 MB or smaller.' })

  const bytes = new Uint8Array(await image.arrayBuffer())
  const detected = detectImage(bytes)
  if (!detected) return json(415, { error: 'Use a valid JPG, PNG or WebP image.' })

  const path = `${crypto.randomUUID()}.${detected.extension}`
  const { error: uploadError } = await admin.storage.from('product-images').upload(path, bytes, {
    contentType: detected.contentType,
    cacheControl: '3600',
    upsert: false,
  })
  if (uploadError) return json(500, { error: 'The product photo could not be saved.' })

  const { data } = admin.storage.from('product-images').getPublicUrl(path)
  return json(201, { url: data.publicUrl })
})
