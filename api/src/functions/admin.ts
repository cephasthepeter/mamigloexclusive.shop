import { randomUUID } from 'node:crypto'
import { app, type HttpRequest, type InvocationContext } from '@azure/functions'
import { requireAdmin } from '../auth.js'
import { asOrder, asProduct, cancelOrderAndReleaseStock, deleteDocument, findDocument, getCategoryNames, listDocuments, saveCategoryNames, saveDocument, StockConflictError } from '../store.js'
import { errorResponse, json, preflight, readJson, RequestError } from '../http.js'
import { announcementSchema, categorySchema, orderStatusSchema, productSchema } from '../validation.js'
import { getAnnouncement, saveAnnouncement } from '../store.js'
import type { Product, StoreOrder } from '../types.js'

async function products(request: HttpRequest, context: InvocationContext) {
  const options = preflight(request)
  if (options) return options
  try {
    await requireAdmin(request)
    if (request.method === 'GET') {
      const products = (await listDocuments('product')).map(asProduct)
      return json(200, { products }, request)
    }
    const parsed = productSchema.safeParse(await readJson(request))
    if (!parsed.success) throw new RequestError(400, 'Please review the product details and try again.')
    if (!(await getCategoryNames()).includes(parsed.data.category)) {
      throw new RequestError(400, 'Choose a category that is currently configured for the store.')
    }
    const id = parsed.data.id || randomUUID()
    const existing = await findDocument(id, 'product')
    const duplicateSku = (await listDocuments('product')).some((document) => {
      const product = asProduct(document)
      return product.sku.toLowerCase() === parsed.data.sku.toLowerCase() && product.id !== id
    })
    if (duplicateSku) throw new RequestError(409, 'That product SKU is already in use.')
    const product: Product = { ...parsed.data, id, ...(existing ? { demo: false } : {}) }
    await saveDocument({ ...product, id, type: 'product', partitionKey: 'store' })
    return json(200, { product }, request)
  } catch (error) {
    return errorResponse(error, request, context)
  }
}

async function categoriesHandler(request: HttpRequest, context: InvocationContext) {
  const options = preflight(request)
  if (options) return options
  try {
    await requireAdmin(request)
    if (request.method === 'GET') return json(200, { categories: await getCategoryNames() }, request)
    const parsed = categorySchema.safeParse(await readJson(request))
    if (!parsed.success) throw new RequestError(400, 'Enter a valid category name (up to 80 characters).')
    const current = await getCategoryNames()
    if (current.some((name) => name.toLowerCase() === parsed.data.name.toLowerCase())) {
      throw new RequestError(409, 'That category already exists.')
    }
    const updated = [...current, parsed.data.name]
    await saveCategoryNames(updated)
    return json(201, { categories: updated }, request)
  } catch (error) {
    return errorResponse(error, request, context)
  }
}

async function deleteCategory(request: HttpRequest, context: InvocationContext) {
  const options = preflight(request)
  if (options) return options
  try {
    await requireAdmin(request)
    const name = request.params.name || ''
    const current = await getCategoryNames()
    if (!current.includes(name)) throw new RequestError(404, 'Category not found.')
    const productUsesCategory = (await listDocuments('product'))
      .some((document) => String(document.category).toLowerCase() === name.toLowerCase())
    if (productUsesCategory) throw new RequestError(409, 'Move or delete products in this category before removing it.')
    await saveCategoryNames(current.filter((category) => category !== name))
    return json(200, { categories: current.filter((category) => category !== name) }, request)
  } catch (error) {
    return errorResponse(error, request, context)
  }
}

async function storeConfig(request: HttpRequest, context: InvocationContext) {
  const options = preflight(request)
  if (options) return options
  try {
    await requireAdmin(request)
    if (request.method === 'GET') return json(200, { announcement: await getAnnouncement() }, request)
    const parsed = announcementSchema.safeParse(await readJson(request))
    if (!parsed.success) throw new RequestError(400, 'Announcement text must be between 1 and 200 characters.')
    await saveAnnouncement(parsed.data.announcement)
    return json(200, { announcement: parsed.data.announcement }, request)
  } catch (error) {
    return errorResponse(error, request, context)
  }
}

async function removeProduct(request: HttpRequest, context: InvocationContext) {
  const options = preflight(request)
  if (options) return options
  try {
    await requireAdmin(request)
    const existing = await findDocument(request.params.id || '', 'product')
    if (!existing) throw new RequestError(404, 'Product not found.')
    const orders = (await listDocuments('order')).map((document) => asOrder<StoreOrder>(document))
    const hasOpenOrder = orders.some((order) =>
      !['Cancelled', 'Shipped', 'Delivered'].includes(order.status) &&
      order.lines.some((line) => line.productId === existing.id),
    )
    if (hasOpenOrder) throw new RequestError(409, 'This product is part of an open order. Hide it from the catalogue instead.')
    await deleteDocument(existing.id)
    return json(200, { ok: true }, request)
  } catch (error) {
    return errorResponse(error, request, context)
  }
}

async function orders(request: HttpRequest, context: InvocationContext) {
  const options = preflight(request)
  if (options) return options
  try {
    await requireAdmin(request)
    const query = (request.query.get('q') || '').trim().toLowerCase()
    const results = (await listDocuments('order'))
      .map((document) => asOrder<StoreOrder>(document))
      .filter((order) => !query || [
        order.reference, order.customer.fullName, order.customer.phone, order.customer.email,
      ].some((value) => value?.toLowerCase().includes(query)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return json(200, { orders: results }, request)
  } catch (error) {
    return errorResponse(error, request, context)
  }
}

async function updateOrder(request: HttpRequest, context: InvocationContext) {
  const options = preflight(request)
  if (options) return options
  try {
    const actor = await requireAdmin(request)
    const parsed = orderStatusSchema.safeParse(await readJson(request))
    if (!parsed.success) throw new RequestError(400, 'Choose a valid order status.')
    const document = await findDocument(request.params.id || '', 'order')
    if (!document) throw new RequestError(404, 'Order not found.')
    const order = asOrder<StoreOrder>(document)
    if (order.status === parsed.data.status) return json(200, { order }, request)
    const transitions: Record<StoreOrder['status'], StoreOrder['status'][]> = {
      Pending: ['Awaiting Payment', 'Paid', 'Processing', 'Cancelled'],
      'Awaiting Payment': ['Paid', 'Processing', 'Cancelled'],
      Paid: ['Processing', 'Cancelled'],
      Processing: ['Shipped', 'Cancelled'],
      Shipped: ['Delivered'],
      Delivered: [],
      Cancelled: [],
    }
    if (!transitions[order.status].includes(parsed.data.status)) {
      throw new RequestError(409, `An order cannot move from ${order.status} to ${parsed.data.status}.`)
    }
    if (parsed.data.status === 'Cancelled') {
      try {
        const cancelled = await cancelOrderAndReleaseStock(order, actor)
        return json(200, { order: cancelled }, request)
      } catch (error) {
        if (error instanceof StockConflictError) throw new RequestError(409, error.message)
        throw error
      }
    }
    const updatedAt = new Date().toISOString()
    const updated = {
      ...order,
      status: parsed.data.status,
      updatedAt,
      statusHistory: [...(order.statusHistory || []), { status: parsed.data.status, at: updatedAt, changedBy: actor }],
    }
    await saveDocument({ ...updated, type: 'order', partitionKey: 'store' })
    return json(200, { order: updated }, request)
  } catch (error) {
    return errorResponse(error, request, context)
  }
}

app.http('admin-products', {
  methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'admin/products', handler: products,
})
app.http('admin-categories', {
  methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'admin/categories', handler: categoriesHandler,
})
app.http('admin-category-delete', {
  methods: ['DELETE', 'OPTIONS'], authLevel: 'anonymous', route: 'admin/categories/{name}', handler: deleteCategory,
})
app.http('admin-store-config', {
  methods: ['GET', 'PATCH', 'OPTIONS'], authLevel: 'anonymous', route: 'admin/store-config', handler: storeConfig,
})
app.http('admin-product-delete', {
  methods: ['DELETE', 'OPTIONS'], authLevel: 'anonymous', route: 'admin/products/{id}', handler: removeProduct,
})
app.http('admin-orders', {
  methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'admin/orders', handler: orders,
})
app.http('admin-order-update', {
  methods: ['PATCH', 'OPTIONS'], authLevel: 'anonymous', route: 'admin/orders/{id}', handler: updateOrder,
})
