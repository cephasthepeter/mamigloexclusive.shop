import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Check, Menu, Minus,
  Plus, Search, ShoppingBag, Sparkles, UserRound, X,
} from 'lucide-react'
import { ApiError, storeApi } from './api'
import { loadCart, saveCart, subtotal, type CartItem } from './cart'
import { formatNGN, storeConfig, whatsAppLink } from './config'
import { getAdminEligibility, supabase, supabaseConfigured } from './supabase'
import type { Category, CustomerDetails, Product, StoreOrder } from './types'
import { categories } from './types'
import { AdminDashboard } from './components/AdminDashboard'
import { CustomerAccount } from './components/CustomerAccount'

type Page = 'home' | 'shop' | 'product' | 'about' | 'contact' | 'checkout' | 'account' | 'login' | 'register' | 'admin' | 'admin-login' | 'delivery' | 'returns' | 'privacy' | 'terms' | 'notfound'

export function pageFromPath(path: string): Page {
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

function idFromPath(path: string) {
  if (!path.startsWith('/product/')) return ''
  try { return decodeURIComponent(path.slice('/product/'.length)) } catch { return '' }
}

function productImage(url: string) {
  return url
}

function App() {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname))
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
  const [checkoutError, setCheckoutError] = useState('')
  const [sort, setSort] = useState('featured')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')

  useEffect(() => {
    const handlePopState = () => {
      setPage(pageFromPath(location.pathname))
      setProductId(idFromPath(location.pathname))
      setCategory(new URLSearchParams(location.search).get('category') as Category || '')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

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
    robots.content = page === 'admin' || page === 'admin-login' || page === 'notfound' || page === 'product' && Boolean(productPageError)
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
        openGraphImage.content = new URL(productImage(pageProduct.imageUrl), location.origin).toString()
      } else {
        openGraphImage.removeAttribute('content')
      }
    }
  }, [category, page, pageProduct, productPageError])

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

  function navigate(next: Page, nextCategory: Category | '' = '', replace = false) {
    const path = next === 'home' ? '/' : next === 'admin-login' ? '/admin/login' : `/${next}`
    const query = next === 'shop' && nextCategory ? `?category=${encodeURIComponent(nextCategory)}` : ''
    if (replace) history.replaceState({}, '', `${path}${query}`)
    else history.pushState({}, '', `${path}${query}`)
    setPage(next)
    setCategory(nextCategory)
    setProductId('')
    setPageProduct(null)
    setMobileMenuOpen(false)
    setCartOpen(false)
    setOrder(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function openProduct(product: Product) {
    history.pushState({}, '', `/product/${encodeURIComponent(product.id)}`)
    setPage('product')
    setProductId(product.id)
    setPageProduct(product)
    setCategory('')
    setMobileMenuOpen(false)
    setCartOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function addToCart(product: Product, quantity = 1, color?: string, size?: string) {
    if (!product.available || product.stockQuantity <= 0) return
    setCart((items) => {
      const match = items.find((item) => item.productId === product.id && item.color === color && item.size === size)
      if (match) {
        return items.map((item) => item === match
          ? { ...item, quantity: Math.min(product.stockQuantity, item.quantity + quantity) }
          : item)
      }
      return [...items, { productId: product.id, quantity: Math.min(quantity, product.stockQuantity), color, size }]
    })
    setCartOpen(true)
  }

  function updateQuantity(item: CartItem, quantity: number) {
    setCart((items) => quantity <= 0
      ? items.filter((entry) => entry !== item)
      : items.map((entry) => entry === item
        ? { ...entry, quantity: Math.min(quantity, products.find((product) => product.id === entry.productId)?.stockQuantity || 0) }
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
      if (sort === 'newest') return b.name.localeCompare(a.name)
      return Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name)
    })
    return found
  }, [category, maxPrice, minPrice, products, searchText, sort])

  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0)
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
    try {
      const { order: newOrder } = await storeApi.createOrder(customer, cart)
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

  return (
    <div className="site-shell">
      {demoMode && <div className="demo-notice"><span>DEMO CATALOGUE</span> Example products, prices, photos and stock — replace and verify before accepting real orders.</div>}
      <div className="announcement">{announcement}</div>
      {loadError && <div className="error-notice global-store-error" role="alert">{loadError}</div>}
      <header className="site-header">
        <button className="brand-mark" onClick={() => navigate('home')} aria-label="Mamigloexclusive home">
          <span className="brand-monogram">M</span><span className="brand-name">MAMIGLO<span>EXCLUSIVE</span></span>
        </button>
        <button className="mobile-menu-button" aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? <X /> : <Menu />}
        </button>
        <nav className={`main-nav ${mobileMenuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
          <button className={page === 'home' ? 'active' : ''} onClick={() => navigate('home')}>Home</button>
          <button className={page === 'shop' ? 'active' : ''} onClick={() => navigate('shop')}>Shop</button>
          <button onClick={() => {
            if (document.getElementById('categories')) document.getElementById('categories')?.scrollIntoView({ behavior: 'smooth' })
            else {
              navigate('home')
              window.setTimeout(() => document.getElementById('categories')?.scrollIntoView({ behavior: 'smooth' }), 50)
            }
          }}>Categories</button>
          <button className={page === 'about' ? 'active' : ''} onClick={() => navigate('about')}>About us</button>
          <button className={page === 'contact' ? 'active' : ''} onClick={() => navigate('contact')}>Contact</button>
           <a className="nav-whatsapp" href={whatsAppLink(`Hello ${storeConfig.name}, I have an enquiry.`)} target="_blank" rel="noreferrer">WhatsApp <ArrowUpRight size={14} /></a>
        </nav>
        <div className="header-actions">
          <button className="icon-button" aria-label="Search products" onClick={() => { navigate('shop'); window.setTimeout(() => document.getElementById('shop-search')?.focus(), 40) }}><Search /></button>
          <button className="icon-button" aria-label="My account" title="My account" onClick={() => navigate('account')}><UserRound /></button>
          <button className="checkout-header-button" aria-label="Checkout" title="Checkout" onClick={() => navigate('checkout')}><ArrowRight size={16} /><span>Checkout</span></button>
          <button className="cart-button" aria-label={`Shopping bag, ${itemCount} items`} onClick={() => setCartOpen(true)}>
            <ShoppingBag size={18} /><span>Bag</span>{itemCount > 0 && <b>{itemCount}</b>}
          </button>
        </div>
      </header>

      {page === 'home' && <HomePage products={products} categories={categoryList} loading={loading} onShop={() => navigate('shop')} onCategory={(value) => navigate('shop', value)} onDetails={openProduct} onAdd={addToCart} />}
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
        {!order ? <CheckoutForm cart={cart} products={products} deliveryFeeNGN={deliveryFeeNGN} error={checkoutError} onSubmit={submitCheckout} onBack={() => navigate('shop')} /> : (
          <OrderPending order={order} message={orderWhatsAppMessage(order)} onShop={() => navigate('shop')} />
        )}
      </main>}
      {page === 'login' && <CustomerAccount initialMode="sign-in" onNavigate={(target) => {
        if (target === 'register') navigate('register')
        if (target === 'home') navigate('home')
        if (target === 'account') navigate('account')
      }} />}
      {page === 'register' && <CustomerAccount initialMode="sign-up" onNavigate={(target) => {
        if (target === 'login') navigate('login')
        if (target === 'home') navigate('home')
        if (target === 'account') navigate('account')
      }} />}
      {page === 'account' && <CustomerAccount onNavigate={(target) => {
        if (target === 'login') navigate('login')
        if (target === 'register') navigate('register')
        if (target === 'home') navigate('home')
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

function HomePage({ products, categories: storeCategories, loading, onShop, onCategory, onDetails, onAdd }: {
  products: Product[]; categories: string[]; loading: boolean; onShop: () => void; onCategory: (category: Category) => void
  onDetails: (product: Product) => void; onAdd: (product: Product, quantity?: number, color?: string, size?: string) => void
}) {
  const featured = products.filter((product) => product.featured).slice(0, 4)
  return <main>
    <section className="hero-section">
      <div className="hero-copy">
        <p className="eyebrow"><span /> THE ART OF THE FINISHING TOUCH</p>
        <h1>Define your style.<br /><em>Make your statement.</em></h1>
        <p className="hero-subtitle">Discover men's accessories designed for confidence, elegance and distinction.</p>
        <div className="hero-actions"><button className="button button-gold" onClick={onShop}>Shop collection <ArrowRight size={16} /></button><button className="button button-quiet" onClick={() => document.getElementById('best-sellers')?.scrollIntoView({ behavior: 'smooth' })}>Explore featured pieces <ArrowDown size={15} /></button></div>
        <div className="hero-note"><span className="note-line" /> A little detail. A lasting impression.</div>
      </div>
      <div className="hero-art">
        <img src="/images/product-placeholder.svg" alt="Illustrative product photo placeholder — replace with a Mamigloexclusive campaign photo" />
        <div className="hero-image-caption"><span>THE MODERN GENTLEMAN</span><span>01 — 04</span></div>
        <div className="hero-stamp"><span>STYLE</span><b>WITH<br />INTENT</b><span>EST. MMXXIV</span></div>
      </div>
      <div className="hero-index">01 / 04</div>
    </section>

    <section className="editorial-strip"><span>DETAILS THAT DEFINE YOU</span><i /> <span>MADE FOR EVERY OCCASION</span><i /> <span>YOUR STYLE, YOUR STORY</span></section>

    <section className="section category-section" id="categories">
      <SectionHeading kicker="A PLACE FOR EVERYTHING" title="Shop by category" action="View all categories" onAction={onShop} />
      <div className="category-grid">{storeCategories.map((name, index) => (
        <button className="category-card" key={name} onClick={() => onCategory(name)}>
          <span className="category-number">{String(index + 1).padStart(2, '0')}</span>
          <span className="category-title">{name}</span><ArrowUpRight size={15} />
        </button>
      ))}</div>
    </section>

    <section className="featured-section" id="best-sellers">
      <div className="section featured-inner">
        <SectionHeading kicker="THE SIGNATURE EDIT" title="Featured pieces" action="Shop the collection" onAction={onShop} light />
        {loading ? <Loading light /> : <ProductGrid products={featured} onDetails={onDetails} onAdd={onAdd} light />}
        {!loading && !featured.length && <p className="section-empty">New pieces are on their way. Check back soon.</p>}
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
        <img loading="lazy" src={productImage(product.imageUrl)} alt={product.demo ? `${product.name} — demo product photo placeholder` : product.name} />
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
  return <main className="content-page product-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15} /> {product.category}</button>
    <div className="product-detail-layout">
      <div className="product-detail-media"><div className="product-detail-visual"><img src={productImage(selectedImage)} alt={product.demo ? `${product.name} — demo product photo placeholder` : product.name} />{product.demo && <span className="product-demo-label">BUSINESS PHOTO PLACEHOLDER</span>}</div>{images.length > 1 && <div className="product-gallery" aria-label="Product images">{images.map((image, index) => <button className={selectedImage === image ? 'selected' : ''} key={`${image}-${index}`} onClick={() => setSelectedImage(image)} aria-label={`Show product image ${index + 1}`}><img src={productImage(image)} alt="" /></button>)}</div>}</div>
      <section className="product-detail-copy"><p className="eyebrow">{product.category.toUpperCase()}</p><h1>{product.name}</h1><p className="product-detail-sku">REF. {product.sku}</p><p className="product-detail-price">{formatNGN(product.salePriceNGN ?? product.priceNGN)}{product.salePriceNGN && <del>{formatNGN(product.priceNGN)}</del>}</p><p className="product-detail-description">{product.description}</p>
        <div className="variation-row"><strong>Colour</strong><div className="variation-options">{product.colors.map((value) => <button className={color === value ? 'selected' : ''} key={value} onClick={() => setColor(value)}>{value}</button>)}</div></div>
        {Boolean(product.sizes?.length) && <div className="variation-row"><strong>Size</strong><div className="variation-options">{product.sizes?.map((value) => <button className={size === value ? 'selected' : ''} key={value} onClick={() => setSize(value)}>{value}</button>)}</div></div>}
        <p className={`availability ${product.stockQuantity ? 'stock-available' : 'stock-unavailable'}`}>{product.stockQuantity ? `${product.stockQuantity} available` : 'Currently unavailable'}</p>
        <div className="product-detail-actions"><div className="quantity-control"><span>Quantity</span><button onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Reduce quantity"><Minus size={15} /></button><b>{quantity}</b><button onClick={() => setQuantity(Math.min(product.stockQuantity, quantity + 1))} aria-label="Increase quantity"><Plus size={15} /></button></div><button className="button button-dark" disabled={!product.available || product.stockQuantity < 1} onClick={() => onAdd(product, quantity, color || undefined, size || undefined)}>Add to bag <ShoppingBag size={16} /></button></div>
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

function CheckoutForm({ cart, products, deliveryFeeNGN, error, onSubmit, onBack }: {
  cart: CartItem[]; products: Product[]; deliveryFeeNGN: number; error: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onBack: () => void
}) {
  const total = subtotal(cart, products)
  if (cart.length === 0) return <EmptyState title="Your bag is empty." text="Add a piece to your bag before checkout." action="Browse the collection" onAction={onBack} />
  return <div className="checkout-layout">
    <div className="checkout-main"><button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Continue shopping</button><p className="eyebrow">A FEW DETAILS</p><h1>Let's get your order started.</h1><p className="checkout-helper">We'll confirm your order and delivery details with you directly.</p>
      <form className="checkout-form" onSubmit={onSubmit}>
        <div className="form-two"><Field label="Full name" name="fullName" required autoComplete="name" /><Field label="Phone number" name="phone" type="tel" required autoComplete="tel" placeholder="+234" /><Field label="Email address" name="email" type="email" autoComplete="email" placeholder="Optional" /><Field label="State" name="state" required autoComplete="address-level1" /></div>
        <Field label="City / town" name="city" required autoComplete="address-level2" /><Field label="Delivery address" name="address" required autoComplete="street-address" />
        <label className="field"><span>Preferred delivery method</span><select name="deliveryMethod" required defaultValue=""><option value="" disabled>Select a preference</option><option>Courier delivery</option><option>Pickup / collection</option><option>Discuss with me</option></select></label>
        <label className="field"><span>Additional instructions <small>Optional</small></span><textarea name="instructions" rows={3} maxLength={1000} placeholder="Anything we should know about your order?" /></label>
        {error && <ErrorNotice message={error} />}
        <button className="button button-dark full-width" type="submit">Review order & continue <ArrowRight size={16} /></button>
        <p className="form-legal">Submitting creates a pending order for review. No payment is collected or confirmed on this website.</p>
      </form>
    </div>
    <aside className="checkout-summary"><p className="eyebrow">ORDER SUMMARY</p>{cart.map((item, index) => {
      const product = products.find(({ id }) => id === item.productId)
      if (!product) return null
      return <div className="summary-item" key={`${item.productId}-${index}`}><img src={productImage(product.imageUrl)} alt="" /><div><strong>{product.name}</strong><span>{item.quantity} × {formatNGN(product.salePriceNGN ?? product.priceNGN)}</span></div><b>{formatNGN((product.salePriceNGN ?? product.priceNGN) * item.quantity)}</b></div>
    })}<div className="summary-total"><div><span>Subtotal</span><b>{formatNGN(total)}</b></div><div><span>Default delivery</span><b>{formatNGN(deliveryFeeNGN)}</b></div><div className="grand-total"><span>Estimated total</span><b>{formatNGN(total + deliveryFeeNGN)}</b></div></div><p className="secure-note"><Sparkles size={15} /> Delivery may vary by destination and will be confirmed by our team. No online payment is collected.</p></aside>
  </div>
}

function OrderPending({ order, message, onShop }: { order: StoreOrder; message: string; onShop: () => void }) {
  return <section className="order-pending"><div className="success-mark"><Check /></div><p className="eyebrow">ORDER REQUEST CREATED</p><h1>Thank you, {order.customer.fullName.split(' ')[0]}.</h1><p>Your request <strong>{order.reference}</strong> is pending. To continue, open WhatsApp, review the pre-filled details and tap <strong>Send</strong>. Our team will confirm availability, delivery and payment arrangements.</p>
    <div className="order-review">{order.lines.map((line) => <div key={`${line.productId}-${line.color}-${line.size}`}><span>{line.name}{line.color ? ` · ${line.color}` : ''} × {line.quantity}</span><strong>{formatNGN(line.unitPriceNGN * line.quantity)}</strong></div>)}<div><span>Subtotal</span><strong>{formatNGN(order.subtotalNGN)}</strong></div><div><span>Delivery</span><span>To be confirmed</span></div><div className="order-total"><strong>Total before delivery confirmation</strong><strong>{formatNGN(order.totalNGN)}</strong></div></div>
    <a className="button button-gold full-width" href={whatsAppLink(message)} target="_blank" rel="noreferrer">Continue in WhatsApp <ArrowUpRight size={16} /></a>
    <p className="form-legal">This opens a message draft only. Your order is not paid or confirmed until you send the message and our team responds.</p><button className="text-link" onClick={onShop}>Return to the collection <ArrowRight size={15} /></button>
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

function Field({ label, name, type = 'text', required = false, autoComplete, placeholder }: {
  label: string; name: string; type?: string; required?: boolean; autoComplete?: string; placeholder?: string
}) {
  return <label className="field"><span>{label}{required && <b> *</b>}</span><input name={name} type={type} required={required} autoComplete={autoComplete} placeholder={placeholder} /></label>
}

function Footer({ navigate }: { navigate: (page: Page, category?: Category | '') => void }) {
  return <footer className="site-footer"><div className="footer-main"><div className="footer-brand"><button className="brand-mark" onClick={() => navigate('home')}><span className="brand-monogram">M</span><span className="brand-name">MAMIGLO<span>EXCLUSIVE</span></span></button><p>Men's accessories for confidence, elegance and distinction.</p><div className="footer-social"><a href={storeConfig.instagram} target="_blank" rel="noreferrer">Instagram <ArrowUpRight size={12} /></a><a href={storeConfig.facebook} target="_blank" rel="noreferrer">Facebook <ArrowUpRight size={12} /></a></div></div>
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
