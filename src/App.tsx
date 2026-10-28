import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, BriefcaseBusiness, Building2,
  Check, Clock3, Crown, ChevronDown, Flower2, Gem, Gift, Grid2X2, Menu, Minus, Pencil, Plus,
  Search, Shirt, ShoppingBag, Sparkles, Star, Truck, UserRound, X,
} from 'lucide-react'
import { ApiError, storeApi } from './api'
import { loadCart, saveCart, subtotal, type CartItem } from './cart'
import { formatNGN, storeConfig, whatsAppLink } from './config'
import { getAdminEligibility, supabase, supabaseConfigured } from './supabase'
import type { Category, CustomerAddressInput, CustomerDetails, PaymentMethod, Product, StoreOrder } from './types'
import { categories } from './types'
import { AdminDashboard } from './components/AdminDashboard'
import { CustomerAccount } from './components/CustomerAccount'
import { JournalArticleNotFound, JournalArticlePage, JournalHome } from './components/Journal'
import { HeroSlideshow } from './components/HeroSlideshow'
import { getPublishedJournalArticle, type JournalArticle } from './journal'
import { cloudinaryImageUrl, cloudinaryVideoUrl } from './cloudinary'

type Page = 'home' | 'shop' | 'product' | 'about' | 'contact' | 'journal' | 'journal-article' | 'checkout' | 'account' | 'login' | 'register' | 'admin' | 'admin-login' | 'delivery' | 'returns' | 'privacy' | 'terms' | 'notfound'

export function pageFromPath(path: string): Page {
  if (/^\/journal\/[^/]+\/?$/.test(path)) return 'journal-article'
  if (path === '/journal' || path === '/journal/') return 'journal'
  if (path.startsWith('/product/')) return 'product'
  if (path.startsWith('/shop')) return 'shop'
  if (path.startsWith('/about')) return 'about'
  if (path.startsWith('/contact')) return 'contact'
  if (path.startsWith('/checkout')) return 'checkout'
  if (path.startsWith('/register')) return 'register'
  if (path.startsWith('/login')) return 'login'
  if (path.startsWith('/account')) return 'account'
  if (path === '/admin/login' || path.startsWith('/admin/login/')) return 'admin-login'
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin'
  if (path === '/delivery') return 'delivery'
  if (path === '/returns') return 'returns'
  if (path === '/privacy') return 'privacy'
  if (path === '/terms') return 'terms'
  return path === '/' ? 'home' : 'notfound'
}

export function adminRedirectForState(
  currentPage: 'admin' | 'admin-login',
  authorizationState: 'loading' | 'guest' | 'customer' | 'admin' | 'error',
): 'admin' | 'admin-login' | null {
  if (authorizationState === 'guest' && currentPage === 'admin') return 'admin-login'
  if (authorizationState === 'admin' && currentPage === 'admin-login') return 'admin'
  return null
}

export function checkoutValidationError(customer: CustomerDetails, items: CartItem[]) {
  if (!customer.fullName || customer.fullName.length > 120) return 'Enter a name of 1 to 120 characters.'
  if (!/^\+?[0-9 ()-]{8,20}$/.test(customer.phone)) return 'Enter a phone number with 8 to 20 digits, spaces, or + ( ) - characters.'
  if (customer.email && (customer.email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email))) return 'Enter a valid email address or leave it blank.'
  if (!customer.address || customer.address.length > 400) return 'Enter a delivery address of 1 to 400 characters.'
  if (!customer.state || customer.state.length > 100) return 'Enter a state of 1 to 100 characters.'
  if (!customer.city || customer.city.length > 100) return 'Enter a city or town of 1 to 100 characters.'
  if (!customer.deliveryMethod || customer.deliveryMethod.length > 100) return 'Choose a valid delivery method.'
  if ((customer.instructions || '').length > 1000) return 'Keep delivery instructions to 1,000 characters or fewer.'
  if (items.length < 1 || items.length > 30) return 'An order can contain 1 to 30 item lines.'
  if (items.some((item) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.productId) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20)) {
    return 'Each item quantity must be between 1 and 20. Update your bag and try again.'
  }
  return ''
}

function idFromPath(path: string) {
  if (!path.startsWith('/product/')) return ''
  try { return decodeURIComponent(path.slice('/product/'.length)) } catch { return '' }
}

function journalSlugFromPath(path: string) {
  if (!path.startsWith('/journal/')) return ''
  try { return decodeURIComponent(path.slice('/journal/'.length).replace(/\/$/, '')) } catch { return '' }
}

function productImage(url: string, width = 1200) {
  return cloudinaryImageUrl(url, width)
}

function categoryIcon(name: string) {
  const value = name.toLowerCase()
  if (/wedding|flower|boutonniere/.test(value)) return Flower2
  if (/gift|combo/.test(value)) return Gift
  if (/cufflink|lapel|pocket|pin/.test(value)) return Gem
  if (/shirt|sock|belt|bag/.test(value)) return Shirt
  if (/tie|cummerbund/.test(value)) return BriefcaseBusiness
  return Crown
}

function App() {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname))
  const [journalSlug, setJournalSlug] = useState(() => journalSlugFromPath(window.location.pathname))
  const [journalArticle, setJournalArticle] = useState<JournalArticle | null>(null)
  const [journalArticleLoading, setJournalArticleLoading] = useState(false)
  const [journalArticleError, setJournalArticleError] = useState('')
  const [productId, setProductId] = useState(() => idFromPath(window.location.pathname))
  const [pageProduct, setPageProduct] = useState<Product | null>(null)
  const [productPageError, setProductPageError] = useState('')
  const [category, setCategory] = useState<Category | ''>(() => new URLSearchParams(location.search).get('category') as Category || '')
  const [products, setProducts] = useState<Product[]>([])
  const [categoryList, setCategoryList] = useState<string[]>([...categories])
  const [announcement, setAnnouncement] = useState(storeConfig.announcement)
  const [deliveryFeeNGN, setDeliveryFeeNGN] = useState(storeConfig.deliveryFeeNGN)
  const [demoMode, setDemoMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [cart, setCart] = useState<CartItem[]>(loadCart)
  const [cartOpen, setCartOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [order, setOrder] = useState<StoreOrder | null>(null)
  const [checkoutAddress, setCheckoutAddress] = useState<CustomerAddressInput | null>(null)
  const [checkoutError, setCheckoutError] = useState('')
  const [sort, setSort] = useState('featured')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')

  useEffect(() => {
    const handlePopState = () => {
      setPage(pageFromPath(location.pathname))
      setJournalSlug(journalSlugFromPath(location.pathname))
      setProductId(idFromPath(location.pathname))
      setCategory(new URLSearchParams(location.search).get('category') as Category || '')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (page !== 'journal-article' || !journalSlug) return
    if (journalArticle?.slug === journalSlug) return
    let active = true
    setJournalArticle(null)
    setJournalArticleError('')
    setJournalArticleLoading(true)
    getPublishedJournalArticle(journalSlug)
      .then((article) => { if (active) setJournalArticle(article) })
      .catch((reason: unknown) => { if (active) setJournalArticleError(reason instanceof Error ? reason.message : 'This journal story could not be loaded.') })
      .finally(() => { if (active) setJournalArticleLoading(false) })
    return () => { active = false }
  }, [journalArticle, journalSlug, page])

  useEffect(() => {
    storeApi.categories()
      .then(({ categories: result }) => setCategoryList(result))
      .catch(() => setCategoryList([...categories]))
    storeApi.storeConfig()
      .then(({ announcement: value, deliveryFeeNGN: fee }) => {
        setAnnouncement(value)
        setDeliveryFeeNGN(fee)
      })
      .catch(() => setAnnouncement(storeConfig.announcement))
  }, [])

  useEffect(() => {
    let active = true
    storeApi.products()
      .then(({ products: result, demoMode: isDemo }) => {
        if (active) {
          setProducts(result)
          setDemoMode(isDemo || result.some((product) => product.demo))
          setLoadError('')
        }
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Could not load the catalogue.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => { saveCart(cart) }, [cart])

  useEffect(() => {
    if (page !== 'product' || !productId) return
    const cached = products.find((product) => product.id === productId)
    if (cached) {
      setPageProduct(cached)
      setProductPageError('')
      return
    }
    let active = true
    setPageProduct(null)
    storeApi.product(productId)
      .then(({ product }) => { if (active) setPageProduct(product) })
      .catch((reason: unknown) => {
        if (active) setProductPageError(reason instanceof Error ? reason.message : 'This product is unavailable.')
      })
    return () => { active = false }
  }, [page, productId, products])

  useEffect(() => {
    const titles: Record<Page, string> = {
      home: "Men's Accessories, Considered",
      shop: category ? `${category} | Mamigloexclusive` : "Shop Men's Accessories | Mamigloexclusive",
      product: pageProduct ? `${pageProduct.name} | Mamigloexclusive` : 'Product | Mamigloexclusive',
      about: 'About Us | Mamigloexclusive',
      contact: 'Contact | Mamigloexclusive',
      journal: 'The Mamigloexclusive Journal | Mamigloexclusive',
      'journal-article': journalArticle?.seoTitle || (journalArticle ? `${journalArticle.title} | The Mamigloexclusive Journal` : 'Journal Story | Mamigloexclusive'),
      checkout: 'Checkout | Mamigloexclusive',
      account: 'Your Account | Mamigloexclusive',
      login: 'Customer Sign In | Mamigloexclusive',
      register: 'Create Your Account | Mamigloexclusive',
      admin: 'Store Admin | Mamigloexclusive',
      'admin-login': 'Administrator Sign In | Mamigloexclusive',
      delivery: 'Delivery Information | Mamigloexclusive',
      returns: 'Returns | Mamigloexclusive',
      privacy: 'Privacy | Mamigloexclusive',
      terms: 'Terms | Mamigloexclusive',
      notfound: 'Page Not Found | Mamigloexclusive',
    }
    document.title = `${titles[page]}${page === 'home' ? ' — Mamigloexclusive' : ''}`
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (description) {
      description.content = page === 'product' && pageProduct
        ? `${pageProduct.description.slice(0, 145)} Shop ${pageProduct.name} at Mamigloexclusive.`
        : page === 'journal-article' && journalArticle
        ? journalArticle.seoDescription || journalArticle.excerpt
        : page === 'journal'
        ? 'Style, confidence and the art of the finishing touch. Discover practical styling advice and thoughtful guides from Mamigloexclusive.'
        : page === 'shop' && category
        ? `Explore ${category.toLowerCase()} and men's fashion accessories at Mamigloexclusive in Nigeria.`
        : "Discover men's ties, bow ties, cufflinks and considered accessories at Mamigloexclusive. Shop men's fashion accessories in Nigeria."
    }
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    const canonicalUrl = storeConfig.siteUrl ? new URL(location.pathname, storeConfig.siteUrl).toString() : ''
    if (canonicalUrl) {
      const link = canonical || document.createElement('link')
      link.rel = 'canonical'
      link.href = canonicalUrl
      if (!canonical) document.head.appendChild(link)
    } else {
      canonical?.remove()
    }
    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]') || document.createElement('meta')
    robots.name = 'robots'
    robots.content = page === 'admin' || page === 'admin-login' || page === 'notfound' || page === 'product' && Boolean(productPageError) || page === 'journal-article' && (!journalArticle || Boolean(journalArticleError))
      ? 'noindex, nofollow'
      : 'index, follow'
    if (!robots.isConnected) document.head.appendChild(robots)
    const openGraphTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')
    if (openGraphTitle) openGraphTitle.content = document.title
    const openGraphDescription = document.querySelector<HTMLMetaElement>('meta[property="og:description"]')
    if (openGraphDescription && description) openGraphDescription.content = description.content
    const openGraphUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]')
    if (openGraphUrl) {
      if (canonicalUrl) openGraphUrl.content = canonicalUrl
      else openGraphUrl.removeAttribute('content')
    }
    const openGraphImage = document.querySelector<HTMLMetaElement>('meta[property="og:image"]')
    if (openGraphImage) {
      if (page === 'product' && pageProduct) {
        openGraphImage.content = new URL(productImage(pageProduct.imageUrl), storeConfig.siteUrl || location.origin).toString()
      } else if (page === 'journal-article' && journalArticle) {
        openGraphImage.content = new URL(journalArticle.coverImageUrl, storeConfig.siteUrl || location.origin).toString()
      } else {
        openGraphImage.removeAttribute('content')
      }
    }
    const openGraphType = document.querySelector<HTMLMetaElement>('meta[property="og:type"]')
    if (openGraphType) openGraphType.content = page === 'journal-article' ? 'article' : 'website'
  }, [category, journalArticle, page, pageProduct, productPageError])

  useEffect(() => {
    if (page !== 'product' || !pageProduct) return
    const url = `${location.origin}/product/${encodeURIComponent(pageProduct.id)}`
    const structuredData = document.createElement('script')
    structuredData.type = 'application/ld+json'
    structuredData.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: pageProduct.name,
      description: pageProduct.description,
      sku: pageProduct.sku,
      category: pageProduct.category,
      image: productImage(pageProduct.imageUrl),
      offers: {
        '@type': 'Offer',
        priceCurrency: 'NGN',
        price: pageProduct.salePriceNGN ?? pageProduct.priceNGN,
        availability: pageProduct.available && pageProduct.stockQuantity > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
        url,
      },
    })
    document.head.appendChild(structuredData)
    return () => structuredData.remove()
  }, [page, pageProduct])

  useEffect(() => {
    if (page !== 'journal-article' || !journalArticle) return
    const canonicalUrl = storeConfig.siteUrl
      ? new URL(`/journal/${encodeURIComponent(journalArticle.slug)}`, storeConfig.siteUrl).toString()
      : new URL(`/journal/${encodeURIComponent(journalArticle.slug)}`, location.origin).toString()
    const structuredData = document.createElement('script')
    structuredData.type = 'application/ld+json'
    structuredData.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: journalArticle.title,
      description: journalArticle.seoDescription || journalArticle.excerpt,
      image: new URL(journalArticle.coverImageUrl, storeConfig.siteUrl || location.origin).toString(),
      datePublished: journalArticle.publishedAt,
      dateModified: journalArticle.updatedAt,
      author: { '@type': 'Organization', name: journalArticle.author },
      publisher: { '@type': 'Organization', name: storeConfig.name },
      mainEntityOfPage: canonicalUrl,
    }).replace(/</g, '\\u003c')
    document.head.appendChild(structuredData)
    return () => structuredData.remove()
  }, [journalArticle, page])

  function navigate(next: Page, nextCategory: Category | '' = '', replace = false) {
    const path = next === 'home' ? '/' : next === 'admin-login' ? '/admin/login' : `/${next}`
    const query = next === 'shop' && nextCategory ? `?category=${encodeURIComponent(nextCategory)}` : ''
    if (replace) history.replaceState({}, '', `${path}${query}`)
    else history.pushState({}, '', `${path}${query}`)
    closeMegaMenu(true)
    setPage(next)
    setJournalSlug('')
    setJournalArticle(null)
    setCategory(nextCategory)
    setProductId('')
    setPageProduct(null)
    setMobileMenuOpen(false)
    setCartOpen(false)
    setOrder(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function openJournalArticle(article: JournalArticle) {
    history.pushState({}, '', `/journal/${encodeURIComponent(article.slug)}`)
    setPage('journal-article')
    setJournalSlug(article.slug)
    setJournalArticle(article)
    setMobileMenuOpen(false)
    setCartOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function openProduct(product: Product) {
    history.pushState({}, '', `/product/${encodeURIComponent(product.id)}`)
    closeMegaMenu(true)
    setPage('product')
    setProductId(product.id)
    setPageProduct(product)
    setCategory('')
    setMobileMenuOpen(false)
    setCartOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function navigateHero(path: string) {
    const destination = new URL(path, location.origin)
    if (destination.origin !== location.origin) return
    const nextPage = pageFromPath(destination.pathname)
    if (nextPage === 'shop') {
      const requestedCategory = destination.searchParams.get('category') || ''
      navigate('shop', categoryList.includes(requestedCategory) ? requestedCategory : '')
    } else if (['home', 'about', 'contact', 'journal'].includes(nextPage)) {
      navigate(nextPage)
    }
  }

  function addToCart(product: Product, quantity = 1, color?: string, size?: string) {
    if (!product.available || product.stockQuantity <= 0) return
    setCart((items) => {
      const match = items.find((item) => item.productId === product.id && item.color === color && item.size === size)
      if (match) {
        return items.map((item) => item === match
            ? { ...item, quantity: Math.min(product.stockQuantity, 20, item.quantity + quantity) }
          : item)
      }
          return [...items, { productId: product.id, quantity: Math.min(quantity, product.stockQuantity, 20), color, size }]
    })
    setCartOpen(true)
  }

  function updateQuantity(item: CartItem, quantity: number) {
    setCart((items) => quantity <= 0
      ? items.filter((entry) => entry !== item)
      : items.map((entry) => entry === item
        ? { ...entry, quantity: Math.min(quantity, 20, products.find((product) => product.id === entry.productId)?.stockQuantity || 0) }
        : entry))
  }

  const visibleProducts = useMemo(() => {
    const normalized = searchText.trim().toLowerCase()
    let found = products.filter((product) =>
      (!category || product.category === category) &&
      (!normalized || `${product.name} ${product.description} ${product.category}`.toLowerCase().includes(normalized)) &&
      (minPrice === '' || (product.salePriceNGN ?? product.priceNGN) >= Number(minPrice)) &&
      (maxPrice === '' || (product.salePriceNGN ?? product.priceNGN) <= Number(maxPrice)),
    )
    found = [...found].sort((a, b) => {
      const aPrice = a.salePriceNGN ?? a.priceNGN
      const bPrice = b.salePriceNGN ?? b.priceNGN
      if (sort === 'price-low') return aPrice - bPrice
      if (sort === 'price-high') return bPrice - aPrice
      if (sort === 'newest') return (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0)
      return Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name)
    })
    return found
  }, [category, maxPrice, minPrice, products, searchText, sort])

  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const announcementMessages = ['Discover the art of refined style.', 'Complete your look with Mamigloexclusive.', 'Explore accessories for weddings and special occasions.']
  const [announcementIndex, setAnnouncementIndex] = useState(0)
  const [announcementRotationEnabled, setAnnouncementRotationEnabled] = useState(true)
  const [headerScrolled, setHeaderScrolled] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [megaMenu, setMegaMenu] = useState<'shop' | null>(null)
  const [megaMenuClosing, setMegaMenuClosing] = useState(false)
  const megaMenuTimer = useRef<number | null>(null)
  const megaMenuExitTimer = useRef<number | null>(null)
  const [mobileCategoryOpen, setMobileCategoryOpen] = useState<Record<string, boolean>>({})

  function closeMegaMenu(immediate = false) {
    if (megaMenuTimer.current !== null) window.clearTimeout(megaMenuTimer.current)
    megaMenuTimer.current = null
    if (megaMenuExitTimer.current !== null) window.clearTimeout(megaMenuExitTimer.current)
    megaMenuExitTimer.current = null
    if (!megaMenu) return
    if (immediate) {
      setMegaMenu(null)
      setMegaMenuClosing(false)
      return
    }
    setMegaMenuClosing(true)
    megaMenuExitTimer.current = window.setTimeout(() => {
      megaMenuExitTimer.current = null
      setMegaMenu(null)
      setMegaMenuClosing(false)
    }, 180)
  }

  function openMegaMenu(menu: 'shop') {
    if (megaMenuTimer.current !== null) window.clearTimeout(megaMenuTimer.current)
    megaMenuTimer.current = null
    if (megaMenuExitTimer.current !== null) window.clearTimeout(megaMenuExitTimer.current)
    megaMenuExitTimer.current = null
    setMegaMenuClosing(false)
    setMegaMenu(menu)
  }

  function scheduleMegaMenuClose() {
    if (megaMenuTimer.current !== null) window.clearTimeout(megaMenuTimer.current)
    megaMenuTimer.current = window.setTimeout(() => {
      megaMenuTimer.current = null
      closeMegaMenu()
    }, 150)
  }

  function toggleMegaMenu(menu: 'shop') {
    if (megaMenu === menu) closeMegaMenu()
    else openMegaMenu(menu)
  }

  useEffect(() => {
    const onScroll = () => setHeaderScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!announcementRotationEnabled) return
    const interval = window.setInterval(() => setAnnouncementIndex((current) => (current + 1) % announcementMessages.length), 5000)
    return () => window.clearInterval(interval)
  }, [announcementRotationEnabled])

  useEffect(() => {
    if (!mobileMenuOpen) {
      document.body.style.overflow = ''
      return
    }
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileMenuOpen])

  useEffect(() => {
    if (!searchOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [searchOpen])

  useEffect(() => {
    if (!megaMenu) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      closeMegaMenu()
      document.getElementById(`${megaMenu}-menu-toggle`)?.focus()
    }
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (event.target instanceof Element && event.target.closest('.nav-item-with-menu')) return
      if (document.querySelector('.nav-mega-menu')?.contains(event.target)) return
      closeMegaMenu()
    }
    window.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOnOutsideClick)
    }
  }, [megaMenu])

  const navMenuGroups = useMemo(() => {
    const availableCategories = categoryList.length ? categoryList : [...categories]
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
    const definitions = [
      { heading: 'Ties & Neckwear', links: [
        ['Classic Neckties', 'Classic Ties'], ['Slim Ties', 'Slim Ties'], ['Skinny Ties', 'Skinny Ties'],
        ['Silk & Premium Ties', 'Premium and Silk Ties'], ['Plain Ties', 'Plain Ties'], ['Patterned Ties', 'Patterned Ties'], ['Wedding Ties', 'Wedding Ties'],
      ] },
      { heading: 'Bow Ties', links: [['Classic Bow Ties', 'Bow Ties'], ['Self-Tie Bow Ties', 'Self-Tie Bow Ties']] },
      { heading: 'The Finishing Touch', links: [
        ['Cufflinks', 'Cufflinks'], ['Pocket Squares', 'Pocket Squares'], ['Lapel Pins & Brooches', 'Lapel Pins and Brooches'],
        ['Boutonnieres', 'Flowers and Boutonnieres'], ['Shirt Stays', 'Shirt Holders'],
      ] },
      { heading: "Gentleman's Essentials", links: [
        ['Socks', "Men's Socks"], ['Belts', 'Belts'], ['Watches', 'Wristwatches'], ['Tie & Socks Combos', 'Tie and socks combo'], ['Gift Sets', 'Gift Sets'], ['Cummerbunds', 'Cummerbunds'],
      ] },
      { heading: 'More to Explore', links: [['Bags', 'Bags'], ['Shirts', 'Shirt'], ['Shoes', 'Shoes']] },
    ]
    const assigned = new Set<string>()
    const groups = definitions.map(({ heading, links }) => ({
      heading,
      links: links.flatMap(([label, categoryName]) => {
        const actualCategory = availableCategories.find((entry) => normalize(entry) === normalize(categoryName))
        if (!actualCategory) return []
        assigned.add(normalize(actualCategory))
        return [{ label, category: actualCategory }]
      }),
    }))
    const additionalCategories = availableCategories
      .filter((entry) => !assigned.has(normalize(entry)))
      .map((entry) => ({ label: entry, category: entry }))
    if (additionalCategories.length) {
      const moreGroup = groups.find((group) => group.heading === 'More to Explore')
      if (moreGroup) moreGroup.links.push(...additionalCategories)
      else groups.push({ heading: 'More to Explore', links: additionalCategories })
    }
    return groups.filter((group) => group.links.length > 0)
  }, [categoryList])

  const featuredMenuProduct = products.find((product) => product.available && product.stockQuantity > 0 && /tie|bow/i.test(`${product.name} ${product.category}`) && product.imageUrl && !product.imageUrl.includes('product-placeholder'))
    || products.find((product) => product.available && product.stockQuantity > 0 && product.imageUrl && !product.imageUrl.includes('product-placeholder'))

  const searchSuggestions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const productMatches = !query
      ? products.slice(0, 5)
      : products.filter((product) => `${product.name} ${product.description} ${product.category}`.toLowerCase().includes(query)).slice(0, 5)
    const categoryMatches = !query
      ? categoryList.slice(0, 4)
      : categoryList.filter((name) => name.toLowerCase().includes(query)).slice(0, 4)
    return { productMatches, categoryMatches }
  }, [categoryList, products, searchQuery])

  function beginCheckout() {
    if (!cart.length) return
    setCartOpen(false)
    setOrder(null)
    navigate('checkout')
  }

  async function submitCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCheckoutError('')
    const form = new FormData(event.currentTarget)
    const customer: CustomerDetails = {
      fullName: String(form.get('fullName') || '').trim(),
      phone: String(form.get('phone') || '').trim(),
      email: String(form.get('email') || '').trim(),
      address: String(form.get('address') || '').trim(),
      state: String(form.get('state') || '').trim(),
      city: String(form.get('city') || '').trim(),
      deliveryMethod: String(form.get('deliveryMethod') || '').trim(),
      instructions: String(form.get('instructions') || '').trim(),
    }
    const validationError = checkoutValidationError(customer, cart)
    if (validationError) {
      setCheckoutError(validationError)
      return
    }
    const paymentMethod = String(form.get('paymentMethod') || '') as PaymentMethod
    if (paymentMethod !== 'opay_transfer' && paymentMethod !== 'cash_on_delivery') {
      setCheckoutError('Choose a payment method to continue.')
      return
    }
    try {
      const { order: newOrder } = await storeApi.createOrder(customer, cart, paymentMethod)
      setOrder(newOrder)
      setCart([])
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      setCheckoutError(error instanceof ApiError
        ? error.message
        : 'We could not submit your order. Please try again.')
    }
  }

  function orderWhatsAppMessage(orderToSend: StoreOrder) {
    const productLines = orderToSend.lines.map((line) =>
      `• ${line.name}${line.color ? ` (${line.color})` : ''}${line.size ? ` / ${line.size}` : ''} × ${line.quantity} — ${formatNGN(line.unitPriceNGN * line.quantity)}`,
    )
    return [
      `Hello ${storeConfig.name}, I would like to complete order ${orderToSend.reference}.`,
      '',
      ...productLines,
      '',
      `Subtotal: ${formatNGN(orderToSend.subtotalNGN)}`,
      `Delivery: ${formatNGN(orderToSend.deliveryFeeNGN)}`,
      `Total: ${formatNGN(orderToSend.totalNGN)}`,
      `Payment method: ${orderToSend.paymentMethod === 'cash_on_delivery' ? 'Cash on delivery' : 'OPay transfer'}`,
      '',
      `Name: ${orderToSend.customer.fullName}`,
      `Phone: ${orderToSend.customer.phone}`,
      orderToSend.customer.email ? `Email: ${orderToSend.customer.email}` : '',
      `Address: ${orderToSend.customer.address}, ${orderToSend.customer.city}, ${orderToSend.customer.state}`,
      `Delivery method: ${orderToSend.customer.deliveryMethod}`,
      orderToSend.customer.instructions ? `Instructions: ${orderToSend.customer.instructions}` : '',
      '',
      'I understand this order is pending until the business confirms it. I will send this WhatsApp message to continue.',
    ].filter(Boolean).join('\n')
  }

  function renderMegaMenu(menu: 'shop') {
    return <div id="shop-mega-menu" className={`nav-mega-menu ${megaMenuClosing ? 'is-closing' : 'is-open'}`} role="region" aria-label="The Collection categories" aria-hidden={megaMenuClosing} onMouseEnter={() => openMegaMenu(menu)} onMouseLeave={scheduleMegaMenuClose} onBlur={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) scheduleMegaMenuClose() }}>
      <div className={`mega-menu-columns ${featuredMenuProduct ? 'has-featured' : ''}`}>
        {navMenuGroups.map((group) => <section className="mega-menu-column" key={group.heading}>
          <h2 className="mega-menu-label">{group.heading}</h2>
          <div className="mega-menu-list">{group.links.map((entry) => <button key={`${group.heading}-${entry.category}`} type="button" onClick={() => { closeMegaMenu(); navigate('shop', entry.category) }}>{entry.label}</button>)}</div>
        </section>)}
        {featuredMenuProduct && <section className="mega-menu-featured-panel" aria-label="Featured in the collection">
          <button type="button" className="mega-menu-feature-image" onClick={() => { closeMegaMenu(); openProduct(featuredMenuProduct) }} aria-label={`View ${featuredMenuProduct.name}`}>
            <img src={featuredMenuProduct.imageUrl} alt={featuredMenuProduct.name} />
          </button>
          <span className="mega-menu-label">A considered detail</span>
          <h2>{featuredMenuProduct.name}</h2>
          <p>Explore this piece from the current collection.</p>
          <button type="button" className="mega-menu-feature-link" onClick={() => { closeMegaMenu(); navigate('shop', featuredMenuProduct.category) }}>Explore Collection <ArrowRight size={13} /></button>
        </section>}
      </div>
    </div>
  }

  return (
    <div className={`site-shell ${page === 'home' ? 'is-home' : ''}`}>
      {demoMode && <div className="demo-notice"><span>DEMO CATALOGUE</span> Example products, prices, photos and stock — replace and verify before accepting real orders.</div>}
      <div className="announcement-bar" role="status" aria-live="polite">
        <span>{announcementRotationEnabled ? announcementMessages[announcementIndex] : (announcement || announcementMessages[0])}</span>
        <button type="button" className="announcement-toggle" aria-label={announcementRotationEnabled ? 'Pause announcement rotation' : 'Resume announcement rotation'} onClick={() => setAnnouncementRotationEnabled((value) => !value)}>{announcementRotationEnabled ? 'Pause' : 'Resume'}</button>
      </div>
      {loadError && <div className="error-notice global-store-error" role="alert">{loadError}</div>}
      <header className={`site-header ${headerScrolled ? 'is-scrolled' : ''}`}>
        <button className="brand-mark" onClick={() => navigate('home')} aria-label="Mamigloexclusive home">
          <img className="brand-logo" src="/images/logo.png" alt="" /><span className="brand-name">MAMIGLO<span>EXCLUSIVE</span></span>
        </button>
        <div className="header-centre">
          <nav className={`main-nav ${mobileMenuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
            <button className={page === 'home' ? 'active' : ''} onClick={() => navigate('home')}>Home</button>
            <div className={`nav-item-with-menu ${megaMenu === 'shop' ? 'is-open' : ''}`} onMouseEnter={() => openMegaMenu('shop')} onMouseLeave={scheduleMegaMenuClose}>
              <button className={page === 'shop' ? 'active' : ''} onClick={() => navigate('shop')}>The Collection</button>
              <button id="shop-menu-toggle" type="button" className="nav-menu-toggle" aria-label={megaMenu === 'shop' ? 'Close The Collection menu' : 'Open The Collection menu'} aria-haspopup="true" aria-expanded={megaMenu === 'shop'} aria-controls={megaMenu === 'shop' ? 'shop-mega-menu' : undefined} onClick={() => toggleMegaMenu('shop')}><ChevronDown size={12} /></button>
            </div>
            <button className={page === 'shop' && category === 'Wedding Ties' ? 'active' : ''} onClick={() => navigate('shop', 'Wedding Ties')}>Wedding Edit</button>
            <button className={page === 'journal' || page === 'journal-article' ? 'active' : ''} onClick={() => navigate('journal')}>The Journal</button>
            <button className={page === 'about' ? 'active' : ''} onClick={() => navigate('about')}>Our Story</button>
            <button className={page === 'contact' ? 'active' : ''} onClick={() => navigate('contact')}>Get in Touch</button>
            <a className="nav-whatsapp" href={whatsAppLink(`Hello ${storeConfig.name}, I have an enquiry.`)} target="_blank" rel="noreferrer" aria-label="Chat with Mamigloexclusive on WhatsApp">
              <svg className="nav-whatsapp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.875 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.999-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64.001 5.122 1.03 6.985 2.894a9.825 9.825 0 0 1 2.89 6.99c-.003 5.45-4.437 9.884-9.88 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.946L.057 24l6.304-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.482-8.413Z" /></svg>
              <span className="nav-whatsapp-label">WhatsApp</span>
            </a>
          </nav>
        </div>
        <div className="header-actions">
          <button className="icon-button" aria-label="Search" title="Search" onClick={() => setSearchOpen(true)}><Search size={21} /></button>
          <button className="icon-button" aria-label="My account" title="My account" onClick={() => navigate('account')}><UserRound size={21} /></button>
          <button className="cart-button" aria-label={`Shopping bag, ${itemCount} items`} onClick={() => setCartOpen(true)}>
            <ShoppingBag size={18} /><span>Bag</span>{itemCount > 0 && <b>{itemCount}</b>}
          </button>
        </div>
        <button className="mobile-menu-button" aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? <X /> : <Menu />}
        </button>
      </header>
      {megaMenu && renderMegaMenu(megaMenu)}
      {mobileMenuOpen && <div className="mobile-nav-panel" aria-label="Mobile navigation">
        <nav className="mobile-nav-menu" aria-label="Mobile navigation menu">
          <button className={page === 'home' ? 'active' : ''} onClick={() => navigate('home')}>Home</button>
          <button className={page === 'shop' ? 'active' : ''} onClick={() => navigate('shop')}>The Collection</button>
          {navMenuGroups.map((group) => <div className="mobile-nav-group" key={group.heading}>
            <button type="button" className="mobile-nav-header" aria-expanded={Boolean(mobileCategoryOpen[group.heading])} onClick={() => setMobileCategoryOpen((current) => ({ ...current, [group.heading]: !current[group.heading] }))}>{group.heading}<span>{mobileCategoryOpen[group.heading] ? '−' : '+'}</span></button>
            {mobileCategoryOpen[group.heading] && <div className="mobile-nav-list">{group.links.map((entry) => <button key={`${group.heading}-${entry.category}`} type="button" onClick={() => { navigate('shop', entry.category); setMobileMenuOpen(false) }}>{entry.label}</button>)}</div>}
          </div>)}
          <button className={page === 'shop' && category === 'Wedding Ties' ? 'active' : ''} onClick={() => navigate('shop', 'Wedding Ties')}>Wedding Edit</button>
          <button className={page === 'journal' || page === 'journal-article' ? 'active' : ''} onClick={() => navigate('journal')}>The Journal</button>
          <button className={page === 'about' ? 'active' : ''} onClick={() => navigate('about')}>Our Story</button>
          <button className={page === 'contact' ? 'active' : ''} onClick={() => navigate('contact')}>Get in Touch</button>
          <button type="button" className="mobile-nav-account" onClick={() => navigate('account')}>My account</button>
          <a className="nav-whatsapp" href={whatsAppLink(`Hello ${storeConfig.name}, I have an enquiry.`)} target="_blank" rel="noreferrer" aria-label="Chat with Mamigloexclusive on WhatsApp">
            <svg className="nav-whatsapp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.875 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.999-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64.001 5.122 1.03 6.985 2.894a9.825 9.825 0 0 1 2.89 6.99c-.003 5.45-4.437 9.884-9.88 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.946L.057 24l6.304-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.482-8.413Z" /></svg>
            <span className="nav-whatsapp-label">WhatsApp</span>
          </a>
        </nav>
      </div>}
      {searchOpen && <div className="search-overlay" role="dialog" aria-modal="true" aria-label="Search products" onClick={() => setSearchOpen(false)}>
        <div className="search-panel" onClick={(event) => event.stopPropagation()}>
          <div className="search-header">
            <div className="search-input-wrap">
              <Search size={16} />
              <input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search the collection" aria-label="Search products" />
            </div>
            <button type="button" className="icon-button" aria-label="Close search" onClick={() => setSearchOpen(false)}><X size={18} /></button>
          </div>
          <div className="search-results">
            {searchSuggestions.categoryMatches.length > 0 && <div className="search-section"><span className="search-label">Categories</span>{searchSuggestions.categoryMatches.map((name) => <button key={name} type="button" className="search-result-link" onClick={() => { setSearchText(name); setSearchOpen(false); navigate('shop', name) }}>{name}</button>)}</div>}
            {searchSuggestions.productMatches.length > 0 ? <div className="search-section"><span className="search-label">Products</span>{searchSuggestions.productMatches.map((product) => <button key={product.id} type="button" className="search-product" onClick={() => { setSearchOpen(false); openProduct(product) }}>
              <img src={product.imageUrl} alt={product.name} />
              <span>
                <strong>{product.name}</strong>
                <small>{product.category}</small>
              </span>
              <b>{formatNGN(product.salePriceNGN ?? product.priceNGN)}</b>
            </button>)}</div> : <div className="search-empty">No matching products found. Try another keyword or browse the full collection.</div>}
            <button type="button" className="search-view-all" onClick={() => { setSearchText(searchQuery); setSearchOpen(false); navigate('shop') }}>View all results</button>
          </div>
        </div>
      </div>}

      {page === 'home' && <HomePage products={products} categories={categoryList} loading={loading} onShop={() => navigate('shop')} onCategory={(value) => navigate('shop', value)} onDetails={openProduct} onAdd={addToCart} onNavigate={navigateHero} />}
      {page === 'journal' && <JournalHome onArticle={openJournalArticle} />}
      {page === 'journal-article' && (journalArticleLoading
        ? <main className="journal-loading" role="status">Loading this story…</main>
        : journalArticleError
        ? <main className="journal-empty journal-not-found" role="alert"><p className="eyebrow">THE JOURNAL</p><h1>This story could not be loaded.</h1><p>{journalArticleError}</p><button className="journal-read-link" type="button" onClick={() => navigate('journal')}>Return to The Journal <ArrowRight size={14} /></button></main>
        : journalArticle
        ? <JournalArticlePage article={journalArticle} products={products} onBack={() => navigate('journal')} onArticle={openJournalArticle} onProduct={openProduct} />
        : <JournalArticleNotFound onBack={() => navigate('journal')} />)}
      {page === 'shop' && (
        <main className="content-page shop-page">
          <div className="page-intro"><p className="eyebrow">THE COLLECTION</p><h1>Made for the moments that matter.</h1><p>Considered finishing touches for work, celebration and every occasion in between.</p></div>
          {loadError && <ErrorNotice message={loadError} />}
          <div className="shop-controls">
            <label className="search-field"><Search size={17} /><input id="shop-search" placeholder="Search the collection" value={searchText} onChange={(event) => setSearchText(event.target.value)} /></label>
            <label className="select-field"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Featured</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="newest">Name</option></select></label>
          </div>
          <div className="filter-row">
            <label className="category-select"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categoryList.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="price-filter"><span>From ₦</span><input inputMode="numeric" type="number" min="0" placeholder="0" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} /></label>
            <label className="price-filter"><span>To ₦</span><input inputMode="numeric" type="number" min="0" placeholder="Any" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} /></label>
            <button className="text-button" onClick={() => { setCategory(''); setSearchText(''); setMinPrice(''); setMaxPrice(''); setSort('featured') }}>Clear filters</button>
          </div>
          <div className="result-line">{visibleProducts.length} {visibleProducts.length === 1 ? 'piece' : 'pieces'}{category ? ` in ${category}` : ' in the collection'}</div>
          {loading ? <Loading /> : <ProductGrid products={visibleProducts} onDetails={openProduct} onAdd={addToCart} />}
          {!loading && visibleProducts.length === 0 && !loadError && <EmptyState title="Nothing here just yet." text="Try another category or clear your filters." />}
        </main>
      )}
      {page === 'product' && (pageProduct
        ? <ProductDetailPage key={pageProduct.id} product={pageProduct} onBack={() => navigate('shop', pageProduct.category)} onAdd={addToCart} />
        : productPageError ? <NotFoundPage onHome={() => navigate('home')} /> : <main className="content-page"><Loading /></main>)}
      {page === 'about' && <AboutPage />}
      {page === 'contact' && <ContactPage />}
      {['delivery', 'returns', 'privacy', 'terms'].includes(page) && <PolicyPage kind={page as 'delivery' | 'returns' | 'privacy' | 'terms'} />}
      {page === 'notfound' && <NotFoundPage onHome={() => navigate('home')} />}
      {page === 'checkout' && <main className="content-page checkout-page">
        {!order ? <CheckoutForm cart={cart} products={products} deliveryFeeNGN={deliveryFeeNGN} error={checkoutError} initialAddress={checkoutAddress} onSubmit={submitCheckout} onBack={() => navigate('shop')} /> : (
          <OrderPending order={order} message={orderWhatsAppMessage(order)} onShop={() => navigate('shop')} />
        )}
      </main>}
      {page === 'login' && <CustomerAccount initialMode="sign-in" products={products} cartItemCount={itemCount} onAddToCart={addToCart} onOpenProduct={openProduct} onUseAddress={(address) => { setCheckoutAddress(address); navigate('checkout') }} onOpenCart={() => setCartOpen(true)} onNavigate={(target) => {
        if (target === 'register') navigate('register')
        if (target === 'home') navigate('home')
        if (target === 'shop') navigate('shop')
        if (target === 'checkout') navigate('checkout')
        if (target === 'contact') navigate('contact')
        if (target === 'returns') navigate('returns')
        if (target === 'account') navigate('account')
      }} />}
      {page === 'register' && <CustomerAccount initialMode="sign-up" products={products} cartItemCount={itemCount} onAddToCart={addToCart} onOpenProduct={openProduct} onUseAddress={(address) => { setCheckoutAddress(address); navigate('checkout') }} onOpenCart={() => setCartOpen(true)} onNavigate={(target) => {
        if (target === 'login') navigate('login')
        if (target === 'home') navigate('home')
        if (target === 'shop') navigate('shop')
        if (target === 'checkout') navigate('checkout')
        if (target === 'contact') navigate('contact')
        if (target === 'returns') navigate('returns')
        if (target === 'account') navigate('account')
      }} />}
      {page === 'account' && <CustomerAccount products={products} cartItemCount={itemCount} onAddToCart={addToCart} onOpenProduct={openProduct} onUseAddress={(address) => { setCheckoutAddress(address); navigate('checkout') }} onOpenCart={() => setCartOpen(true)} onNavigate={(target) => {
        if (target === 'login') navigate('login')
        if (target === 'register') navigate('register')
        if (target === 'home') navigate('home')
        if (target === 'shop') navigate('shop')
        if (target === 'checkout') navigate('checkout')
        if (target === 'contact') navigate('contact')
        if (target === 'returns') navigate('returns')
      }} />}
      {(page === 'admin' || page === 'admin-login') && <AdminRoute currentPage={page} onNavigate={navigate} />}
      <Footer navigate={navigate} />
      {cartOpen && <CartDrawer cart={cart} products={products} deliveryFeeNGN={deliveryFeeNGN} onClose={() => setCartOpen(false)} onUpdate={updateQuantity} onRemove={(item) => updateQuantity(item, 0)} onContinue={() => { setCartOpen(false); navigate('shop') }} onCheckout={beginCheckout} />}
      <a className="whatsapp-float" href={whatsAppLink(`Hello ${storeConfig.name}, I have a question.`)} target="_blank" rel="noreferrer" aria-label="Chat with Mamigloexclusive on WhatsApp">
        <span>CHAT WITH US</span><ArrowUpRight size={15} />
      </a>
    </div>
  )
}

function AdminRoute({ currentPage, onNavigate }: {
  currentPage: 'admin' | 'admin-login'
  onNavigate: (page: Page, category?: Category | '', replace?: boolean) => void
}) {
  const [authorizationState, setAuthorizationState] = useState<'loading' | 'guest' | 'customer' | 'admin' | 'error'>('loading')
  const [authorizationError, setAuthorizationError] = useState('')

  useEffect(() => {
    let active = true
    let authEventReceived = false
    let checkId = 0

    async function checkSession(sessionEmail: string, sessionToken: string) {
      const currentCheck = ++checkId
      if (!sessionEmail || !sessionToken) {
        if (active) setAuthorizationState('guest')
        return
      }
      try {
        const eligible = await getAdminEligibility(sessionEmail)
        if (active && currentCheck === checkId) setAuthorizationState(eligible ? 'admin' : 'customer')
      } catch (reason) {
        if (active && currentCheck === checkId) {
          setAuthorizationError(reason instanceof Error ? reason.message : 'Administrator access could not be verified.')
          setAuthorizationState('error')
        }
      }
    }

    if (!supabaseConfigured) return () => { active = false }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventReceived = true
      void checkSession(session?.user.email || '', session?.access_token || '')
    })

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active || authEventReceived) return
      if (error) {
        setAuthorizationError(error.message)
        setAuthorizationState('error')
        return
      }
      void checkSession(data.session?.user.email || '', data.session?.access_token || '')
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const redirect = adminRedirectForState(currentPage, authorizationState)
    if (redirect) onNavigate(redirect, '', true)
  }, [authorizationState, currentPage, onNavigate])

  if (!supabaseConfigured) return <main className="content-page admin-page"><p className="eyebrow">STORE ADMINISTRATION</p><h1>Administrator access</h1><p>Admin sign-in is unavailable until the Supabase project URL, publishable key, and authorised administrator account are configured.</p></main>
  if (authorizationState === 'loading') return <main className="content-page admin-page"><p className="eyebrow">STORE ADMINISTRATION</p><h1>Checking administrator access.</h1><p>Verifying your secure session and permission status…</p></main>
  if (authorizationState === 'error') return <main className="content-page admin-page"><p className="eyebrow">STORE ADMINISTRATION</p><h1>Access could not be verified.</h1><p>{authorizationError}</p></main>
  if (authorizationState === 'customer') return <main className="content-page admin-page"><p className="eyebrow">STORE ADMINISTRATION</p><h1>Access denied.</h1><p>This account is not authorised to manage the store.</p></main>
  if (currentPage === 'admin' && authorizationState === 'guest') return <main className="content-page admin-page"><p className="eyebrow">STORE ADMINISTRATION</p><h1>Opening administrator sign in.</h1></main>

  return <AdminDashboard />
}

function HomePage({ products, categories: storeCategories, loading, onShop, onCategory, onDetails, onAdd, onNavigate }: {
  products: Product[]; categories: string[]; loading: boolean; onShop: () => void; onCategory: (category: Category) => void
  onNavigate: (path: string) => void
  onDetails: (product: Product) => void; onAdd: (product: Product, quantity?: number, color?: string, size?: string) => void
}) {
  const newArrivals = [...products].sort((a, b) =>
    (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0),
  ).slice(0, 4)
  const categoryTiles = storeCategories.map((name, originalIndex) => ({
    name,
    originalIndex,
    products: products.filter((product) => product.category === name),
  })).sort((a, b) => b.products.length - a.products.length || a.originalIndex - b.originalIndex)
  const [categoryFilter, setCategoryFilter] = useState('All Categories')
  const [showAllCategories, setShowAllCategories] = useState(false)
  const newArrivalIds = new Set(newArrivals.map((product) => product.id))
  const visibleCategoryTiles = categoryTiles.filter(({ name, products: categoryProducts }) => {
    if (categoryFilter === 'All Categories') return true
    const searchable = `${name} ${categoryProducts.map((product) => `${product.name} ${product.description}`).join(' ')}`.toLowerCase()
    if (categoryFilter === 'Formal') return /tie|cufflink|pocket square|lapel|sock|shirt holder|bow tie/.test(searchable)
    if (categoryFilter === 'Business') return /classic tie|slim tie|skinny tie|shirt holder|belt|watch|briefcase/.test(searchable)
    if (categoryFilter === 'Wedding') return /wedding|bow tie|cufflink|pocket square|lapel|flower|boutonniere|cummerbund/.test(searchable)
    if (categoryFilter === 'Gift Sets') return /gift|combo|set/.test(searchable)
    return categoryProducts.some((product) => newArrivalIds.has(product.id))
  })
  return <main>
    <HeroSlideshow onNavigate={onNavigate} />

    <section className="editorial-strip"><span>DETAILS THAT DEFINE YOU</span><i /> <span>MADE FOR EVERY OCCASION</span><i /> <span>YOUR STYLE, YOUR STORY</span></section>

    <section className="section category-section" id="categories">
      <div className="category-intro">
        <p className="eyebrow category-kicker"><span /> SHOP BY CATEGORY <span /></p>
        <h2>Complete Your <em>Look</em></h2>
        <p>Explore our curated collection of men's accessories, designed for every occasion and every style.</p>
      </div>
      <div className="category-filters" role="group" aria-label="Filter categories">
        {[
          { label: 'All Categories', Icon: Grid2X2 },
          { label: 'Formal', Icon: Gem },
          { label: 'Business', Icon: BriefcaseBusiness },
          { label: 'Wedding', Icon: Gift },
          { label: 'Gift Sets', Icon: Star },
          { label: 'New Arrivals', Icon: Crown },
        ].map(({ label, Icon }) => <button key={label} className={categoryFilter === label ? 'active' : ''} aria-pressed={categoryFilter === label} onClick={() => { setCategoryFilter(label); setShowAllCategories(false) }}><Icon size={15} />{label}</button>)}
      </div>
      <div id="category-grid" className={`category-grid${showAllCategories ? ' is-expanded' : ''}`}>{visibleCategoryTiles.map(({ name, products: categoryProducts }) => {
        const imageProduct = categoryProducts.find((product) => product.available && product.stockQuantity > 0) || categoryProducts[0]
        const Icon = categoryIcon(name)
        const isNew = categoryProducts.some((product) => newArrivalIds.has(product.id))
        const hasSale = categoryProducts.some((product) => product.salePriceNGN !== undefined)
        return <button className={`category-card${imageProduct ? ' has-image' : ''}`} key={name} onClick={() => onCategory(name)}>
          {imageProduct && <img className="category-card-image" src={productImage(imageProduct.imageUrl)} alt="" loading="lazy" />}
          <span className="category-card-top"><Icon size={19} strokeWidth={1.5} />{isNew && <span className="category-badge">NEW</span>}{hasSale && <span className="category-badge sale">SALE</span>}</span>
          <span className="category-card-bottom"><span className="category-title">{name}</span><span className="category-card-meta">{categoryProducts.length} {categoryProducts.length === 1 ? 'Product' : 'Products'}</span></span>
          <span className="category-card-arrow"><ArrowRight size={16} /></span>
        </button>
      })}</div>
      {visibleCategoryTiles.length > 6 && <button className="category-show-more" aria-expanded={showAllCategories} aria-controls="category-grid" onClick={() => setShowAllCategories(!showAllCategories)}>{showAllCategories ? 'Show fewer categories' : `Show all ${visibleCategoryTiles.length} categories`}<ArrowDown size={14} /></button>}
      <button className="category-view-all" onClick={onShop}>View all categories <ArrowUpRight size={15} /></button>
    </section>

    <section className="featured-section" id="new-arrivals">
      <div className="section featured-inner">
        <SectionHeading kicker="JUST ARRIVED" title="New arrivals" action="Shop the collection" onAction={onShop} light />
        {loading ? <Loading light /> : <ProductGrid products={newArrivals} onDetails={onDetails} onAdd={onAdd} light />}
        {!loading && !newArrivals.length && <p className="section-empty">New pieces are on their way. Check back soon.</p>}
      </div>
    </section>

    <section className="section story-section">
      <div className="story-image"><img src="/images/product-placeholder.svg" alt="Illustrative campaign photo placeholder — replace with a brand photograph" /><span>IMAGE PLACEHOLDER</span></div>
      <div className="story-copy"><p className="eyebrow">THE MAMIGLO POINT OF VIEW</p><h2>It's not just what you wear.<br /><em>It's how you wear it.</em></h2><p>Thoughtful accessories have a way of bringing a whole look together. Find the finishing detail that feels unmistakably yours.</p><button className="text-link" onClick={onShop}>Find your finishing touch <ArrowRight size={15} /></button></div>
    </section>

    <section className="promise-section">
      <div className="section promise-inner"><SectionHeading kicker="THE EXPERIENCE" title="Good style. Thoughtfully simple." />
        <div className="promise-grid">
          <Promise number="01" title="A considered edit" text="Explore a focused collection of men's accessories in one place." />
          <Promise number="02" title="Easy to order" text="Choose your pieces and send your order details directly to our team on WhatsApp." />
          <Promise number="03" title="Here to help" text="Questions about an item or your order? Get in touch with our team." />
          <Promise number="04" title="Delivery, arranged" text="Delivery options and costs are confirmed with you before your order is finalised." />
        </div>
      </div>
    </section>
    <section className="cta-section"><p className="eyebrow">YOUR NEXT SIGNATURE LOOK</p><h2>Upgrade your wardrobe<br /><em>with Mamigloexclusive.</em></h2><button className="button button-gold" onClick={onShop}>Shop now <ArrowRight size={16} /></button><span className="cta-mark">M.</span></section>
  </main>
}

function SectionHeading({ kicker, title, action, onAction, light = false }: {
  kicker: string; title: string; action?: string; onAction?: () => void; light?: boolean
}) {
  return <div className={`section-heading ${light ? 'light' : ''}`}><div><p className="eyebrow">{kicker}</p><h2>{title}</h2></div>{action && onAction && <button className="text-link" onClick={onAction}>{action}<ArrowRight size={15} /></button>}</div>
}

function ProductGrid({ products, onDetails, onAdd, light = false }: {
  products: Product[]; onDetails: (product: Product) => void
  onAdd: (product: Product, quantity?: number, color?: string, size?: string) => void; light?: boolean
}) {
  if (!products.length) return null
  return <div className={`product-grid ${light ? 'on-dark' : ''}`}>{products.map((product) => (
    <article className="product-card" key={product.id}>
      <button className="product-visual" onClick={() => onDetails(product)} aria-label={`View details for ${product.name}`}>
        <img loading="lazy" src={productImage(product.imageUrl, 640)} alt={product.demo ? `${product.name} — demo product photo placeholder` : product.imageMedia?.find((media) => media.url === product.imageUrl)?.altText || product.name} />
        {product.demo && <span className="product-demo-label">DEMO PHOTO</span>}
        {product.featured && <span className="product-feature-label">CURATED</span>}
      </button>
      <div className="product-info">
        <div className="product-meta"><span>{product.category}</span><span className={product.stockQuantity > 0 ? 'stock-available' : 'stock-unavailable'}>{product.stockQuantity > 0 ? 'Available' : 'Sold out'}</span></div>
        <a className="product-name" href={`/product/${encodeURIComponent(product.id)}`} onClick={(event) => { event.preventDefault(); onDetails(product) }}>{product.name}</a>
        <div className="product-bottom"><div className="product-price">{product.salePriceNGN ? <><strong>{formatNGN(product.salePriceNGN)}</strong><del>{formatNGN(product.priceNGN)}</del></> : <strong>{formatNGN(product.priceNGN)}</strong>}</div>
          <button className="add-icon" aria-label={`Add ${product.name} to bag`} disabled={!product.available || product.stockQuantity === 0} onClick={() => onAdd(product)}><Plus size={17} /></button></div>
        <div className="swatches">{product.colors.slice(0, 4).map((color) => <span key={color} title={color}>{color}</span>)}</div>
      </div>
    </article>
  ))}</div>
}

function Promise({ number, title, text }: { number: string; title: string; text: string }) {
  return <article className="promise-card"><span>{number}</span><h3>{title}</h3><p>{text}</p></article>
}

function ProductDetailPage({ product, onBack, onAdd }: {
  product: Product; onBack: () => void
  onAdd: (product: Product, quantity?: number, color?: string, size?: string) => void
}) {
  const [color, setColor] = useState(product.colors[0] || '')
  const [size, setSize] = useState(product.sizes?.[0] || '')
  const [quantity, setQuantity] = useState(1)
  const images = product.imageUrls?.length ? product.imageUrls : [product.imageUrl]
  const [selectedImage, setSelectedImage] = useState(images[0])
  const selectedImageAlt = product.imageMedia?.find((media) => media.url === selectedImage)?.altText || product.name
  return <main className="content-page product-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15} /> {product.category}</button>
    <div className="product-detail-layout">
      <div className="product-detail-media"><div className="product-detail-visual"><img fetchPriority="high" src={productImage(selectedImage, 1600)} alt={product.demo ? `${product.name} — demo product photo placeholder` : selectedImageAlt} />{product.demo && <span className="product-demo-label">BUSINESS PHOTO PLACEHOLDER</span>}</div>{images.length > 1 && <div className="product-gallery" aria-label="Product images">{images.map((image, index) => <button className={selectedImage === image ? 'selected' : ''} key={`${image}-${index}`} onClick={() => setSelectedImage(image)} aria-label={`Show product image ${index + 1}`}><img loading="lazy" src={productImage(image, 320)} alt="" /></button>)}</div>}{Boolean(product.videoMedia?.length) && <div className="product-detail-videos" aria-label="Product demonstration videos">{product.videoMedia?.map((media) => <video key={media.id} src={cloudinaryVideoUrl(media.url, 1200)} controls muted playsInline preload="metadata" aria-label={media.altText || `${product.name} demonstration video`} />)}</div>}</div>
      <section className="product-detail-copy"><p className="eyebrow">{product.category.toUpperCase()}</p><h1>{product.name}</h1><p className="product-detail-sku">REF. {product.sku}</p><p className="product-detail-price">{formatNGN(product.salePriceNGN ?? product.priceNGN)}{product.salePriceNGN && <del>{formatNGN(product.priceNGN)}</del>}</p><p className="product-detail-description">{product.description}</p>
        <div className="variation-row"><strong>Colour</strong><div className="variation-options">{product.colors.map((value) => <button className={color === value ? 'selected' : ''} key={value} onClick={() => setColor(value)}>{value}</button>)}</div></div>
        {Boolean(product.sizes?.length) && <div className="variation-row"><strong>Size</strong><div className="variation-options">{product.sizes?.map((value) => <button className={size === value ? 'selected' : ''} key={value} onClick={() => setSize(value)}>{value}</button>)}</div></div>}
        <p className={`availability ${product.stockQuantity ? 'stock-available' : 'stock-unavailable'}`}>{product.stockQuantity ? `${product.stockQuantity} available` : 'Currently unavailable'}</p>
        <div className="product-detail-actions"><div className="quantity-control"><span>Quantity</span><button onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Reduce quantity"><Minus size={15} /></button><b>{quantity}</b><button onClick={() => setQuantity(Math.min(product.stockQuantity, 20, quantity + 1))} disabled={quantity >= 20 || quantity >= product.stockQuantity} aria-label="Increase quantity"><Plus size={15} /></button></div><button className="button button-dark" disabled={!product.available || product.stockQuantity < 1} onClick={() => onAdd(product, quantity, color || undefined, size || undefined)}>Add to bag <ShoppingBag size={16} /></button></div>
        <p className="product-detail-note">Availability and delivery details are confirmed with you before an order is finalised.</p>
      </section>
    </div>
  </main>
}

function CartDrawer({ cart, products, deliveryFeeNGN, onClose, onUpdate, onRemove, onContinue, onCheckout }: {
  cart: CartItem[]; products: Product[]; deliveryFeeNGN: number; onClose: () => void
  onUpdate: (item: CartItem, quantity: number) => void; onRemove: (item: CartItem) => void
  onContinue: () => void; onCheckout: () => void
}) {
  const total = subtotal(cart, products)
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <aside className="cart-drawer" aria-label="Shopping bag">
      <div className="drawer-heading"><div><p className="eyebrow">YOUR SELECTION</p><h2>Shopping bag <span>({cart.reduce((sum, item) => sum + item.quantity, 0)})</span></h2></div><button className="icon-button" onClick={onClose} aria-label="Close bag"><X /></button></div>
      <div className="cart-lines">{cart.map((item, index) => {
        const product = products.find(({ id }) => id === item.productId)
        if (!product) return null
        return <article className="cart-line" key={`${item.productId}-${item.color}-${item.size}-${index}`}>
          <img src={productImage(product.imageUrl)} alt="" /><div className="cart-line-main"><span>{product.category}</span><strong>{product.name}</strong><small>{[item.color, item.size].filter(Boolean).join(' · ')}</small><div className="quantity-control compact"><button onClick={() => onUpdate(item, item.quantity - 1)} aria-label="Remove one"><Minus size={13} /></button><b>{item.quantity}</b><button onClick={() => onUpdate(item, item.quantity + 1)} disabled={item.quantity >= product.stockQuantity} aria-label="Add one"><Plus size={13} /></button></div></div>
          <div className="cart-line-price"><strong>{formatNGN((product.salePriceNGN ?? product.priceNGN) * item.quantity)}</strong><button className="remove-link" onClick={() => onRemove(item)}>Remove</button></div>
        </article>
      })}</div>
      {cart.length ? <div className="drawer-summary"><div><span>Subtotal</span><strong>{formatNGN(total)}</strong></div><div><span>Default delivery</span><strong>{formatNGN(deliveryFeeNGN)}</strong></div><div className="drawer-total"><span>Estimated total</span><strong>{formatNGN(total + deliveryFeeNGN)}</strong></div><p>Delivery may vary by destination. The team will confirm the final charge before fulfilment.</p><button className="button button-dark full-width" onClick={onCheckout}>Continue to checkout <ArrowRight size={16} /></button><button className="continue-link" onClick={onContinue}>Continue shopping</button></div> : <EmptyState title="Your bag is waiting." text="Discover something to make the look your own." action="Explore the collection" onAction={onContinue} />}
      <span className="drawer-note">Orders remain pending until confirmed by our team.</span>
    </aside>
  </div>
}

function CheckoutForm({ cart, products, deliveryFeeNGN, error, initialAddress, onSubmit, onBack }: {
  cart: CartItem[]; products: Product[]; deliveryFeeNGN: number; error: string; initialAddress?: CustomerAddressInput | null; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onBack: () => void
}) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('opay_transfer')
  const [checkoutStep, setCheckoutStep] = useState<'details' | 'payment'>('details')
  const [deliveryDetails, setDeliveryDetails] = useState<CustomerDetails | null>(null)
  const [detailsError, setDetailsError] = useState('')
  const total = subtotal(cart, products)
  if (cart.length === 0) return <EmptyState title="Your bag is empty." text="Add a piece to your bag before checkout." action="Browse the collection" onAction={onBack} />

  function continueToPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const customer: CustomerDetails = {
      fullName: String(form.get('fullName') || '').trim(),
      phone: String(form.get('phone') || '').trim(),
      email: String(form.get('email') || '').trim(),
      address: String(form.get('address') || '').trim(),
      state: String(form.get('state') || '').trim(),
      city: String(form.get('city') || '').trim(),
      deliveryMethod: String(form.get('deliveryMethod') || '').trim(),
      instructions: String(form.get('instructions') || '').trim(),
    }
    const validationError = checkoutValidationError(customer, cart)
    if (validationError) {
      setDetailsError(validationError)
      return
    }
    setDetailsError('')
    setDeliveryDetails(customer)
    setCheckoutStep('payment')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function submitCheckoutStep(event: FormEvent<HTMLFormElement>) {
    if (checkoutStep === 'details') {
      continueToPayment(event)
      return
    }
    onSubmit(event)
  }

  return <div className="checkout-layout">
    <div className="checkout-main"><button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Continue shopping</button>
      <ol className="checkout-progress" aria-label="Checkout steps">
        <li className={checkoutStep === 'details' ? 'is-current' : 'is-complete'}><span>1</span><div><small>STEP ONE</small><strong>Delivery details</strong></div></li>
        <li className={checkoutStep === 'payment' ? 'is-current' : ''}><span>2</span><div><small>STEP TWO</small><strong>Payment</strong></div></li>
      </ol>
      <p className="eyebrow">{checkoutStep === 'details' ? 'DELIVERY DETAILS' : 'PAYMENT'}</p>
      <h1>{checkoutStep === 'details' ? "Let's get your order started." : 'Choose how to pay.'}</h1>
      <p className="checkout-helper">{checkoutStep === 'details' ? "We'll confirm your order and delivery details with you directly." : 'Choose a payment method. Your order remains pending until our team confirms it.'}</p>
      <form className="checkout-form" onSubmit={submitCheckoutStep}>
        <div hidden={checkoutStep !== 'details'}>
          <div className="form-two"><Field label="Full name" name="fullName" required autoComplete="name" maxLength={120} defaultValue={initialAddress?.recipientName} /><Field label="Phone number" name="phone" type="tel" required autoComplete="tel" placeholder="+234" maxLength={20} defaultValue={initialAddress?.phone} /><Field label="Email address" name="email" type="email" autoComplete="email" placeholder="Optional" maxLength={254} /><Field label="State" name="state" required autoComplete="address-level1" maxLength={100} defaultValue={initialAddress?.state} /></div>
          <Field label="City / town" name="city" required autoComplete="address-level2" maxLength={100} defaultValue={initialAddress?.city} /><Field label="Delivery address" name="address" required autoComplete="street-address" maxLength={400} defaultValue={[initialAddress?.streetAddress, initialAddress?.additionalDirections].filter(Boolean).join(', ')} />
          <label className="field"><span>Preferred delivery method</span><select name="deliveryMethod" required defaultValue=""><option value="" disabled>Select a preference</option><option>Courier delivery</option><option>Pickup / collection</option><option>Discuss with me</option></select></label>
          <label className="field"><span>Additional instructions <small>Optional</small></span><textarea name="instructions" rows={3} maxLength={1000} placeholder="Anything we should know about your order?" /></label>
          {detailsError && <ErrorNotice message={detailsError} />}
          <button className="button button-dark full-width" type="submit">Continue to payment <ArrowRight size={16} /></button>
        </div>

        <div hidden={checkoutStep !== 'payment'}>
          {deliveryDetails && <div className="payment-delivery-summary"><div><span>Delivering to</span><strong>{deliveryDetails.fullName}</strong><small>{deliveryDetails.address}, {deliveryDetails.city}, {deliveryDetails.state}</small></div><button type="button" className="text-link" onClick={() => setCheckoutStep('details')}><Pencil size={13} /> Edit</button></div>}
          <fieldset className="payment-method-fieldset">
            <legend>Choose a payment method</legend>
            <label className={`payment-method-option${paymentMethod === 'opay_transfer' ? ' selected' : ''}`}>
              <input type="radio" name="paymentMethod" value="opay_transfer" checked={paymentMethod === 'opay_transfer'} onChange={() => setPaymentMethod('opay_transfer')} />
              <Building2 size={18} />
              <span><strong>OPay bank transfer</strong><small>Bank details and your order reference appear after order creation. Payment is confirmed manually by our team.</small></span>
            </label>
            <label className={`payment-method-option${paymentMethod === 'cash_on_delivery' ? ' selected' : ''}`}>
              <input type="radio" name="paymentMethod" value="cash_on_delivery" checked={paymentMethod === 'cash_on_delivery'} onChange={() => setPaymentMethod('cash_on_delivery')} />
              <Truck size={18} />
              <span><strong>Cash on delivery</strong><small>Pay when your order is delivered. Availability will be confirmed by our team.</small></span>
            </label>
          </fieldset>
          {error && <ErrorNotice message={error} />}
          <div className="checkout-payment-actions"><button className="button button-outline" type="button" onClick={() => setCheckoutStep('details')}><ArrowLeft size={15} /> Back</button><button className="button button-dark" type="submit">{paymentMethod === 'opay_transfer' ? 'Place order and view payment details' : 'Place cash-on-delivery order'} <ArrowRight size={16} /></button></div>
          <p className="form-legal">Placing this order creates a pending request. This site does not process or automatically verify online payments.</p>
        </div>
      </form>
    </div>
    <aside className="checkout-summary"><p className="eyebrow">ORDER SUMMARY</p>{cart.map((item, index) => {
      const product = products.find(({ id }) => id === item.productId)
      if (!product) return null
      return <div className="summary-item" key={`${item.productId}-${index}`}><img src={productImage(product.imageUrl)} alt="" /><div><strong>{product.name}</strong><span>{item.quantity} × {formatNGN(product.salePriceNGN ?? product.priceNGN)}</span></div><b>{formatNGN((product.salePriceNGN ?? product.priceNGN) * item.quantity)}</b></div>
    })}<div className="summary-total"><div><span>Subtotal</span><b>{formatNGN(total)}</b></div><div><span>Default delivery</span><b>{formatNGN(deliveryFeeNGN)}</b></div><div className="grand-total"><span>Estimated total</span><b>{formatNGN(total + deliveryFeeNGN)}</b></div></div><p className="secure-note"><Sparkles size={15} /> Delivery may vary by destination and will be confirmed by our team. OPay transfer is manually confirmed.</p></aside>
  </div>
}

function OrderPending({ order, message, onShop }: { order: StoreOrder; message: string; onShop: () => void }) {
  const reviewPeriodSeconds = 15 * 60
  const [confirmationSubmittedAt, setConfirmationSubmittedAt] = useState<number | null>(() => {
    const value = Date.parse(order.paymentConfirmationSubmittedAt || '')
    return Number.isFinite(value) && value > 0 ? value : null
  })
  const [paymentReference, setPaymentReference] = useState('')
  const [now, setNow] = useState(Date.now())
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [paymentError, setPaymentError] = useState('')
  const [paymentNotice, setPaymentNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    if (confirmationSubmittedAt === null) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [confirmationSubmittedAt])
  const remainingSeconds = confirmationSubmittedAt === null
    ? reviewPeriodSeconds
    : Math.max(0, reviewPeriodSeconds - Math.floor((now - confirmationSubmittedAt) / 1000))
  const countdown = `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`
  const isTransfer = order.paymentMethod === 'opay_transfer'

  async function copyAccountNumber() {
    const accountNumber = '9155556748'
    try {
      await navigator.clipboard.writeText(accountNumber)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1600)
    } catch {
      setCopyState('error')
      window.setTimeout(() => setCopyState('idle'), 2000)
    }
  }

  async function submitPaymentConfirmation() {
    if (confirmationSubmittedAt !== null) {
      setPaymentNotice('Your payment confirmation has already been submitted. Our team is reviewing it now.')
      setPaymentError('')
      return
    }
    if (!paymentReference.trim() || paymentReference.trim().length > 160) {
      setPaymentError('Enter the transfer reference shown by your payment provider.')
      return
    }
    setSubmitting(true)
    setPaymentError('')
    try {
      const result = await storeApi.customer.submitPaymentConfirmation(order.id, paymentReference, order.totalNGN)
      const submittedAt = Date.parse(result.submittedAt)
      if (!Number.isFinite(submittedAt)) throw new Error('The server did not return a valid payment submission time.')
      setNow(submittedAt)
      setConfirmationSubmittedAt(submittedAt)
      setPaymentNotice('Your transfer reference was recorded. Payment remains pending until our team verifies receipt.')
    } catch (reason) {
      setPaymentError(reason instanceof Error ? reason.message : 'We could not submit your payment confirmation. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return <section className="order-pending"><div className="success-mark"><Check /></div><p className="eyebrow">ORDER REQUEST CREATED</p><h1>Thank you, {order.customer.fullName.split(' ')[0]}.</h1><p>Your request <strong>{order.reference}</strong> is pending. Our team will confirm availability, delivery and payment arrangements.</p>
    {isTransfer ? <div className="transfer-instructions"><p className="eyebrow">OPAY BANK TRANSFER</p>
      <div className="transfer-detail"><span>Bank</span><strong>OPay</strong></div>
      <div className="transfer-detail"><span>Account number</span><button type="button" className="text-link" onClick={copyAccountNumber} aria-label="Copy OPay account number">{copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy Account Number'}</button><strong>9155556748</strong></div>
      <div className="transfer-detail"><span>Account name</span><strong>Mamigloexclusive</strong></div>
      <div className="transfer-detail"><span>Exact amount</span><strong>{formatNGN(order.totalNGN)}</strong></div>
      <div className="transfer-detail"><span>Payment reference</span><strong>{order.reference}</strong></div>
      <p>Please transfer the exact amount shown above to the OPay account provided. After making your transfer, click the button below to notify our team. Your order will remain pending until our admin verifies and confirms your payment.</p>
      {paymentError && <div className="error-notice" role="alert">{paymentError}</div>}
      {paymentNotice && <div className="success-message" role="status">{paymentNotice}</div>}
      {confirmationSubmittedAt === null && order.customerUserId
        ? <><label className="field payment-reference-field"><span>Transfer reference *</span><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} maxLength={160} required placeholder="Enter the reference from your transfer" /></label><button className="button button-dark full-width" type="button" disabled={submitting} onClick={() => void submitPaymentConfirmation()}>{submitting ? 'Submitting…' : 'I Have Made the Payment'}</button></>
        : confirmationSubmittedAt === null
          ? <p className="form-legal">To submit a payment reference from a guest order, continue in WhatsApp and include your transfer reference. Payment remains pending until our team verifies receipt.</p>
          : <div className="payment-countdown" aria-live="polite"><Clock3 size={17} /><div><strong>{remainingSeconds > 0 ? `Payment Verification in Progress · ${countdown}` : 'Verification is taking longer than expected. Your payment is still pending confirmation.'}</strong><span>Transfer reference received at {new Date(confirmationSubmittedAt).toLocaleString()}. Payment has not been marked paid.</span></div></div>}
    </div> : <div className="transfer-instructions"><p className="eyebrow">CASH ON DELIVERY</p><p>Payment is due when your order is delivered. Our team will contact you to confirm delivery availability and arrangements.</p></div>}
    <div className="order-review">{order.lines.map((line) => <div key={`${line.productId}-${line.color}-${line.size}`}><span>{line.name}{line.color ? ` · ${line.color}` : ''} × {line.quantity}</span><strong>{formatNGN(line.unitPriceNGN * line.quantity)}</strong></div>)}<div><span>Subtotal</span><strong>{formatNGN(order.subtotalNGN)}</strong></div><div><span>Delivery</span><span>To be confirmed</span></div><div className="order-total"><strong>Total before delivery confirmation</strong><strong>{formatNGN(order.totalNGN)}</strong></div></div>
    <a className="button button-gold full-width" href={whatsAppLink(message)} target="_blank" rel="noreferrer">Continue in WhatsApp <ArrowUpRight size={16} /></a>
    <p className="form-legal">This opens a message draft only. OPay payment remains pending until the team verifies receipt. Cash-on-delivery orders remain pending until the team confirms delivery arrangements.</p><button className="text-link" onClick={onShop}>Return to the collection <ArrowRight size={15} /></button>
  </section>
}

function AboutPage() {
  return <main className="content-page about-page"><p className="eyebrow">OUR POINT OF VIEW</p><h1>Good style is in<br /><em>the details.</em></h1><p className="about-lead">Mamigloexclusive is a men's accessories brand for those who know the finishing touch is never just a finishing touch.</p><div className="about-photo"><img src="/images/product-placeholder.svg" alt="Brand story image placeholder — replace with a real Mamigloexclusive photograph" /><span>BRAND PHOTOGRAPH PLACEHOLDER</span></div><div className="about-columns"><div><p className="eyebrow">THE IDEA</p><h2>Made for the way you show up.</h2></div><div><p>From workday dressing to life's biggest celebrations, the right detail can change how a look—and a moment—feels. We bring together men's accessories to help you choose with confidence and express your own sense of style.</p><p>This story is a starting point. Add the real Mamigloexclusive history, mission and values here when you're ready to share them.</p></div></div></main>
}

function ContactPage() {
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setStatus('')
    setSending(true)
    const form = new FormData(event.currentTarget)
    try {
      const result = await storeApi.contact({
        name: String(form.get('name') || ''),
        email: String(form.get('email') || ''),
        message: String(form.get('message') || ''),
        website: String(form.get('website') || ''),
      })
      setStatus(result.message)
      event.currentTarget.reset()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your message could not be sent.')
    } finally {
      setSending(false)
    }
  }
  return <main className="content-page contact-page"><div className="contact-intro"><p className="eyebrow">WE'RE HERE TO HELP</p><h1>Let's talk<br /><em>good style.</em></h1><p>Have a question about the collection, your order or something else? We'd love to hear from you.</p><a className="button button-dark" target="_blank" rel="noreferrer" href={whatsAppLink(`Hello ${storeConfig.name}, I have a question.`)}>Message us on WhatsApp <ArrowUpRight size={15} /></a></div>
    <section className="contact-panel"><div className="contact-details"><p className="eyebrow">GET IN TOUCH</p><a href={`tel:${storeConfig.phone.replace(/[^\d+]/g, '')}`}>{storeConfig.phone}</a><a href={`mailto:${storeConfig.email}`}>{storeConfig.email}</a><div className="social-links"><a href={storeConfig.instagram} target="_blank" rel="noreferrer">Instagram <ArrowUpRight size={13} /></a><a href={storeConfig.facebook} target="_blank" rel="noreferrer">Facebook <ArrowUpRight size={13} /></a></div><p className="placeholder-note">Replace these contact and social links with your business details in the environment settings.</p></div>
      <form className="contact-form" onSubmit={submit}><p className="eyebrow">SEND A MESSAGE</p><Field label="Your name" name="name" required autoComplete="name" /><Field label="Email address" name="email" type="email" required autoComplete="email" /><label className="field"><span>How can we help?</span><textarea name="message" rows={5} required maxLength={2000} /></label><div className="honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>{error && <ErrorNotice message={error} />}{status && <p className="success-message" role="status">{status}</p>}<button className="button button-dark" disabled={sending}>{sending ? 'Sending…' : 'Send message'} <ArrowRight size={15} /></button></form>
    </section>
  </main>
}

function PolicyPage({ kind }: { kind: 'delivery' | 'returns' | 'privacy' | 'terms' }) {
  const copy = {
    delivery: {
      label: 'DELIVERY INFORMATION', title: 'Delivery, arranged with you.',
      text: 'Delivery options, timelines and applicable charges are confirmed directly with you before your order is finalised. Add your current delivery coverage, prices and estimated timelines here before launch.',
    },
    returns: {
      label: 'RETURNS & EXCHANGES', title: 'A clear way forward.',
      text: 'Add your approved return, exchange, cancellation and refund terms here, including eligibility, timelines and contact instructions. This placeholder is not a published return policy.',
    },
    privacy: {
      label: 'PRIVACY', title: 'Your information matters.',
      text: 'Order and contact details are used to respond to enquiries and manage orders. Publish a business-approved privacy notice that explains what data is collected, how long it is kept, how customers can exercise their rights, and how to contact the business.',
    },
    terms: {
      label: 'TERMS & CONDITIONS', title: 'The details, in writing.',
      text: 'Add your approved terms for product availability, pricing, order acceptance, payments, delivery, cancellations, returns and applicable law before accepting real customer orders.',
    },
  }[kind]
  return <main className="content-page policy-page"><p className="eyebrow">{copy.label}</p><h1>{copy.title}</h1><p>{copy.text}</p><p className="policy-placeholder">Business owner: review and replace this launch placeholder with your final policy.</p><a className="text-link" href={whatsAppLink(`Hello ${storeConfig.name}, I have a question about ${copy.label.toLowerCase()}.`)} target="_blank" rel="noreferrer">Ask us on WhatsApp <ArrowUpRight size={15} /></a></main>
}

function NotFoundPage({ onHome }: { onHome: () => void }) {
  return <main className="content-page not-found-page"><p className="eyebrow">404 — NOT FOUND</p><h1>This page took<br /><em>a different turn.</em></h1><p>Let's get you back to the collection.</p><button className="button button-dark" onClick={onHome}>Return home <ArrowRight size={15} /></button></main>
}

function Field({ label, name, type = 'text', required = false, autoComplete, placeholder, maxLength, defaultValue }: {
  label: string; name: string; type?: string; required?: boolean; autoComplete?: string; placeholder?: string; maxLength?: number; defaultValue?: string
}) {
  return <label className="field"><span>{label}{required && <b> *</b>}</span><input name={name} type={type} required={required} autoComplete={autoComplete} placeholder={placeholder} maxLength={maxLength} defaultValue={defaultValue} /></label>
}

function Footer({ navigate }: { navigate: (page: Page, category?: Category | '') => void }) {
  return <footer className="site-footer"><div className="footer-main"><div className="footer-brand"><button className="brand-mark" onClick={() => navigate('home')}><img className="brand-logo" src="/images/logo.png" alt="" /><span className="brand-name">MAMIGLO<span>EXCLUSIVE</span></span></button><p>Men's accessories for confidence, elegance and distinction.</p><div className="footer-social"><a href={storeConfig.instagram} target="_blank" rel="noreferrer">Instagram <ArrowUpRight size={12} /></a><a href={storeConfig.facebook} target="_blank" rel="noreferrer">Facebook <ArrowUpRight size={12} /></a></div></div>
    <div className="footer-column"><p>EXPLORE</p><button onClick={() => navigate('shop')}>Shop all</button><button onClick={() => navigate('shop', 'Classic Ties')}>Ties</button><button onClick={() => navigate('shop', 'Cufflinks')}>Cufflinks</button><button onClick={() => navigate('shop', 'Wedding Ties')}>Wedding edit</button></div>
    <div className="footer-column"><p>THE BRAND</p><button onClick={() => navigate('about')}>About us</button><button onClick={() => navigate('contact')}>Contact</button><button onClick={() => navigate('delivery')}>Delivery information</button><button onClick={() => navigate('returns')}>Returns & exchanges</button></div>
    <div className="footer-column"><p>CONTACT</p><a href={`tel:${storeConfig.phone.replace(/[^\d+]/g, '')}`}>{storeConfig.phone}</a><a href={`mailto:${storeConfig.email}`}>{storeConfig.email}</a><a href={whatsAppLink(`Hello ${storeConfig.name}`)} target="_blank" rel="noreferrer">WhatsApp us <ArrowUpRight size={12} /></a><span className="footer-placeholder">Returns, privacy & terms pages to be completed before launch.</span></div></div>
    <div className="footer-bottom"><span>© {new Date().getFullYear()} Mamigloexclusive. All rights reserved.</span><span>Made for the moments that matter.</span><button onClick={() => navigate('admin')}>Store admin</button></div>
  </footer>
}

function ErrorNotice({ message }: { message: string }) {
  return <div className="error-notice" role="alert">{message}</div>
}

function Loading({ light = false }: { light?: boolean }) {
  return <div className={`loading-state ${light ? 'light' : ''}`} role="status"><span className="spinner" /> Loading the collection…</div>
}

function EmptyState({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><ShoppingBag size={25} /><h3>{title}</h3><p>{text}</p>{action && onAction && <button className="text-link" onClick={onAction}>{action} <ArrowRight size={14} /></button>}</div>
}

export default App
