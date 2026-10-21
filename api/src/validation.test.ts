import { describe, expect, it } from 'vitest'
import { checkoutSchema, productSchema } from './validation.js'

describe('server input validation', () => {
  it('rejects invalid quantities and extra browser-supplied fields', () => {
    expect(checkoutSchema.safeParse({
      customer: {
        fullName: 'Customer Example', phone: '+2348000000000', address: '1 Example Road',
        state: 'Lagos', city: 'Ikeja', deliveryMethod: 'Courier',
      },
      items: [{ productId: 'tie', quantity: 21, unitPriceNGN: 1 }],
    }).success).toBe(false)
  })

  it('rejects a sale price greater than the catalogue price', () => {
    expect(productSchema.safeParse({
      sku: 'DEMO-1', name: 'Tie', description: 'Demo item', category: 'Classic Ties',
      priceNGN: 10000, salePriceNGN: 11000, colors: [], stockQuantity: 0,
      featured: false, available: true, imageUrl: '/images/product-placeholder.svg',
    }).success).toBe(false)
  })
})
