import type { Product } from './types.js'

export const demoProducts: Product[] = [
  {
    id: 'demo-classic-tie', sku: 'DEMO-TIE-001', name: 'The Regent Silk Tie',
    description: 'A considered classic for workdays, celebrations and everything between. Demo listing: replace this copy and image with approved product details.',
    category: 'Classic Ties', priceNGN: 18000, colors: ['Midnight', 'Champagne'],
    stockQuantity: 4, featured: true, available: true, imageUrl: '/images/product-placeholder.svg', demo: true,
  },
  {
    id: 'demo-wedding-bow', sku: 'DEMO-BOW-002', name: 'The Ceremony Bow Tie',
    description: 'An occasion-ready silhouette shown here as demo catalogue content. Confirm actual materials, colours and price before publishing.',
    category: 'Wedding Ties', priceNGN: 14500, colors: ['Black', 'Ivory'],
    stockQuantity: 2, featured: true, available: true, imageUrl: '/images/product-placeholder.svg', demo: true,
  },
  {
    id: 'demo-cufflinks', sku: 'DEMO-CUFF-003', name: 'The Onyx Cufflinks',
    description: 'A clean finishing detail for a tailored look. Demo listing only; product details and availability need confirmation.',
    category: 'Cufflinks', priceNGN: 22000, colors: ['Onyx', 'Silver'],
    stockQuantity: 3, featured: true, available: true, imageUrl: '/images/product-placeholder.svg', demo: true,
  },
  {
    id: 'demo-pocket-square', sku: 'DEMO-POCKET-004', name: 'The Ivory Pocket Square',
    description: 'A versatile accent for formal and relaxed tailoring. Demo catalogue content; replace the image and confirm the listing.',
    category: 'Pocket Squares', priceNGN: 9000, colors: ['Ivory', 'Burgundy'],
    stockQuantity: 5, featured: true, available: true, imageUrl: '/images/product-placeholder.svg', demo: true,
  },
  {
    id: 'demo-slim-tie', sku: 'DEMO-SLIM-005', name: 'The Modern Slim Tie',
    description: 'A contemporary profile, shown with demo product information for local development.',
    category: 'Slim Ties', priceNGN: 16000, colors: ['Black', 'Forest'],
    stockQuantity: 3, featured: false, available: true, imageUrl: '/images/product-placeholder.svg', demo: true,
  },
  {
    id: 'demo-boutonniere', sku: 'DEMO-FLOWER-006', name: 'The Lapel Flower',
    description: 'An understated event detail. Demo catalogue entry; verify product specification and stock before launch.',
    category: 'Flowers and Boutonnieres', priceNGN: 7500, colors: ['Ivory', 'Wine'],
    stockQuantity: 2, featured: false, available: true, imageUrl: '/images/product-placeholder.svg', demo: true,
  },
]
