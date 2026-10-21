import { describe, expect, it } from 'vitest'
import { subtotal } from './cart'
import type { Product } from './types'

const products = [{
  id: 'tie-1', sku: 'DEMO-1', name: 'Demo tie', description: '', category: 'Classic Ties',
  priceNGN: 12000, salePriceNGN: 10000, colors: ['Black'], stockQuantity: 4,
  featured: true, available: true, imageUrl: '',
}] satisfies Product[]

describe('cart totals', () => {
  it('uses the sale price when present and ignores removed products', () => {
    expect(subtotal([
      { productId: 'tie-1', quantity: 2 },
      { productId: 'removed', quantity: 4 },
    ], products)).toBe(20000)
  })
})
