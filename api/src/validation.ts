import { z } from 'zod'

export const categories = [
  'Classic Ties', 'Slim Ties', 'Skinny Ties', 'Premium and Silk Ties',
  'Patterned Ties', 'Plain Ties', 'Wedding Ties', 'Bow Ties', 'Self-Tie Bow Ties',
  'Cufflinks', 'Lapel Pins and Brooches', 'Pocket Squares', "Men's Socks",
  'Shirt Holders', 'Tie and Socks Combos', 'Flowers and Boutonnieres', 'Cummerbunds',
] as const

const requiredText = (max: number) => z.string().trim().min(1).max(max)

export const checkoutSchema = z.object({
  customer: z.object({
    fullName: requiredText(120),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{8,20}$/),
    email: z.union([z.literal(''), z.string().trim().email().max(254)]).optional(),
    address: requiredText(400),
    state: requiredText(100),
    city: requiredText(100),
    deliveryMethod: requiredText(100),
    instructions: z.string().trim().max(1000).optional(),
  }).strict(),
  items: z.array(z.object({
    productId: z.string().trim().min(1).max(100),
    quantity: z.number().int().min(1).max(20),
    color: z.string().trim().max(50).optional(),
    size: z.string().trim().max(50).optional(),
  }).strict()).min(1).max(30),
}).strict()

export const productSchema = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  sku: requiredText(64),
  name: requiredText(160),
  description: requiredText(3000),
  category: requiredText(80),
  priceNGN: z.number().int().nonnegative().max(100_000_000),
  salePriceNGN: z.number().int().nonnegative().max(100_000_000).optional(),
  colors: z.array(z.string().trim().min(1).max(50)).max(20),
  sizes: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  stockQuantity: z.number().int().min(0).max(1_000_000),
  featured: z.boolean(),
  available: z.boolean(),
  demo: z.boolean().optional(),
  imageUrl: z.string().trim().min(1).max(500).refine((value) =>
    value.startsWith('/') || URL.canParse(value) && new URL(value).protocol === 'https:',
  { message: 'Product photos must use a local path or secure HTTPS URL.' }),
}).strict().refine((product) => product.salePriceNGN === undefined || product.salePriceNGN <= product.priceNGN, {
  message: 'Sale price must not exceed the regular price.',
})

export const categorySchema = z.object({
  name: requiredText(80).refine((name) => !/[<>]/.test(name), 'Category name contains unsupported characters.'),
}).strict()

export const announcementSchema = z.object({
  announcement: requiredText(200),
}).strict()

export const contactSchema = z.object({
  name: requiredText(120),
  email: z.string().trim().email().max(254),
  message: requiredText(2000),
  website: z.string().max(300),
}).strict()

export const orderStatusSchema = z.object({
  status: z.enum(['Pending', 'Awaiting Payment', 'Paid', 'Processing', 'Shipped', 'Delivered', 'Cancelled']),
}).strict()
