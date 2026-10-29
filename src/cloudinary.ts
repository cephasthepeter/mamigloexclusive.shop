const cloudinaryImageUrlPattern = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/

export function cloudinaryImageUrl(url: string, width = 1200) {
  const match = url.match(cloudinaryImageUrlPattern)
  if (!match) return url

  const safeWidth = Math.max(1, Math.round(width))
  return `${match[1]}f_auto,q_auto,c_limit,w_${safeWidth}/${match[2]}`
}

export function cloudinaryVideoUrl(url: string, width = 1920) {
  const pattern = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/)(.*)$/
  const match = url.match(pattern)
  if (!match) return url

  const safeWidth = Math.max(1, Math.round(width))
  return `${match[1]}f_mp4,q_auto:good,c_limit,w_${safeWidth}/${match[2]}`
}