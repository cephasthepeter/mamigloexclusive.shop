import { supabase } from './supabase'

export type MediaScope = 'product' | 'hero' | 'journal' | 'profile'
export type MediaType = 'image' | 'video'

export interface CloudinaryAsset {
  id: string
  publicId: string
  secureUrl: string
  mediaType: MediaType
  resourceType: string
  format: string
  width: number | null
  height: number | null
  durationSeconds: number | null
}

type UploadSignature = {
  apiKey: string
  cloudName: string
  folder: string
  mediaType: MediaType
  publicId: string
  signature: string
  timestamp: string
  uploadPreset: string
  maxBytes: number
}

function fromUploadResponse(row: Record<string, unknown>, id: string): CloudinaryAsset {
  return {
    id,
    publicId: String(row.public_id || ''),
    secureUrl: String(row.secure_url || ''),
    mediaType: row.resource_type === 'video' ? 'video' : 'image',
    resourceType: String(row.resource_type || 'image'),
    format: String(row.format || ''),
    width: Number.isFinite(Number(row.width)) ? Number(row.width) : null,
    height: Number.isFinite(Number(row.height)) ? Number(row.height) : null,
    durationSeconds: Number.isFinite(Number(row.duration)) ? Number(row.duration) : null,
  }
}

export async function uploadCloudinaryMedia(
  file: File,
  scope: MediaScope,
  onProgress: (progress: number) => void = () => {},
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new DOMException('The media upload was cancelled.', 'AbortError')
  const mediaType: MediaType = file.type.startsWith('video/') ? 'video' : 'image'
  const acceptedTypes = mediaType === 'image'
    ? ['image/jpeg', 'image/png', 'image/webp']
    : ['video/mp4', 'video/webm']
  const maxBytes = mediaType === 'image' ? 10 * 1024 * 1024 : 100 * 1024 * 1024
  if (!acceptedTypes.includes(file.type)) throw new Error('Choose a JPG, PNG or WebP image, or an MP4 or WebM video.')
  if (file.size < 1 || file.size > maxBytes) throw new Error(`Files must be ${maxBytes / (1024 * 1024)} MB or smaller.`)

  const { data: signatureData, error: signatureError } = await supabase.functions.invoke('cloudinary-media', {
    body: { action: 'sign-upload', mediaType, scope, fileSize: file.size, mimeType: file.type },
  })
  if (signatureError) throw new Error(signatureError.message || 'An upload signature could not be issued.')
  const signed = signatureData as UploadSignature | null
  if (!signed?.signature || !signed.apiKey || !signed.cloudName) throw new Error('The upload signature response was incomplete.')
  if (file.size > signed.maxBytes) throw new Error(`This file exceeds the ${Math.floor(signed.maxBytes / (1024 * 1024))} MB upload limit.`)
  if (signal?.aborted) throw new DOMException('The media upload was cancelled.', 'AbortError')
  const configuredCloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  if (configuredCloudName && configuredCloudName !== signed.cloudName) {
    throw new Error('The frontend Cloudinary cloud name does not match the signing service.')
  }

  const uploadResponse = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const request = new XMLHttpRequest()
    const abort = () => request.abort()
    request.open('POST', `https://api.cloudinary.com/v1_1/${encodeURIComponent(signed.cloudName)}/${mediaType}/upload`)
    request.responseType = 'json'
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    request.onerror = () => reject(new Error('The media upload could not connect. Check your connection and try again.'))
    request.onabort = () => reject(new DOMException('The media upload was cancelled.', 'AbortError'))
    request.onload = () => {
      const body = request.response as Record<string, unknown> | null
      if (request.status >= 200 && request.status < 300 && body?.secure_url && body.public_id) {
        onProgress(100)
        resolve(body)
        return
      }
      const responseError = body?.error as { message?: string } | undefined
      reject(new Error(responseError?.message || 'Cloudinary could not save this media.'))
    }

    signal?.addEventListener('abort', abort, { once: true })
    const form = new FormData()
    form.set('file', file)
    form.set('api_key', signed.apiKey)
    form.set('timestamp', signed.timestamp)
    form.set('signature', signed.signature)
    form.set('folder', signed.folder)
    form.set('public_id', signed.publicId)
    form.set('upload_preset', signed.uploadPreset)
    form.set('unique_filename', 'false')
    form.set('overwrite', 'false')
    request.onloadend = () => signal?.removeEventListener('abort', abort)
    request.send(form)
  })

  const asset = fromUploadResponse(uploadResponse, crypto.randomUUID())
  if (!asset.publicId || !asset.secureUrl) throw new Error('Cloudinary returned incomplete media details.')
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('Administrator sign-in is required to save media details.')
  const folder = signed.folder
  const { data: savedAsset, error: saveError } = await supabase.from('media_assets').insert({
    id: asset.id,
    media_type: mediaType,
    cloudinary_public_id: asset.publicId,
    secure_url: asset.secureUrl,
    folder,
    resource_type: asset.resourceType,
    format: asset.format,
    width: asset.width,
    height: asset.height,
    duration_seconds: asset.durationSeconds,
    uploaded_by: userData.user.id,
  }).select('id').single()
  if (saveError || !savedAsset) {
    const { data: cleanup, error: cleanupError } = await supabase.functions.invoke('cloudinary-media', {
      body: {
        action: 'cleanup-orphan',
        publicId: asset.publicId,
        secureUrl: asset.secureUrl,
        folder,
        resourceType: asset.resourceType,
      },
    })
    if (!cleanupError && cleanup?.deleted === true) {
      throw new Error('Supabase could not record this upload, so the unreferenced Cloudinary file was safely removed. Please retry.')
    }
    throw new Error('Supabase could not record this upload. Cloudinary cleanup could not be confirmed, so the file was kept for administrator review.')
  }
  return { ...asset, id: savedAsset.id }
}

export async function deleteCloudinaryAsset(id: string) {
  const { data, error } = await supabase.functions.invoke('cloudinary-media', {
    body: { action: 'delete-asset', id },
  })
  if (error) throw new Error(error.message || 'The media asset could not be removed.')
  if (data?.deleted !== true) throw new Error(data?.error || 'The media asset could not be removed.')
}