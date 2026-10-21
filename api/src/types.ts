export type Category = string

export type OrderStatus =
  | 'Pending' | 'Awaiting Payment' | 'Paid' | 'Processing'
  | 'Shipped' | 'Delivered' | 'Cancelled'

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
  demo?: boolean
}

export interface OrderLine {
  productId: string
  name: string
  quantity: number
  unitPriceNGN: number
  color?: string
  size?: string
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

export interface StoreOrder {
  id: string
  reference: string
  customer: CustomerDetails
  lines: OrderLine[]
  subtotalNGN: number
  deliveryFeeNGN: number
  totalNGN: number
  status: OrderStatus
  statusHistory: Array<{ status: OrderStatus; at: string; changedBy: string }>
  createdAt: string
  updatedAt: string
  inventoryReleasedAt?: string
}

export interface StoreDocument {
  id: string
  partitionKey: 'store'
  type: 'product' | 'order' | 'categories' | 'settings'
  [key: string]: unknown
}
