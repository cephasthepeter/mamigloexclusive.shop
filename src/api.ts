import type { AdminAccessEntry, CustomerAddress, CustomerAddressInput, CustomerDetails, CustomerWishlistEntry, PaymentMethod, Product, StoreOrder } from './types'
import { getAdminEligibility, normalizeEmail, requireSupabase, supabase } from './supabase'
import { uploadCloudinaryMedia, type CloudinaryAsset } from './media'

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

async function requireAdminAccess() {
  const { data: userResult, error: userError } = await supabase.auth.getUser()
  throwIfError(userError)
  if (!userResult.user?.email) throw new ApiError('Administrator sign-in is required.', 401)

  const allowed = await getAdminEligibility(userResult.user.email)
  if (!allowed) throw new ApiError('This account is not authorised to manage the store.', 403)

  return userResult.user.email
}

type DbProduct = {
  id: string
  sku: string
  name: string
  description: string
  category_id: string
  categories?: { name: string } | null
  price_ngn: number
  sale_price_ngn: number | null
  colors: string[]
  sizes: string[]
  stock_quantity: number
  featured: boolean
  is_published: boolean
  image_url: string
  image_urls: string[]
  media_assets?: Array<{ id: string; cloudinary_public_id: string; secure_url: string; media_type: string; alt_text: string; display_order: number }>
  created_at: string
}

function throwIfError(error: { message: string; status?: number; code?: string } | null) {
  if (error) throw new ApiError(error.message, error.status || (error.code === '42501' ? 403 : 500))
}

async function requireCustomer() {
  requireSupabase()
  const { data, error } = await supabase.auth.getUser()
  throwIfError(error)
  if (!data.user) throw new ApiError('Sign in to manage your account.', 401)
  return data.user
}

function mapCustomerAddress(row: Record<string, unknown>): CustomerAddress {
  return {
    id: String(row.id),
    recipientName: String(row.recipient_name),
    phone: String(row.phone),
    country: String(row.country),
    state: String(row.state),
    city: String(row.city),
    streetAddress: String(row.street_address),
    additionalDirections: String(row.additional_directions || ''),
    postalCode: String(row.postal_code || ''),
    isDefault: Boolean(row.is_default),
    createdAt: String(row.created_at),
  }
}

function mapWishlistEntry(row: Record<string, unknown>): CustomerWishlistEntry {
  return { id: String(row.id), productId: String(row.product_id), createdAt: String(row.created_at) }
}

export function normalizeProductImageUrls(primary: string, gallery: string[] = []) {
  return [...new Set([primary, ...gallery].map((url) => url.trim()).filter(Boolean))]
}

function mapProduct(row: DbProduct): Product {
  const mediaAssets = (row.media_assets || []).filter((asset) => asset.secure_url)
    .sort((left, right) => left.display_order - right.display_order)
  const mapAsset = (asset: NonNullable<DbProduct['media_assets']>[number]) => ({
    id: asset.id,
    publicId: asset.cloudinary_public_id,
    url: asset.secure_url,
    altText: asset.alt_text,
    displayOrder: Number(asset.display_order),
  })
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    category: row.categories?.name || '',
    priceNGN: Number(row.price_ngn),
    ...(row.sale_price_ngn === null ? {} : { salePriceNGN: Number(row.sale_price_ngn) }),
    colors: row.colors || [],
    sizes: row.sizes || [],
    stockQuantity: Number(row.stock_quantity),
    featured: row.featured,
    available: row.is_published,
    imageUrl: row.image_url,
    imageUrls: normalizeProductImageUrls(row.image_url, row.image_urls || []),
    imageMedia: mediaAssets.filter((asset) => asset.media_type === 'image').map(mapAsset),
    videoMedia: mediaAssets.filter((asset) => asset.media_type === 'video').map(mapAsset),
    createdAt: row.created_at,
    demo: false,
  }
}

async function attachProductMedia(rows: DbProduct[]) {
  const productIds = rows.map((row) => row.id)
  if (!productIds.length) return rows

  const { data: assets, error } = await supabase.from('media_assets')
    .select('id, product_id, cloudinary_public_id, secure_url, media_type, alt_text, display_order')
    .in('product_id', productIds)
  throwIfError(error)
  const mediaByProduct = new Map<string, NonNullable<DbProduct['media_assets']>>()
  for (const asset of assets || []) {
    const productMedia = mediaByProduct.get(asset.product_id) || []
    productMedia.push(asset)
    mediaByProduct.set(asset.product_id, productMedia)
  }
  return rows.map((row) => ({ ...row, media_assets: mediaByProduct.get(row.id) || [] }))
}

function normalizeOrderStatus(rawStatus: unknown): StoreOrder['status'] {
  const value = String(rawStatus || '').trim()
  if (!value) return 'Pending'
  const canonical = value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (canonical === 'pending payment verification' || canonical === 'pending_payment_verification') return 'Pending'
  if (canonical === 'ready for dispatch') return 'Ready for Dispatch'
  if (['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled'].includes(canonical)) return canonical.charAt(0).toUpperCase() + canonical.slice(1) as StoreOrder['status']
  return 'Pending'
}

function normalizePaymentStatus(rawStatus: unknown): StoreOrder['paymentStatus'] {
  const value = String(rawStatus || '').trim()
  if (!value) return 'Pending'
  const canonical = value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (canonical === 'pending verification' || canonical === 'pending payment verification' || canonical === 'pending_verification') return 'Pending Verification'
  if (canonical === 'rejected' || canonical === 'payment rejected' || canonical === 'payment rejected by admin') return 'Rejected'
  if (canonical === 'failed') return 'Failed'
  if (canonical === 'paid') return 'Paid'
  if (canonical === 'refunded') return 'Refunded'
  if (canonical === 'pending') return 'Pending'
  return 'Pending'
}

export function mapOrder(row: Record<string, unknown>): StoreOrder {
  const legacyStatus = String(row.status || 'Pending')
  const rawStatus = row.fulfilment_status ?? row.fulfilmentStatus ?? row.status
  const status = normalizeOrderStatus(rawStatus)
  const rawPaymentStatus = row.payment_status ?? row.paymentStatus ?? (legacyStatus === 'Paid' ? 'Paid' : 'Pending')
  const paymentStatus = normalizePaymentStatus(rawPaymentStatus)
  const rawPaymentMethod = row.payment_method ?? row.paymentMethod
  const paymentMethod = rawPaymentMethod === 'opay_transfer' || rawPaymentMethod === 'cash_on_delivery'
    ? rawPaymentMethod as PaymentMethod
    : undefined
  const rawPaymentHistory = row.payment_history ?? row.paymentHistory
  const optionalText = (value: unknown) => typeof value === 'string' && value.trim() ? value : undefined
  const metadata = {
    ...(optionalText(row.customer_user_id ?? row.customerUserId) ? { customerUserId: optionalText(row.customer_user_id ?? row.customerUserId) } : {}),
    ...(optionalText(row.payment_reference ?? row.paymentReference) ? { paymentReference: optionalText(row.payment_reference ?? row.paymentReference) } : {}),
    ...(optionalText(row.payment_confirmation_submitted_at ?? row.paymentConfirmationSubmittedAt) ? { paymentConfirmationSubmittedAt: optionalText(row.payment_confirmation_submitted_at ?? row.paymentConfirmationSubmittedAt) } : {}),
    ...(optionalText(row.payment_confirmed_at ?? row.paymentConfirmedAt) ? { paymentConfirmedAt: optionalText(row.payment_confirmed_at ?? row.paymentConfirmedAt) } : {}),
    ...(optionalText(row.payment_rejected_at ?? row.paymentRejectedAt) ? { paymentRejectedAt: optionalText(row.payment_rejected_at ?? row.paymentRejectedAt) } : {}),
    ...(optionalText(row.payment_rejection_reason ?? row.paymentRejectionReason) ? { paymentRejectionReason: optionalText(row.payment_rejection_reason ?? row.paymentRejectionReason) } : {}),
    ...(optionalText(row.verifying_admin_id ?? row.paymentVerifiedBy) ? { paymentVerifiedBy: optionalText(row.verifying_admin_id ?? row.paymentVerifiedBy) } : {}),
    ...(optionalText(row.shipping_carrier ?? row.shippingCarrier) ? { shippingCarrier: optionalText(row.shipping_carrier ?? row.shippingCarrier) } : {}),
    ...(optionalText(row.tracking_number ?? row.trackingNumber) ? { trackingNumber: optionalText(row.tracking_number ?? row.trackingNumber) } : {}),
    ...(optionalText(row.shipping_updated_at ?? row.shippingUpdatedAt) ? { shippingUpdatedAt: optionalText(row.shipping_updated_at ?? row.shippingUpdatedAt) } : {}),
    ...(optionalText(row.shipping_updated_by_email ?? row.shippingUpdatedBy) ? { shippingUpdatedBy: optionalText(row.shipping_updated_by_email ?? row.shippingUpdatedBy) } : {}),
    ...(optionalText(row.shipping_updated_by ?? row.shippingUpdatedById) ? { shippingUpdatedById: optionalText(row.shipping_updated_by ?? row.shippingUpdatedById) } : {}),
    ...(optionalText(row.archived_at ?? row.archivedAt) ? { archivedAt: optionalText(row.archived_at ?? row.archivedAt) } : {}),
    ...(optionalText(row.archived_by ?? row.archivedBy) ? { archivedBy: optionalText(row.archived_by ?? row.archivedBy) } : {}),
  }
  if (row.customer && row.lines) {
    return {
      ...(row as unknown as StoreOrder),
      status,
      paymentStatus,
      ...metadata,
      ...(paymentMethod ? { paymentMethod } : {}),
      paymentHistory: Array.isArray(rawPaymentHistory) ? rawPaymentHistory as StoreOrder['paymentHistory'] : [],
    }
  }
  const history = Array.isArray(row.status_history) ? row.status_history : []
  const items = Array.isArray(row.order_items) ? row.order_items as Array<Record<string, unknown>> : []
  return {
    id: String(row.id),
    reference: String(row.reference),
    customer: {
      fullName: String(row.customer_name),
      phone: String(row.customer_phone),
      ...(row.customer_email ? { email: String(row.customer_email) } : {}),
      address: String(row.delivery_address),
      state: String(row.delivery_state),
      city: String(row.delivery_city),
      deliveryMethod: String(row.delivery_method),
      ...(row.instructions ? { instructions: String(row.instructions) } : {}),
    },
    lines: items.map((item) => ({
      productId: String(item.product_id || ''),
      ...(item.product_image_url ? { imageUrl: String(item.product_image_url) } : {}),
      name: String(item.product_name),
      quantity: Number(item.quantity),
      unitPriceNGN: Number(item.unit_price_ngn),
      ...(item.color ? { color: String(item.color) } : {}),
      ...(item.size ? { size: String(item.size) } : {}),
    })),
    subtotalNGN: Number(row.subtotal_ngn),
    deliveryFeeNGN: Number(row.delivery_fee_ngn),
    totalNGN: Number(row.total_ngn),
    status,
    paymentStatus,
    ...metadata,
    ...(paymentMethod ? { paymentMethod } : {}),
    statusHistory: history as StoreOrder['statusHistory'],
    paymentHistory: Array.isArray(rawPaymentHistory) ? rawPaymentHistory as StoreOrder['paymentHistory'] : [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(row.inventory_released_at ? { inventoryReleasedAt: String(row.inventory_released_at) } : {}),
  }
}

function mapCustomerOrder(row: Record<string, unknown>): StoreOrder {
  if (!Array.isArray(row.order_items) || row.order_items.length === 0) {
    throw new ApiError(`Product details could not be loaded for order ${String(row.reference || '')}.`, 500)
  }
  return mapOrder(row)
}

export const storeApi = {
  products: async () => {
    requireSupabase()
    const { data, error } = await supabase.from('products')
      .select('*, categories(name)')
      .eq('is_published', true).order('name')
    throwIfError(error)
    const products = await attachProductMedia((data || []) as unknown as DbProduct[])
    return { products: products.map(mapProduct), demoMode: false }
  },
  categories: async () => {
    requireSupabase()
    const { data, error } = await supabase.from('categories').select('name').order('name')
    throwIfError(error)
    return { categories: (data || []).map((row) => row.name) }
  },
  storeConfig: async () => {
    requireSupabase()
    const { data, error } = await supabase.from('site_settings')
      .select('announcement, delivery_fee_ngn').eq('singleton', true).single()
    throwIfError(error)
    if (!data) throw new ApiError('Store settings could not be loaded.', 500)
    return { announcement: data.announcement, deliveryFeeNGN: Number(data.delivery_fee_ngn) }
  },
  product: async (id: string) => {
    requireSupabase()
    const { data, error } = await supabase.from('products')
      .select('*, categories(name)')
      .eq('id', id).eq('is_published', true).maybeSingle()
    throwIfError(error)
    if (!data) throw new ApiError('Product not found.', 404)
    const [product] = await attachProductMedia([data as unknown as DbProduct])
    return { product: mapProduct(product) }
  },
  createOrder: async (customer: CustomerDetails, items: Array<{ productId: string; quantity: number; color?: string; size?: string }>, paymentMethod: PaymentMethod) => {
    requireSupabase()
    const payload = JSON.stringify({ customer, items })
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
    const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const storageKey = 'mamigloexclusive.pending-order'
    let pending: { fingerprint: string; key: string } | undefined
    try { pending = JSON.parse(sessionStorage.getItem(storageKey) || 'null') as typeof pending } catch { pending = undefined }
    if (!pending || pending.fingerprint !== fingerprint) {
      pending = { fingerprint, key: crypto.randomUUID() }
      sessionStorage.setItem(storageKey, JSON.stringify(pending))
    }
    const { data, error } = await supabase.functions.invoke('create-order', {
      body: { customer, items, idempotencyKey: pending.key, paymentMethod },
    })
    if (error) {
      let message = 'The order could not be submitted. Please try again.'
      let status = 500
      if (error.context instanceof Response) {
        status = error.context.status
        const result = await error.context.clone().json().catch(() => ({})) as { error?: string }
        message = result.error || message
      }
      throw new ApiError(message, status)
    }
    if (!data?.order) throw new ApiError('The order could not be submitted. Please try again.', 500)
    sessionStorage.removeItem(storageKey)
    return { order: mapOrder(data.order as Record<string, unknown>) }
  },
  contact: async (_data: { name: string; email: string; message: string; website: string }): Promise<{ message: string }> => {
    throw new ApiError('The contact form is not configured yet. Please contact us on WhatsApp.', 503)
  },
  customer: {
    orders: async () => {
      const user = await requireCustomer()
      const { data, error } = await supabase.from('orders').select('*, order_items(*)')
        .eq('customer_user_id', user.id).order('created_at', { ascending: false })
      throwIfError(error)
      const orders = (data || []).map((row) => mapCustomerOrder(row as unknown as Record<string, unknown>))
      return { orders }
    },
    order: async (orderId: string) => {
      const user = await requireCustomer()
      const { data, error } = await supabase.from('orders').select('*, order_items(*)')
        .eq('id', orderId).eq('customer_user_id', user.id).maybeSingle()
      throwIfError(error)
      return { order: data ? mapCustomerOrder(data as unknown as Record<string, unknown>) : null }
    },
    submitPaymentConfirmation: async (orderId: string, paymentReference: string, amountNGN: number) => {
      const user = await requireCustomer()
      const { data, error } = await supabase.rpc('submit_order_payment_confirmation', {
        p_order_id: orderId,
        p_customer_user_id: user.id,
        p_payment_reference: paymentReference.trim(),
        p_payment_amount: amountNGN,
        p_payment_method: 'opay_transfer',
      })
      throwIfError(error)
      if (!data || data.paymentStatus !== 'Pending Verification' || typeof data.submittedAt !== 'string') {
        throw new ApiError('Your payment confirmation could not be recorded. Please retry.', 500)
      }
      return { submittedAt: data.submittedAt }
    },
    addresses: async () => {
      const user = await requireCustomer()
      const { data, error } = await supabase.from('customer_addresses').select('*').eq('user_id', user.id)
        .order('is_default', { ascending: false }).order('created_at', { ascending: false })
      throwIfError(error)
      return { addresses: (data || []).map((row) => mapCustomerAddress(row as unknown as Record<string, unknown>)) }
    },
    saveAddress: async (address: CustomerAddressInput, id?: string) => {
      const user = await requireCustomer()
      const values = {
        recipient_name: address.recipientName.trim(),
        phone: address.phone.trim(),
        country: address.country.trim(),
        state: address.state.trim(),
        city: address.city.trim(),
        street_address: address.streetAddress.trim(),
        additional_directions: address.additionalDirections.trim() || null,
        postal_code: address.postalCode.trim() || null,
      }
      const query = id
        ? supabase.from('customer_addresses').update(values).eq('id', id).eq('user_id', user.id)
        : supabase.from('customer_addresses').insert({ ...values, user_id: user.id })
      const { data, error } = await query.select('*').single()
      throwIfError(error)
      return { address: mapCustomerAddress(data as unknown as Record<string, unknown>) }
    },
    setDefaultAddress: async (id: string) => {
      await requireCustomer()
      const { error } = await supabase.rpc('set_customer_default_address', { p_address_id: id })
      throwIfError(error)
    },
    removeAddress: async (id: string) => {
      const user = await requireCustomer()
      const { error } = await supabase.from('customer_addresses').delete().eq('id', id).eq('user_id', user.id)
      throwIfError(error)
    },
    wishlist: async () => {
      const user = await requireCustomer()
      const { data, error } = await supabase.from('customer_wishlist').select('id, product_id, created_at')
        .eq('user_id', user.id).order('created_at', { ascending: false })
      throwIfError(error)
      return { items: (data || []).map((row) => mapWishlistEntry(row as unknown as Record<string, unknown>)) }
    },
    addWishlistItem: async (productId: string) => {
      const user = await requireCustomer()
      const { error } = await supabase.from('customer_wishlist').upsert(
        { user_id: user.id, product_id: productId },
        { onConflict: 'user_id,product_id', ignoreDuplicates: true },
      )
      throwIfError(error)
    },
    removeWishlistItem: async (productId: string) => {
      const user = await requireCustomer()
      const { error } = await supabase.from('customer_wishlist').delete().eq('user_id', user.id).eq('product_id', productId)
      throwIfError(error)
    },
  },
  admin: {
    orphanMedia: async (_token: string) => {
      requireSupabase()
      await requireAdminAccess()
      const { data, error } = await supabase.from('media_assets')
        .select('id, cloudinary_public_id, secure_url, media_type, resource_type, format, width, height, duration_seconds')
        .is('product_id', null).is('hero_campaign_id', null).is('journal_article_id', null)
        .order('created_at', { ascending: false }).limit(100)
      throwIfError(error)
      return (data || []).map((asset) => ({
        id: asset.id,
        publicId: asset.cloudinary_public_id,
        secureUrl: asset.secure_url,
        mediaType: asset.media_type === 'video' ? 'video' as const : 'image' as const,
        resourceType: asset.resource_type,
        format: asset.format,
        width: asset.width,
        height: asset.height,
        durationSeconds: asset.duration_seconds,
      }))
    },
    adminUsers: async (_token: string): Promise<{ admins: AdminAccessEntry[] }> => {
      requireSupabase()
      await requireAdminAccess()
      const { data, error } = await supabase.rpc('list_store_admins')
      throwIfError(error)
      return {
        admins: ((data || []) as Array<{ email: string; created_at: string }>).map((admin) => ({
          email: admin.email,
          createdAt: admin.created_at,
        })),
      }
    },
    removeAdminUser: async (_token: string, email: string) => {
      requireSupabase()
      await requireAdminAccess()
      const { data, error } = await supabase.rpc('remove_store_admin', { p_email: normalizeEmail(email) })
      throwIfError(error)
      if (data !== true) throw new ApiError('Administrator access could not be removed.', 500)
      return { ok: true }
    },
    products: async (_token: string) => {
      requireSupabase()
      await requireAdminAccess()
      const { data, error } = await supabase.from('products')
        .select('*, categories(name)')
        .order('name')
      throwIfError(error)
      const products = await attachProductMedia((data || []) as unknown as DbProduct[])
      return { products: products.map(mapProduct) }
    },
    categories: async (_token: string) => storeApi.categories(),
    storeConfig: async (_token: string) => storeApi.storeConfig(),
    saveStoreConfig: async (_token: string, announcement: string) => {
      requireSupabase()
      await requireAdminAccess()
      const { data, error } = await supabase.from('site_settings').update({ announcement })
        .eq('singleton', true).select('announcement').single()
      throwIfError(error)
      if (!data) throw new ApiError('Store settings could not be updated.', 500)
      return { announcement: data.announcement }
    },
    saveDeliveryFee: async (_token: string, deliveryFeeNGN: number) => {
      requireSupabase()
      await requireAdminAccess()
      const { data, error } = await supabase.from('site_settings').update({ delivery_fee_ngn: deliveryFeeNGN })
        .eq('singleton', true).select('delivery_fee_ngn').single()
      throwIfError(error)
      if (!data) throw new ApiError('Delivery fee could not be updated.', 500)
      return { deliveryFeeNGN: Number(data.delivery_fee_ngn) }
    },
    saveCategory: async (_token: string, name: string) => {
      requireSupabase()
      await requireAdminAccess()
      const existing = await supabase.from('categories').select('name')
      throwIfError(existing.error)
      if ((existing.data || []).some((row) => row.name.toLowerCase() === name.trim().toLowerCase())) {
        throw new ApiError('That category already exists.', 409)
      }
      const slug = name.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID()
      const result = await supabase.from('categories').insert({ name: name.trim(), slug })
      throwIfError(result.error)
      return storeApi.categories()
    },
    deleteCategory: async (_token: string, name: string) => {
      requireSupabase()
      await requireAdminAccess()
      const result = await supabase.from('categories').delete().eq('name', name)
      throwIfError(result.error)
      return storeApi.categories()
    },
    saveProduct: async (_token: string, product: Partial<Product>) => {
      requireSupabase()
      await requireAdminAccess()
      const category = await supabase.from('categories').select('id').eq('name', product.category || '').single()
      throwIfError(category.error)
      if (!category.data) throw new ApiError('Choose a valid product category.', 400)
      const row = {
        ...(product.id ? { id: product.id } : {}),
        sku: product.sku,
        name: product.name,
        description: product.description,
        category_id: category.data.id,
        price_ngn: product.priceNGN,
        sale_price_ngn: product.salePriceNGN ?? null,
        colors: product.colors || [],
        sizes: product.sizes || [],
        stock_quantity: product.stockQuantity,
        featured: product.featured,
        is_published: product.available,
        image_url: product.imageUrl,
        image_urls: product.imageUrls?.length ? product.imageUrls : product.imageUrl ? [product.imageUrl] : [],
      }
      const result = await supabase.from('products').upsert(row).select('*, categories(name)').single()
      throwIfError(result.error)
      const savedProduct = result.data as unknown as DbProduct
      const imageUrls = normalizeProductImageUrls(savedProduct.image_url, savedProduct.image_urls || [])
        .filter((url) => url.startsWith('https://res.cloudinary.com/'))
      const { error: detachError } = await supabase.from('media_assets').update({ product_id: null })
        .eq('product_id', savedProduct.id)
      throwIfError(detachError)
      if (imageUrls.length) {
        const { error: mediaError } = await supabase.from('media_assets').update({ product_id: savedProduct.id })
          .eq('folder', 'mamiglo/products').in('secure_url', imageUrls)
        throwIfError(mediaError)
      }
      const currentMedia = [
        ...(product.imageMedia || []).map((media) => ({ ...media, mediaType: 'image' })),
        ...(product.videoMedia || []).map((media) => ({ ...media, mediaType: 'video' })),
      ]
      for (const [displayOrder, media] of currentMedia.entries()) {
        const isReferenced = media.mediaType === 'video' || imageUrls.includes(media.url)
        const { error: metadataError } = await supabase.from('media_assets').update({
          product_id: isReferenced ? savedProduct.id : null,
          alt_text: media.altText.slice(0, 250),
          display_order: displayOrder,
          is_active: isReferenced,
        }).eq('id', media.id)
        throwIfError(metadataError)
      }
      return { product: mapProduct(savedProduct) }
    },
    deleteProduct: async (_token: string, id: string) => {
      requireSupabase()
      await requireAdminAccess()
      const { error } = await supabase.from('products').update({ is_published: false }).eq('id', id)
      throwIfError(error)
      return { ok: true }
    },
    orders: async (_token: string, search = '', archived?: boolean) => {
      requireSupabase()
      await requireAdminAccess()
      let queryBuilder = supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false })
      if (archived === true) queryBuilder = queryBuilder.not('archived_at', 'is', null)
      if (archived === false) queryBuilder = queryBuilder.is('archived_at', null)
      const { data, error } = await queryBuilder
      throwIfError(error)
      const normalized = (data || []).map((row) => mapOrder(row as unknown as Record<string, unknown>))
      const query = search.trim().toLowerCase()
      return { orders: normalized.filter((order) => !query || [order.reference, order.customer.fullName, order.customer.phone, order.customer.email].some((value) => value?.toLowerCase().includes(query))) }
    },
    setOrderArchived: async (_token: string, id: string, archived: boolean) => {
      requireSupabase()
      const email = await requireAdminAccess()
      const { data, error } = await supabase.rpc('admin_set_order_archived', {
        p_order_id: id,
        p_archived: archived,
        p_actor_email: email,
      })
      throwIfError(error)
      if (!data) throw new ApiError('Order not found.', 404)
      return { ok: true }
    },
    updateOrder: async (_token: string, id: string, status: StoreOrder['status']) => {
      requireSupabase()
      const email = await requireAdminAccess()
      const { data, error } = await supabase.rpc('admin_update_order_status', {
        p_order_id: id,
        p_status: status,
        p_actor_email: email,
      })
      throwIfError(error)
      if (!data) throw new ApiError('Order not found.', 404)
      const result = await storeApi.admin.orders(_token)
      const order = result.orders.find((item) => item.id === id)
      if (!order) throw new ApiError('The order was updated but could not be reloaded.', 500)
      return { order }
    },
    updatePaymentStatus: async (_token: string, id: string, status: StoreOrder['paymentStatus']) => {
      requireSupabase()
      const email = await requireAdminAccess()
      const { data, error } = await supabase.rpc('admin_update_order_payment_status', {
        p_order_id: id,
        p_status: status,
        p_actor_email: email,
      })
      throwIfError(error)
      if (!data) throw new ApiError('Order not found.', 404)
      const result = await storeApi.admin.orders(_token)
      const order = result.orders.find((item) => item.id === id)
      if (!order) throw new ApiError('The order was updated but could not be reloaded.', 500)
      return { order }
    },
    reviewPayment: async (_token: string, id: string, decision: 'confirm' | 'reject', reason = '') => {
      requireSupabase()
      const email = await requireAdminAccess()
      const { data, error } = await supabase.rpc('admin_review_payment', {
        p_order_id: id,
        p_decision: decision,
        p_admin_email: email,
        p_reason: reason,
      })
      throwIfError(error)
      if (!data) throw new ApiError('The payment decision could not be recorded.', 500)
      const result = await storeApi.admin.orders(_token)
      const order = result.orders.find((item) => item.id === id)
      if (!order) throw new ApiError('The payment decision was saved but the order could not be reloaded.', 500)
      return { order }
    },
    updateShipping: async (_token: string, id: string, carrier: string, trackingNumber: string) => {
      requireSupabase()
      const email = await requireAdminAccess()
      const { data, error } = await supabase.rpc('admin_update_order_shipping', {
        p_order_id: id,
        p_carrier: carrier,
        p_tracking_number: trackingNumber,
        p_actor_email: email,
      })
      throwIfError(error)
      if (!data) throw new ApiError('The order shipping details could not be saved.', 500)
      const result = await storeApi.admin.orders(_token)
      const order = result.orders.find((item) => item.id === id)
      if (!order) throw new ApiError('Shipping details were saved but the order could not be reloaded.', 500)
      return { order }
    },
    uploadMedia: async (_token: string, file: File, options: { scope?: 'product' | 'journal' | 'profile'; onProgress?: (progress: number) => void; signal?: AbortSignal } = {}): Promise<CloudinaryAsset> => {
      requireSupabase()
      await requireAdminAccess()
      return uploadCloudinaryMedia(file, options.scope || 'product', options.onProgress, options.signal)
    },
    uploadImage: async (_token: string, file: File) => {
      const asset = await storeApi.admin.uploadMedia(_token, file, { scope: 'journal' })
      return asset.secureUrl
    },
  },
}
