import type { AdminAccessEntry, CustomerDetails, Product, StoreOrder } from './types'
import { getAdminEligibility, normalizeEmail, requireSupabase, supabase } from './supabase'

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
}

function throwIfError(error: { message: string; status?: number; code?: string } | null) {
  if (error) throw new ApiError(error.message, error.status || (error.code === '42501' ? 403 : 500))
}

export function normalizeProductImageUrls(primary: string, gallery: string[] = []) {
  return [...new Set([primary, ...gallery].map((url) => url.trim()).filter(Boolean))]
}

function mapProduct(row: DbProduct): Product {
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
    demo: false,
  }
}

function mapOrder(row: Record<string, unknown>): StoreOrder {
  if (row.customer && row.lines) return row as unknown as StoreOrder
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
      name: String(item.product_name),
      quantity: Number(item.quantity),
      unitPriceNGN: Number(item.unit_price_ngn),
      ...(item.color ? { color: String(item.color) } : {}),
      ...(item.size ? { size: String(item.size) } : {}),
    })),
    subtotalNGN: Number(row.subtotal_ngn),
    deliveryFeeNGN: Number(row.delivery_fee_ngn),
    totalNGN: Number(row.total_ngn),
    status: row.status as StoreOrder['status'],
    statusHistory: history as StoreOrder['statusHistory'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(row.inventory_released_at ? { inventoryReleasedAt: String(row.inventory_released_at) } : {}),
  }
}

export const storeApi = {
  products: async () => {
    requireSupabase()
    const { data, error } = await supabase.from('products')
      .select('*, categories(name)').eq('is_published', true).order('name')
    throwIfError(error)
    return { products: (data as unknown as DbProduct[]).map(mapProduct), demoMode: false }
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
      .select('*, categories(name)').eq('id', id).eq('is_published', true).maybeSingle()
    throwIfError(error)
    if (!data) throw new ApiError('Product not found.', 404)
    return { product: mapProduct(data as unknown as DbProduct) }
  },
  createOrder: async (customer: CustomerDetails, items: Array<{ productId: string; quantity: number; color?: string; size?: string }>) => {
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
      body: { customer, items, idempotencyKey: pending.key },
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
    return { order: data.order as StoreOrder }
  },
  contact: async (_data: { name: string; email: string; message: string; website: string }): Promise<{ message: string }> => {
    throw new ApiError('The contact form is not configured yet. Please contact us on WhatsApp.', 503)
  },
  customer: {
    orders: async () => {
      requireSupabase()
      const { data: authData, error: authError } = await supabase.auth.getUser()
      throwIfError(authError)
      if (!authData.user) throw new ApiError('Sign in to view your orders.', 401)
      const { data, error } = await supabase.from('orders').select('*, order_items(*)')
        .eq('customer_user_id', authData.user.id).order('created_at', { ascending: false })
      throwIfError(error)
      return { orders: (data || []).map((row) => mapOrder(row as unknown as Record<string, unknown>)) }
    },
  },
  admin: {
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
      const { data, error } = await supabase.from('products').select('*, categories(name)').order('name')
      throwIfError(error)
      return { products: (data as unknown as DbProduct[]).map(mapProduct) }
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
      return { product: mapProduct(result.data as unknown as DbProduct) }
    },
    deleteProduct: async (_token: string, id: string) => {
      requireSupabase()
      await requireAdminAccess()
      const { error } = await supabase.from('products').update({ is_published: false }).eq('id', id)
      throwIfError(error)
      return { ok: true }
    },
    orders: async (_token: string, search = '') => {
      requireSupabase()
      await requireAdminAccess()
      const { data, error } = await supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false })
      throwIfError(error)
      const normalized = (data || []).map((row) => mapOrder(row as unknown as Record<string, unknown>))
      const query = search.trim().toLowerCase()
      return { orders: normalized.filter((order) => !query || [order.reference, order.customer.fullName, order.customer.phone, order.customer.email].some((value) => value?.toLowerCase().includes(query))) }
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
    uploadImage: async (_token: string, file: File) => {
      requireSupabase()
      await requireAdminAccess()
      const form = new FormData()
      form.set('image', file)
      const { data, error } = await supabase.functions.invoke('upload-product-image', { body: form })
      throwIfError(error)
      if (!data?.url) throw new ApiError('Image upload failed.', 500)
      return String(data.url)
    },
  },
}
