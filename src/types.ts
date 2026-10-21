export const categories = [
  'Classic Ties',
  'Slim Ties',
  'Skinny Ties',
  'Premium and Silk Ties',
  'Patterned Ties',
  'Plain Ties',
  'Wedding Ties',
  'Bow Ties',
  'Self-Tie Bow Ties',
  'Cufflinks',
  'Lapel Pins and Brooches',
  'Pocket Squares',
  "Men's Socks",
  'Shirt Holders',
  'Tie and Socks Combos',
  'Flowers and Boutonnieres',
  'Cummerbunds',
] as const

export type Category = string
export type OrderStatus =
  | 'Pending'
  | 'Awaiting Payment'
  | 'Paid'
  | 'Processing'
  | 'Shipped'
  | 'Delivered'
  | 'Cancelled'

export interface Product {
  id: string
  sku: string
  name: string
  description: string
  category: Category
  priceNGN: number
  salePriceNGN?: number
  colors: string[]
  sizes?: string[]
  stockQuantity: number
  featured: boolean
  available: boolean
  imageUrl: string
  imageUrls?: string[]
  demo?: boolean
}

export interface CustomerDetails {
  fullName: string
  phone: string
  email?: string
  address: string
  state: string
  city: string
  deliveryMethod: string
  instructions?: string
}

export interface OrderLine {
  productId: string
  quantity: number
  color?: string
  size?: string
}

export interface StoreOrder {
  id: string
  reference: string
  customer: CustomerDetails
  lines: Array<OrderLine & { name: string; unitPriceNGN: number }>
  subtotalNGN: number
  deliveryFeeNGN: number
  totalNGN: number
  status: OrderStatus
  statusHistory: Array<{ status: OrderStatus; at: string; changedBy: string }>
  createdAt: string
  updatedAt: string
  inventoryReleasedAt?: string
}

export interface AdminAccessEntry {
  email: string
  createdAt: string
}
