import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Check, ImagePlus, LogOut, Pencil, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { ApiError, storeApi } from '../api'
import { formatNGN, storeConfig } from '../config'
import { AdminEligibilityCheckError, AdminNotAuthorizedError, getAdminEligibility, normalizeEmail, signInAdministrator, supabase, supabaseConfigured } from '../supabase'
import type { AdminAccessEntry, Category, OrderStatus, Product, StoreOrder } from '../types'
import { categories } from '../types'

const statuses: OrderStatus[] = ['Pending', 'Awaiting Payment', 'Paid', 'Processing', 'Shipped', 'Delivered', 'Cancelled']

const emptyProduct = (): Partial<Product> => ({
  sku: '', name: '', description: '', category: categories[0], priceNGN: 0, salePriceNGN: undefined,
  colors: [], sizes: [], imageUrls: [], stockQuantity: 0, featured: false, available: false,
  imageUrl: '/images/product-placeholder.svg',
})

export function AdminDashboard() {
  const [token, setToken] = useState('')
  const [accountEmail, setAccountEmail] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [managedCategories, setManagedCategories] = useState<string[]>([...categories])
  const [newCategory, setNewCategory] = useState('')
  const [announcement, setAnnouncement] = useState(storeConfig.announcement)
  const [deliveryFee, setDeliveryFee] = useState(storeConfig.deliveryFeeNGN)
  const [orders, setOrders] = useState<StoreOrder[]>([])
  const [adminUsers, setAdminUsers] = useState<AdminAccessEntry[]>([])
  const [adminUsersLoading, setAdminUsersLoading] = useState(false)
  const [adminUsersError, setAdminUsersError] = useState('')
  const [adminUsersNotice, setAdminUsersNotice] = useState('')
  const [pendingAdminRemoval, setPendingAdminRemoval] = useState('')
  const [removingAdmin, setRemovingAdmin] = useState('')
  const [product, setProduct] = useState<Partial<Product>>(emptyProduct)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [authorizationState, setAuthorizationState] = useState<'loading' | 'guest' | 'customer' | 'admin' | 'error'>('loading')

  async function refresh(currentToken = token) {
    if (!currentToken) return
    setLoading(true)
    setError('')
    try {
      const [productResult, orderResult, categoryResult, configResult] = await Promise.all([
        storeApi.admin.products(currentToken),
        storeApi.admin.orders(currentToken, search),
        storeApi.admin.categories(currentToken),
        storeApi.admin.storeConfig(currentToken),
      ])
      setProducts(productResult.products)
      setOrders(orderResult.orders)
      setManagedCategories(categoryResult.categories)
      setAnnouncement(configResult.announcement)
      setDeliveryFee(configResult.deliveryFeeNGN)
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) setToken('')
      setError(reason instanceof Error ? reason.message : 'Could not load store administration.')
    } finally {
      setLoading(false)
    }
  }

  async function refreshAdminUsers(currentToken = token) {
    if (!currentToken) return
    setAdminUsersLoading(true)
    setAdminUsersError('')
    try {
      const result = await storeApi.admin.adminUsers(currentToken)
      setAdminUsers(result.admins)
    } catch (reason) {
      setAdminUsersError(reason instanceof Error ? reason.message : 'Administrator access list could not be loaded.')
    } finally {
      setAdminUsersLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    let authEventReceived = false
    let checkId = 0

    async function checkSession(nextEmail: string, nextToken: string) {
      const currentCheck = ++checkId
      setToken(nextToken)
      setAccountEmail(nextEmail)
      if (!nextEmail || !nextToken) {
        setAuthorizationState('guest')
        return
      }
      try {
        const eligible = await getAdminEligibility(nextEmail)
        if (active && currentCheck === checkId) setAuthorizationState(eligible ? 'admin' : 'customer')
      } catch (reason) {
        if (active && currentCheck === checkId) {
          setError(reason instanceof Error ? reason.message : 'Administrator access could not be verified.')
          setAuthorizationState('error')
        }
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventReceived = true
      void checkSession(session?.user.email || '', session?.access_token || '')
    })
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active || authEventReceived) return
      if (sessionError) {
        setError(sessionError.message)
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
    if (authorizationState === 'admin' && token) {
      void refresh(token)
      void refreshAdminUsers(token)
    }
  }, [authorizationState, token])

  async function removeAdminUser(admin: AdminAccessEntry) {
    setRemovingAdmin(admin.email)
    setAdminUsersError('')
    setAdminUsersNotice('')
    try {
      await storeApi.admin.removeAdminUser(token, admin.email)
      setPendingAdminRemoval('')
      await refreshAdminUsers(token)
      setAdminUsersNotice(`Administrator access removed for ${admin.email}.`)
    } catch (reason) {
      setAdminUsersError(reason instanceof Error ? reason.message : 'Administrator access could not be removed.')
    } finally {
      setRemovingAdmin('')
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { email: sessionEmail, token: sessionToken } = await signInAdministrator(email, password)
      setToken(sessionToken)
      setAccountEmail(sessionEmail)
      setAuthorizationState('admin')
      setPassword('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Administrator sign-in could not be completed.')
      if (reason instanceof AdminNotAuthorizedError) {
        setAuthorizationState('customer')
        setToken('')
        setAccountEmail('')
      }
      if (reason instanceof AdminEligibilityCheckError) setAuthorizationState('error')
    } finally {
      setBusy(false)
    }
  }

  async function requestPasswordReset() {
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Enter your administrator email address to receive a reset link.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: `${window.location.origin}/admin`,
      })
      if (resetError) throw resetError
      setNotice('Administrator password reset instructions have been sent to your email.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The password reset request could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) setError(signOutError.message)
    setToken('')
    setAccountEmail('')
    setProducts([])
    setOrders([])
  }

  async function saveDeliveryFee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = Number(deliveryFee)
    if (!Number.isSafeInteger(value) || value < 0) {
      setError('Enter a whole-number delivery fee of zero or more.')
      return
    }
    try {
      const result = await storeApi.admin.saveDeliveryFee(token, value)
      setDeliveryFee(result.deliveryFeeNGN)
      setNotice('Default delivery fee updated.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Delivery fee could not be updated.')
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    const form = new FormData(event.currentTarget)
    const colors = String(form.get('colors') || '').split(',').map((value) => value.trim()).filter(Boolean)
    const sizes = String(form.get('sizes') || '').split(',').map((value) => value.trim()).filter(Boolean)
    const priceNGN = Number(form.get('priceNGN'))
    const salePrice = String(form.get('salePriceNGN') || '').trim()
    const parsedSalePrice = salePrice ? Number(salePrice) : undefined
    if (parsedSalePrice !== undefined && (!Number.isSafeInteger(parsedSalePrice) || parsedSalePrice < 0 || parsedSalePrice > priceNGN)) {
      setError('Sale price must be a whole amount between ₦0 and the regular price.')
      return
    }
    const stockQuantity = Number(form.get('stockQuantity'))
    const value: Partial<Product> = {
      ...product,
      sku: String(form.get('sku') || '').trim(),
      name: String(form.get('name') || '').trim(),
      description: String(form.get('description') || '').trim(),
      category: String(form.get('category')) as Category,
      priceNGN,
      ...(salePrice ? { salePriceNGN: Number(salePrice) } : { salePriceNGN: undefined }),
      colors, sizes, stockQuantity,
      imageUrls: String(form.get('imageUrls') || '').split(',').map((value) => value.trim()).filter(Boolean),
      featured: form.get('featured') === 'on',
      available: form.get('available') === 'on',
      imageUrl: String(form.get('imageUrl') || '').trim(),
    }
    setBusy(true)
    try {
      const saved = await storeApi.admin.saveProduct(token, value)
      setProduct(emptyProduct())
      setNotice(`Saved ${saved.product.name}.`)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Product could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setError('')
    setNotice('')
    try {
      const uploaded: string[] = []
      for (const file of Array.from(files)) uploaded.push(await storeApi.admin.uploadImage(token, file))
      setProduct((current) => {
        const imageUrls = [...new Set([...uploaded, ...(current.imageUrls || []), ...(current.imageUrl ? [current.imageUrl] : [])])]
        return {
          ...current,
          imageUrl: uploaded[0],
          imageUrls,
        }
      })
      setNotice(`${uploaded.length} photo${uploaded.length === 1 ? '' : 's'} uploaded. Save the product to apply them.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Image upload failed.')
    }
  }

  async function remove(item: Product) {
    if (!window.confirm(`Delete ${item.name}?`)) return
    try {
      await storeApi.admin.deleteProduct(token, item.id)
      setNotice(`${item.name} deleted.`)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Product could not be deleted.')
    }
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const result = await storeApi.admin.saveCategory(token, newCategory)
      setManagedCategories(result.categories)
      setNewCategory('')
      setNotice('Category added.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Category could not be added.')
    }
  }

  async function saveAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const result = await storeApi.admin.saveStoreConfig(token, announcement)
      setAnnouncement(result.announcement)
      setNotice('Announcement updated.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Announcement could not be updated.')
    }
  }

  async function removeCategory(name: string) {
    if (!window.confirm(`Remove the ${name} category?`)) return
    try {
      const result = await storeApi.admin.deleteCategory(token, name)
      setManagedCategories(result.categories)
      setNotice('Category removed.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Category could not be removed.')
    }
  }

  async function updateStatus(orderId: string, status: OrderStatus) {
    try {
      await storeApi.admin.updateOrder(token, orderId, status)
      setNotice('Order status updated.')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Order status could not be updated.')
    }
  }

  async function searchOrders(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await refresh()
  }

  const publishedCount = products.filter((item) => item.available).length
  const lowStockCount = products.filter((item) => item.available && item.stockQuantity > 0 && item.stockQuantity <= 5).length
  const openOrderCount = orders.filter((item) => !['Cancelled', 'Delivered'].includes(item.status)).length
  const deliveredValue = orders.filter((item) => item.status === 'Delivered').reduce((total, item) => total + item.totalNGN, 0)

  if (!supabaseConfigured) return <main className="content-page admin-page"><p className="eyebrow">STORE ADMINISTRATION</p><h1>Administrator access</h1><p>Set the Supabase project URL and publishable key before signing in.</p></main>

  if (authorizationState === 'loading') return <main className="content-page admin-page"><p className="eyebrow">STORE ADMINISTRATION</p><h1>Checking administrator access.</h1><p>Verifying your secure session and permission status…</p></main>

  if (authorizationState === 'error') return <main className="content-page admin-page"><p className="eyebrow">STORE ADMINISTRATION</p><h1>Access could not be verified.</h1>{error && <div className="error-notice" role="alert">{error}</div>}</main>

  if (authorizationState === 'customer') return <main className="content-page admin-page"><p className="eyebrow">STORE ADMINISTRATION</p><h1>Access denied.</h1><p>This account is not currently authorised to manage the store. Please sign in with an approved administrator account.</p>{error && <div className="error-notice" role="alert">{error}</div>}</main>

  if (authorizationState === 'guest' || !token) return <main className="content-page admin-page">
    <p className="eyebrow">STORE ADMINISTRATION</p><h1>Welcome back.</h1>
    <p>Sign in with an authorised business account to manage products and order requests.</p>
    {error && <div className="error-notice" role="alert">{error}</div>}{notice && <p className="success-message" role="status">{notice}</p>}
    <form className="admin-signin" onSubmit={signIn}>
      <label className="field"><span>Email address</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      <button className="button button-dark" disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'} <ArrowRight size={16} /></button>
      <button type="button" className="text-link" onClick={requestPasswordReset}>Reset password</button>
    </form>
  </main>

  return <main className="content-page admin-dashboard">
    <div className="admin-title"><div><p className="eyebrow">STORE ADMINISTRATION</p><h1>Good day, {accountEmail.split('@')[0] || 'Admin'}.</h1><p>Manage catalogue details and customer order requests.</p></div><button className="button button-outline" onClick={signOut}><LogOut size={15} /> Sign out</button></div>
    {error && <div className="error-notice" role="alert">{error}</div>}
    {notice && <p className="success-message" role="status">{notice}</p>}
    {loading && <p className="admin-loading">Refreshing store data…</p>}
    <section className="admin-metrics" aria-label="Store overview">
      <div><span>Total products</span><strong>{products.length}</strong></div>
      <div><span>Published</span><strong>{publishedCount}</strong></div>
      <div><span>Low stock (5 or fewer)</span><strong>{lowStockCount}</strong></div>
      <div><span>Open orders</span><strong>{openOrderCount}</strong></div>
      <div><span>Delivered order value</span><strong>{formatNGN(deliveredValue)}</strong></div>
    </section>
    <section className="admin-section announcement-editor"><div className="admin-section-title"><div><p className="eyebrow">STOREFRONT MESSAGE</p><h2>Announcement bar</h2></div></div><form onSubmit={saveAnnouncement}><label className="field"><span>Announcement text</span><input value={announcement} onChange={(event) => setAnnouncement(event.target.value)} maxLength={200} required /></label><button className="button button-dark">Save announcement</button></form></section>
    <section className="admin-section announcement-editor"><div className="admin-section-title"><div><p className="eyebrow">DELIVERY</p><h2>Default delivery fee</h2></div></div><form onSubmit={saveDeliveryFee}><label className="field"><span>Fee in Nigerian naira</span><input type="number" min="0" step="1" value={deliveryFee} onChange={(event) => setDeliveryFee(Number(event.target.value))} required /></label><button className="button button-dark">Save delivery fee</button></form><p className="admin-help">This is the authoritative checkout fee. Adjust it when destination-specific pricing applies.</p></section>
    <section className="admin-section">
      <div className="admin-section-title"><div><p className="eyebrow">ACCESS CONTROL</p><h2>Administrator accounts</h2></div><span className="order-count">{adminUsers.length} administrators</span></div>
      <p className="admin-help">This list contains only emails on the administrator allowlist. Customer accounts are not listed here.</p>
      {adminUsersError && <div className="error-notice" role="alert">{adminUsersError}</div>}
      {adminUsersNotice && <p className="success-message" role="status">{adminUsersNotice}</p>}
      {adminUsersLoading ? <p className="admin-loading">Loading administrator accounts…</p> : adminUsers.length ? <div className="admin-access-list">
        {adminUsers.map((admin) => {
          const isCurrentAdmin = normalizeEmail(admin.email) === normalizeEmail(accountEmail)
          const isLastAdmin = adminUsers.length === 1
          const isPendingRemoval = pendingAdminRemoval === admin.email
          return <article className="admin-access-row" key={admin.email}>
            <div className="admin-access-identity"><strong>{admin.email}</strong><span>Added {new Date(admin.createdAt).toLocaleDateString()}</span></div>
            <span className="admin-role"><ShieldCheck size={14} /> Administrator{isCurrentAdmin ? ' · You' : ''}</span>
            {isPendingRemoval ? <div className="admin-access-actions">
              <button type="button" className="button button-outline" onClick={() => setPendingAdminRemoval('')} disabled={Boolean(removingAdmin)}><Check size={14} /> Keep access</button>
              <button type="button" className="button button-danger" onClick={() => void removeAdminUser(admin)} disabled={Boolean(removingAdmin)}><Trash2 size={14} /> {removingAdmin === admin.email ? 'Removing…' : 'Confirm remove'}</button>
            </div> : <button type="button" className="button button-outline" onClick={() => setPendingAdminRemoval(admin.email)} disabled={isCurrentAdmin || isLastAdmin || Boolean(removingAdmin)} title={isCurrentAdmin ? 'Another administrator must remove your access.' : isLastAdmin ? 'The last administrator cannot be removed.' : 'Review and confirm this access change'}>
              {isCurrentAdmin ? 'Current admin' : isLastAdmin ? 'Last admin' : 'Remove access'}
            </button>}
          </article>
        })}
      </div> : !adminUsersError && <p className="account-empty">No administrator accounts were returned.</p>}
    </section>
    <section className="admin-section"><div className="admin-section-title"><div><p className="eyebrow">CATALOGUE</p><h2>{product.id ? 'Edit product' : 'Add a product'}</h2></div>{product.id && <button className="text-link" onClick={() => setProduct(emptyProduct())}>Cancel edit</button>}</div>
      <form className="admin-product-form" onSubmit={save}>
        <label className="field"><span>Product name *</span><input required name="name" maxLength={160} value={product.name || ''} onChange={(event) => setProduct({ ...product, name: event.target.value })} /></label>
        <label className="field"><span>SKU *</span><input required name="sku" maxLength={64} value={product.sku || ''} onChange={(event) => setProduct({ ...product, sku: event.target.value })} /></label>
        <label className="field"><span>Category *</span><select required name="category" value={product.category || managedCategories[0]} onChange={(event) => setProduct({ ...product, category: event.target.value as Category })}>{managedCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label className="field"><span>Price (₦) *</span><input name="priceNGN" type="number" min="0" step="1" required value={product.priceNGN ?? 0} onChange={(event) => setProduct({ ...product, priceNGN: Number(event.target.value) })} /></label>
        <label className="field"><span>Sale price (₦)</span><input name="salePriceNGN" type="number" min="0" max={product.priceNGN ?? 0} step="1" value={product.salePriceNGN ?? ''} onChange={(event) => setProduct({ ...product, salePriceNGN: event.target.value ? Number(event.target.value) : undefined })} /><small>Must not exceed the regular price.</small></label>
        <label className="field"><span>Stock quantity *</span><input name="stockQuantity" type="number" min="0" step="1" required value={product.stockQuantity ?? 0} onChange={(event) => setProduct({ ...product, stockQuantity: Number(event.target.value) })} /></label>
        <label className="field admin-wide"><span>Description *</span><textarea name="description" rows={3} required maxLength={3000} value={product.description || ''} onChange={(event) => setProduct({ ...product, description: event.target.value })} /></label>
        <label className="field"><span>Colours <small>Comma separated</small></span><input name="colors" value={(product.colors || []).join(', ')} onChange={(event) => setProduct({ ...product, colors: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
        <label className="field"><span>Sizes <small>Comma separated</small></span><input name="sizes" value={(product.sizes || []).join(', ')} onChange={(event) => setProduct({ ...product, sizes: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
        <label className="field admin-wide"><span>Primary product photo URL</span><div className="image-upload-row"><input name="imageUrl" value={product.imageUrl || ''} onChange={(event) => setProduct({ ...product, imageUrl: event.target.value })} /><label className="upload-button"><ImagePlus size={15} /> Upload photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void upload(event.target.files)} /></label></div><small>JPG, PNG or WebP; maximum 5 MB each.</small></label>
        <label className="field admin-wide"><span>Gallery photo URLs <small>Comma separated; uploaded photos are added automatically</small></span><textarea name="imageUrls" rows={2} value={(product.imageUrls || []).join(', ')} onChange={(event) => setProduct({ ...product, imageUrls: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
        <div className="admin-checks"><label><input name="available" type="checkbox" checked={product.available ?? false} onChange={(event) => setProduct({ ...product, available: event.target.checked })} /> Available for sale</label><label><input name="featured" type="checkbox" checked={product.featured ?? false} onChange={(event) => setProduct({ ...product, featured: event.target.checked })} /> Featured product</label></div>
        <div className="admin-actions"><button className="button button-dark" disabled={busy}>{busy ? 'Saving…' : product.id ? 'Save changes' : 'Add product'} <Plus size={15} /></button></div>
      </form>
      <div className="category-management"><div><p className="eyebrow">CATEGORY MANAGEMENT</p><h3>Store categories</h3></div><form onSubmit={addCategory}><input aria-label="New category name" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} maxLength={80} required placeholder="Add a category" /><button className="button button-dark">Add category <Plus size={14} /></button></form><div className="managed-categories">{managedCategories.map((name) => <div key={name}><span>{name}</span><button className="table-icon danger-icon" aria-label={`Remove ${name}`} onClick={() => void removeCategory(name)}><Trash2 size={13} /></button></div>)}</div></div>
      <div className="admin-product-list">{products.map((item) => <article className="admin-product-row" key={item.id}><img src={item.imageUrl} alt="" /><div className="admin-row-main"><strong>{item.name}</strong><span>{item.sku} · {item.category}</span></div><div className="admin-row-inventory"><strong>{formatNGN(item.salePriceNGN ?? item.priceNGN)}</strong><span>{item.stockQuantity} units · {item.available ? 'Available' : 'Hidden'}</span></div><button className="table-icon" aria-label={`Edit ${item.name}`} onClick={() => setProduct(item)}><Pencil size={15} /></button><button className="table-icon danger-icon" aria-label={`Archive ${item.name}`} onClick={() => void remove(item)}><Trash2 size={15} /></button></article>)}</div>
    </section>
    <section className="admin-section"><div className="admin-section-title"><div><p className="eyebrow">CUSTOMER REQUESTS</p><h2>Order management</h2></div><span className="order-count">{orders.length} orders</span></div>
      <form className="admin-search" onSubmit={searchOrders}><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone or reference" /></label><button className="button button-dark">Search</button></form>
      <div className="orders-list">{orders.map((order) => <article className="order-card" key={order.id}>
        <div className="order-card-top"><div><span className="order-reference">{order.reference}</span><h3>{order.customer.fullName}</h3><span>{new Date(order.createdAt).toLocaleString()}</span></div><label className="status-select"><span>Status</span><select value={order.status} onChange={(event) => void updateStatus(order.id, event.target.value as OrderStatus)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label></div>
        <div className="order-card-detail"><div><span>Contact</span><strong>{order.customer.phone}</strong><span>{order.customer.email || 'No email provided'}</span></div><div><span>Deliver to</span><strong>{order.customer.address}</strong><span>{order.customer.city}, {order.customer.state} · {order.customer.deliveryMethod}</span></div><div><span>Items</span><strong>{order.lines.map((line) => `${line.name} × ${line.quantity}`).join(', ')}</strong><span>Subtotal {formatNGN(order.subtotalNGN)} · Delivery {formatNGN(order.deliveryFeeNGN)}</span></div><div className="order-total-card"><span>Order total</span><strong>{formatNGN(order.totalNGN)}</strong></div></div>
      </article>)}</div>
    </section>
  </main>
}
