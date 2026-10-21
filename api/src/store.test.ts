import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { cancelOrderAndReleaseStock, createOrderWithStockReservation, listDocuments, saveDocument, StockConflictError } from './store.js'
import type { StoreOrder, StoreDocument } from './types.js'

const dataFile = join(tmpdir(), `mamiglo-store-test-${randomUUID()}.json`)

beforeEach(async () => {
  process.env.LOCAL_STORE_PATH = dataFile
  delete process.env.COSMOS_ENDPOINT
  delete process.env.COSMOS_KEY
  await rm(dataFile, { force: true })
})

afterEach(async () => {
  await rm(dataFile, { force: true })
  delete process.env.LOCAL_STORE_PATH
})

describe('local order inventory', () => {
  it('validates, reserves and restores stock without trusting client prices', async () => {
    await saveDocument({
      id: 'product-1', type: 'product', partitionKey: 'store',
      sku: 'TEST-1', name: 'Test tie', description: 'Test item',
      category: 'Classic Ties', priceNGN: 12000, colors: ['Black'],
      stockQuantity: 2, featured: false, available: true, imageUrl: '/images/product-placeholder.svg',
    } as StoreDocument)

    const order: StoreOrder = {
      id: 'order-1', reference: 'MG-TEST-1',
      customer: {
        fullName: 'Example Customer', phone: '+2348000000000',
        address: '1 Example Road', city: 'Ikeja', state: 'Lagos', deliveryMethod: 'Courier',
      },
      lines: [{ productId: 'product-1', name: 'Test tie', quantity: 2, unitPriceNGN: 12000 }],
      subtotalNGN: 24000, deliveryFeeNGN: 0, totalNGN: 24000,
      status: 'Pending', statusHistory: [{ status: 'Pending', at: '2026-01-01T00:00:00.000Z', changedBy: 'customer' }],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }

    await expect(createOrderWithStockReservation(order, new Map([['product-1', 3]])))
      .rejects.toBeInstanceOf(StockConflictError)
    await createOrderWithStockReservation(order, new Map([['product-1', 2]]))

    const product = JSON.parse(await readFile(dataFile, 'utf8')) as StoreDocument[]
    expect(product.find((document) => document.id === 'product-1')?.stockQuantity).toBe(0)
    expect((await listDocuments('order')).some((document) => document.id === order.id)).toBe(true)

    await cancelOrderAndReleaseStock(order, 'admin@example.com')
    const cancelled = JSON.parse(await readFile(dataFile, 'utf8')) as StoreDocument[]
    expect(cancelled.find((document) => document.id === 'product-1')?.stockQuantity).toBe(2)
    expect(cancelled.find((document) => document.id === order.id)?.status).toBe('Cancelled')
  })
})
