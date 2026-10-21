import { randomBytes, randomUUID } from 'node:crypto'
import { app, type HttpRequest, type InvocationContext } from '@azure/functions'
import { asProduct, createOrderWithStockReservation, findDocument, StockConflictError } from '../store.js'
import { enforceRateLimit, errorResponse, json, preflight, readIntegerSetting, readJson, RequestError } from '../http.js'
import { checkoutSchema } from '../validation.js'
import type { Product, StoreOrder } from '../types.js'

function makeReference() {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `MG-${day}-${randomBytes(3).toString('hex').toUpperCase()}`
}

async function create(request: HttpRequest, context: InvocationContext) {
  const options = preflight(request)
  if (options) return options
  try {
    enforceRateLimit(request, context, 5, 60_000)
    const parsed = checkoutSchema.safeParse(await readJson(request))
    if (!parsed.success) throw new RequestError(400, 'Please check the order details and try again.')

    const quantities = new Map<string, number>()
    for (const line of parsed.data.items) {
      quantities.set(line.productId, (quantities.get(line.productId) || 0) + line.quantity)
    }
    const productsById = new Map<string, Product>()
    for (const productId of quantities.keys()) {
      const doc = await findDocument(productId, 'product')
      if (!doc) throw new RequestError(409, 'One or more selected items are no longer available.')
      productsById.set(productId, asProduct(doc))
    }
    const lines = parsed.data.items.map((line) => {
      const product = productsById.get(line.productId)!
      const totalQuantity = quantities.get(line.productId)!
      if (!product.available || totalQuantity > product.stockQuantity) {
        throw new RequestError(409, `${product.name} does not have enough available stock for this order.`)
      }
      if (line.color && !product.colors.includes(line.color)) {
        throw new RequestError(400, `The selected colour for ${product.name} is unavailable.`)
      }
      if (line.size && !(product.sizes || []).includes(line.size)) {
        throw new RequestError(400, `The selected size for ${product.name} is unavailable.`)
      }
      return {
        productId: product.id,
        name: product.name,
        quantity: line.quantity,
        unitPriceNGN: product.salePriceNGN ?? product.priceNGN,
        ...(line.color ? { color: line.color } : {}),
        ...(line.size ? { size: line.size } : {}),
      }
    })

    const subtotalNGN = lines.reduce((sum, line) => sum + line.unitPriceNGN * line.quantity, 0)
    const deliveryFeeNGN = readIntegerSetting('DELIVERY_FEE_NGN', 0)
    const now = new Date().toISOString()
    const order: StoreOrder = {
      id: randomUUID(),
      reference: makeReference(),
      customer: parsed.data.customer,
      lines,
      subtotalNGN,
      deliveryFeeNGN,
      totalNGN: subtotalNGN + deliveryFeeNGN,
      status: 'Pending',
      statusHistory: [{ status: 'Pending', at: now, changedBy: 'customer' }],
      createdAt: now,
      updatedAt: now,
    }
    await createOrderWithStockReservation(order, quantities)
    return json(201, { order }, request)
  } catch (error) {
    if (error instanceof StockConflictError) {
      return json(409, { error: 'Stock changed while this order was being placed. Please review your bag and try again.' }, request)
    }
    return errorResponse(error, request, context)
  }
}

app.http('orders', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'orders',
  handler: create,
})
