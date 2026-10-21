import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function fingerprint(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' })

  const projectUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const rateLimitSecret = Deno.env.get('CHECKOUT_RATE_LIMIT_SECRET')
  if (!projectUrl || !serviceKey || !rateLimitSecret) {
    return json(503, { error: 'Checkout is not configured yet. Please contact us on WhatsApp.' })
  }

  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (!forwardedFor) return json(503, { error: 'Checkout could not be verified. Please try again.' })

  let body: { customer?: unknown; items?: unknown; idempotencyKey?: unknown }
  try {
    const raw = await request.text()
    if (raw.length > 32_000) return json(413, { error: 'The order request is too large.' })
    body = JSON.parse(raw) as typeof body
  } catch {
    return json(400, { error: 'Please check the order details and try again.' })
  }
  if (typeof body.idempotencyKey !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.idempotencyKey)) {
    return json(400, { error: 'Please submit the order again.' })
  }

  const admin = createClient(projectUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  let customerUserId: string | null = null
  const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (accessToken?.split('.').length === 3) {
    const { data: customerAuth, error: customerAuthError } = await admin.auth.getUser(accessToken)
    if (customerAuthError || !customerAuth.user) {
      return json(401, { error: 'Your customer session has expired. Sign in again or continue as a guest.' })
    }
    customerUserId = customerAuth.user.id
  }
  const ipFingerprint = await fingerprint(forwardedFor, rateLimitSecret)
  const { data: allowed, error: limitError } = await admin.rpc('consume_checkout_rate_limit', {
    p_fingerprint: ipFingerprint,
  })
  if (limitError) return json(503, { error: 'Checkout is temporarily unavailable. Please try again.' })
  if (!allowed) return json(429, { error: 'Too many order attempts. Please wait a minute and try again.' })

  const { data, error } = await admin.rpc('create_order_with_customer', {
    p_customer: body.customer,
    p_items: body.items,
    p_idempotency_key: body.idempotencyKey,
    p_customer_user_id: customerUserId,
  })
  if (error) {
    const status = error.code === 'P0001' ? 409 : error.code === '22023' ? 400 : 500
    const message = error.code === 'P0001'
      ? 'One or more selected items are unavailable or out of stock. Review your bag and try again.'
      : error.code === '22023'
        ? 'Please check the order details and try again.'
        : 'The order could not be submitted. Please try again.'
    return json(status, { error: message })
  }
  return json(201, { order: data })
})
