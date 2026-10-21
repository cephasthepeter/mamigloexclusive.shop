import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { app, type HttpRequest, type InvocationContext } from '@azure/functions'
import { BlobServiceClient } from '@azure/storage-blob'
import { DefaultAzureCredential } from '@azure/identity'
import { requireAdmin } from '../auth.js'
import { errorResponse, json, preflight, RequestError } from '../http.js'

const localImages = resolve(process.cwd(), '.local', 'images')
const maxImageSize = 5 * 1024 * 1024
const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

function detectImageType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10') return 'image/png'
  if (bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return undefined
}

function publicImageUrl(name: string) {
  const base = (process.env.PUBLIC_API_BASE_URL || '').replace(/\/$/, '')
  return `${base || '/api'}/images/${encodeURIComponent(name)}`
}

async function upload(request: HttpRequest, context: InvocationContext) {
  const options = preflight(request)
  if (options) return options
  try {
    await requireAdmin(request)
    const form = await request.formData()
    const image = form.get('image')
    if (!(image instanceof Blob)) throw new RequestError(400, 'Choose a product photo to upload.')
    if (image.size < 1 || image.size > maxImageSize) throw new RequestError(400, 'Images must be smaller than 5 MB.')
    const bytes = new Uint8Array(await image.arrayBuffer())
    const contentType = detectImageType(bytes)
    const extension = contentType ? allowedTypes.get(contentType) : undefined
    if (!contentType || !extension) throw new RequestError(415, 'Use a valid JPG, PNG or WebP image.')
    const name = `${randomUUID()}.${extension}`
    const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL
    if (accountUrl) {
      const containerName = process.env.AZURE_STORAGE_CONTAINER || 'product-images'
      const container = new BlobServiceClient(accountUrl, new DefaultAzureCredential()).getContainerClient(containerName)
      await container.getBlockBlobClient(name).uploadData(bytes, {
        blobHTTPHeaders: { blobContentType: contentType, blobCacheControl: 'public, max-age=86400' },
      })
    } else {
      await mkdir(localImages, { recursive: true })
      await writeFile(resolve(localImages, name), bytes, { flag: 'wx', mode: 0o600 })
    }
    return json(201, { url: publicImageUrl(name) }, request)
  } catch (error) {
    return errorResponse(error, request, context)
  }
}

async function serve(request: HttpRequest, context: InvocationContext) {
  const options = preflight(request)
  if (options) return options
  try {
    const name = request.params.name || ''
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(name)) throw new RequestError(404, 'Image not found.')
    const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL
    let image: Buffer
    if (accountUrl) {
      const containerName = process.env.AZURE_STORAGE_CONTAINER || 'product-images'
      const blob = new BlobServiceClient(accountUrl, new DefaultAzureCredential())
        .getContainerClient(containerName).getBlobClient(name)
      try {
        image = await blob.downloadToBuffer()
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 404) throw new RequestError(404, 'Image not found.')
        throw error
      }
    } else {
      try {
        image = await readFile(resolve(localImages, name))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new RequestError(404, 'Image not found.')
        throw error
      }
    }
    const contentType = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
    return {
      status: 200,
      body: image,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    }
  } catch (error) {
    return errorResponse(error, request, context)
  }
}

app.http('admin-image-upload', {
  methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'admin/images', handler: upload,
})
app.http('product-image', {
  methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'images/{name}', handler: serve,
})
