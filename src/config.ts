const env = import.meta.env

export const storeConfig = {
  name: env.VITE_STORE_NAME || 'Mamigloexclusive',
  announcement: env.VITE_ANNOUNCEMENT || 'Welcome to Mamigloexclusive — Elevate Your Style.',
  whatsappNumber: (env.VITE_WHATSAPP_NUMBER || '2348116098015').replace(/\D/g, ''),
  phone: env.VITE_BUSINESS_PHONE || '+2349155556750',
  email: env.VITE_BUSINESS_EMAIL || 'justmamiglo@gmail.com',
  instagram: env.VITE_INSTAGRAM_URL || 'https://instagram.com/mamigloexclusive',
  facebook: env.VITE_FACEBOOK_URL || 'https://facebook.com/mamigloexclusive',
  deliveryFeeNGN: Math.max(0, Number(env.VITE_DELIVERY_FEE_NGN) || 3000),
  siteUrl: env.VITE_SITE_URL || '',
}

export const formatNGN = (value: number) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(value)

export const whatsAppLink = (message: string) =>
  `https://wa.me/${storeConfig.whatsappNumber}?text=${encodeURIComponent(message)}`
