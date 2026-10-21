import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const rateBuckets = new Map<string, { count: number; resetAt: number }>()

export function json(status: number, body: unknown, request?: HttpRequest): HttpResponseInit {
  const allowedOrigins = (process.env.ALLOWED_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  const requestOrigin = request?.headers.get('origin')
  const origin = requestOrigin
    ? allowedOrigins.includes(requestOrigin) ? requestOrigin : undefined
    : allowedOrigins[0]
  return {
    status,
    jsonBody: body,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '600',
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Vary': 'Origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-store',
    },
  }
}

export function preflight(request: HttpRequest): HttpResponseInit | undefined {
  return request.method === 'OPTIONS' ? json(204, {}, request) : undefined
}

export async function readJson<T = unknown>(request: HttpRequest): Promise<T> {
  try {
    return await request.json() as T
  } catch {
    throw new RequestError(400, 'Request body must be valid JSON.')
  }
}

export class RequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

export function errorResponse(error: unknown, request: HttpRequest, context: InvocationContext): HttpResponseInit {
  if (error instanceof RequestError) return json(error.status, { error: error.message }, request)
  context.error('Request failed', error)
  return json(500, { error: 'Something went wrong. Please try again.' }, request)
}

export function enforceRateLimit(request: HttpRequest, context: InvocationContext, limit: number, windowMs: number) {
  if (rateBuckets.size > 10_000) {
    const now = Date.now()
    for (const [entry, bucket] of rateBuckets) {
      if (bucket.resetAt <= now) rateBuckets.delete(entry)
    }
    if (rateBuckets.size > 10_000) rateBuckets.delete(rateBuckets.keys().next().value!)
  }
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const key = `${context.functionName}:${forwarded || 'unknown'}`
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs })
    return
  }
  if (bucket.count >= limit) throw new RequestError(429, 'Too many requests. Please wait and try again.')
  bucket.count += 1
}

export function readIntegerSetting(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`)
  return parsed
}
