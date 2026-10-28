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
  | 'Confirmed'
  | 'Processing'
  | 'Ready for Dispatch'
  | 'Shipped'
  | 'Delivered'
  | 'Completed'
  | 'Cancelled'
export type PaymentStatus = 'Pending' | 'Pending Verification' | 'Paid' | 'Failed' | 'Rejected' | 'Refunded'
export type PaymentMethod = 'opay_transfer' | 'cash_on_delivery'

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
  imageMedia?: Array<{ id: string; publicId: string; url: string; altText: string; displayOrder: number }>
  videoMedia?: Array<{ id: string; publicId: string; url: string; altText: string; displayOrder: number }>
  createdAt?: string
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
  imageUrl?: string
  quantity: number
  color?: string
  size?: string
}

export interface StoreOrder {
  id: string
  reference: string
  customerUserId?: string
  customer: CustomerDetails
  lines: Array<OrderLine & { name: string; unitPriceNGN: number }>
  subtotalNGN: number
  deliveryFeeNGN: number
  totalNGN: number
  discountNGN?: number
  status: OrderStatus
  paymentStatus: PaymentStatus
  paymentMethod?: PaymentMethod
  paymentReference?: string
  paymentConfirmationSubmittedAt?: string
  paymentConfirmedAt?: string
  paymentRejectedAt?: string
  paymentRejectionReason?: string
  paymentVerifiedBy?: string
  shippingCarrier?: string
  trackingNumber?: string
  shippingUpdatedAt?: string
  shippingUpdatedBy?: string
  shippingUpdatedById?: string
  statusHistory: Array<{ status: OrderStatus; at: string; changedBy: string }>
  paymentHistory: Array<{ status: PaymentStatus; at: string; changedBy: string }>
  createdAt: string
  updatedAt: string
  archivedAt?: string
  archivedBy?: string
  inventoryReleasedAt?: string
}

export interface AdminAccessEntry {
  email: string
  createdAt: string
}

export interface CustomerAddress {
  id: string
  recipientName: string
  phone: string
  country: string
  state: string
  city: string
  streetAddress: string
  additionalDirections: string
  postalCode: string
  isDefault: boolean
  createdAt: string
}

export type CustomerAddressInput = Omit<CustomerAddress, 'id' | 'isDefault' | 'createdAt'>

export interface CustomerWishlistEntry {
  id: string
  productId: string
  createdAt: string
}
