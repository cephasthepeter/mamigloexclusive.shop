import type { Product } from './types'

export interface CartItem {
  productId: string
  quantity: number
  color?: string
  size?: string
}

const STORAGE_KEY = 'mamigloexclusive-cart-v1'

export function loadCart(): CartItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is CartItem =>
      typeof item?.productId === 'string' &&
      Number.isInteger(item?.quantity) &&
      item.quantity > 0 &&
      item.quantity <= 99,
    )
  } catch {
    return []
  }
}

export function saveCart(items: CartItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function subtotal(items: CartItem[], products: Product[]) {
  return items.reduce((sum, item) => {
    const product = products.find(({ id }) => id === item.productId)
    return sum + (product ? (product.salePriceNGN ?? product.priceNGN) * item.quantity : 0)
  }, 0)
}
