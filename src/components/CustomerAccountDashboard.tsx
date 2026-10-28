import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowRight, ArrowUpRight, BookUser, Check, ChevronLeft, ChevronRight, CircleUserRound,
  Clock3, Heart, Home, LockKeyhole, LogOut, MapPin, Menu, Package,
  Pencil, Plus, RotateCw, ShieldCheck, ShoppingBag, Trash2, Truck, UserRound, X,
} from 'lucide-react'
import { storeApi } from '../api'
import { formatNGN, whatsAppLink } from '../config'
import { getAuthRedirectUrl, supabase } from '../supabase'
import type { CustomerAddress, CustomerAddressInput, CustomerWishlistEntry, Product, StoreOrder } from '../types'
import { cloudinaryImageUrl } from '../cloudinary'

type AccountSection = 'overview' | 'orders' | 'details' | 'addresses' | 'wishlist' | 'security'
type OrderFilter = 'All' | 'Pending' | 'Confirmed' | 'Processing' | 'Ready for Dispatch' | 'Shipped' | 'Delivered' | 'Completed' | 'Cancelled'

interface CustomerAccountDashboardProps {
  email: string
  products: Product[]
  cartItemCount: number
  onAddToCart: (product: Product) => void
  onNavigate: (target: 'home' | 'shop' | 'checkout' | 'contact' | 'returns') => void
  onOpenProduct: (product: Product) => void
  onUseAddress: (address: CustomerAddressInput) => void
  onOpenCart: () => void
  onSignOut: () => Promise<void>
}

const emptyAddress = (): CustomerAddressInput => ({
  recipientName: '', phone: '', country: 'Nigeria', state: '', city: '', streetAddress: '',
  additionalDirections: '', postalCode: '',
})

const accountNav: Array<{ id: AccountSection; label: string; icon: typeof Home; group: string }> = [
  { id: 'overview', label: 'Overview', icon: Home, group: 'MY ACCOUNT' },
  { id: 'orders', label: 'My orders', icon: Package, group: 'MY ACCOUNT' },
  { id: 'wishlist', label: 'Wishlist', icon: Heart, group: 'MY ACCOUNT' },
  { id: 'details', label: 'Personal information', icon: UserRound, group: 'MY DETAILS' },
  { id: 'addresses', label: 'Address book', icon: MapPin, group: 'MY DETAILS' },
  { id: 'security', label: 'Security', icon: LockKeyhole, group: 'MY DETAILS' },
]

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}

function orderStatusClass(status: string) {
  return `customer-status customer-status--${status.toLowerCase().replaceAll(' ', '-')}`
}

function paymentStatusClass(status: string) {
  return `customer-status customer-status--${status.toLowerCase().replaceAll(' ', '-')}`
}

function formatPaymentReviewStatus(order: StoreOrder) {
  if (order.paymentMethod === 'opay_transfer' && order.paymentStatus === 'Pending') {
    return 'Awaiting Payment'
  }
  if (order.paymentStatus === 'Pending Verification') {
    return 'Pending Verification'
  }
  if (order.paymentStatus === 'Paid') {
    return 'Payment Confirmed'
  }
  if (order.paymentStatus === 'Rejected') {
    return 'Failed'
  }
  if (order.paymentStatus === 'Pending') return 'Unpaid'
  return order.paymentStatus || 'Pending'
}

function orderProgress(status: StoreOrder['status'], history: StoreOrder['statusHistory']) {
  const steps: Array<{ label: string; icon: typeof Package }> = [
    { label: 'Placed', icon: Check },
    { label: 'Confirmed', icon: Check },
    { label: 'Processing', icon: Package },
    { label: 'Ready for Dispatch', icon: Package },
    { label: 'Shipped', icon: Truck },
    { label: 'Delivered', icon: Home },
    { label: 'Completed', icon: Check },
  ]
  const statusToStep: Record<string, number> = {
    Pending: 0,
    Confirmed: 1,
    Processing: 2,
    'Ready for Dispatch': 3,
    Shipped: 4,
    Delivered: 5,
    Completed: 6,
  }
  const currentStep = status && status in statusToStep ? statusToStep[status] : -1
  const historyStatuses = [
    ['Pending', 'Confirmed'],
    ['Confirmed'],
    ['Processing'],
    ['Ready for Dispatch'],
    ['Shipped'],
    ['Delivered'],
    ['Completed'],
  ]
  return {
    steps: steps.map((step, index) => ({ ...step, at: history.find((entry) => historyStatuses[index].includes(entry.status))?.at })),
    currentStep,
  }
}

function formatDateTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export function CustomerAccountDashboard({ email, products, cartItemCount, onAddToCart, onNavigate, onOpenProduct, onUseAddress, onOpenCart, onSignOut }: CustomerAccountDashboardProps) {
  const [activeSection, setActiveSection] = useState<AccountSection>('overview')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [profileName, setProfileName] = useState('')
  const [profilePhone, setProfilePhone] = useState('')
  const [profileEmail, setProfileEmail] = useState(email)
  const [orders, setOrders] = useState<StoreOrder[]>([])
  const [addresses, setAddresses] = useState<CustomerAddress[]>([])
  const [wishlist, setWishlist] = useState<CustomerWishlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [ordersError, setOrdersError] = useState('')
  const [addressesError, setAddressesError] = useState('')
  const [wishlistError, setWishlistError] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('All')
  const [orderPage, setOrderPage] = useState(0)
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [addressDraft, setAddressDraft] = useState<CustomerAddressInput>(emptyAddress)
  const [isAddressEditorOpen, setIsAddressEditorOpen] = useState(false)
  const [editingAddressId, setEditingAddressId] = useState('')
  const [confirmDeleteAddressId, setConfirmDeleteAddressId] = useState('')
  const [securityNotice, setSecurityNotice] = useState('')

  async function loadAccount() {
    setLoading(true)
    setOrdersError('')
    setAddressesError('')
    setWishlistError('')
    const results = await Promise.allSettled([
      supabase.auth.getUser(),
      storeApi.customer.orders(),
      storeApi.customer.addresses(),
      storeApi.customer.wishlist(),
    ])

    const [userResult, orderResult, addressResult, wishlistResult] = results
    if (userResult.status === 'fulfilled' && userResult.value.data.user) {
      const user = userResult.value.data.user
      const name = String(user.user_metadata?.full_name || user.user_metadata?.name || '')
      setCustomerName(name || email.split('@')[0] || 'Customer')
      setProfileName(name)
      setProfilePhone(String(user.user_metadata?.phone || ''))
      setProfileEmail(user.email || email)
    } else if (userResult.status === 'fulfilled' && userResult.value.error) {
      setError(userResult.value.error.message)
    } else if (userResult.status === 'rejected') {
      setError(userResult.reason instanceof Error ? userResult.reason.message : 'Your profile could not be loaded.')
    }
    if (orderResult.status === 'fulfilled') setOrders(orderResult.value.orders)
    else setOrdersError(orderResult.reason instanceof Error ? orderResult.reason.message : 'Order history could not be loaded.')
    if (addressResult.status === 'fulfilled') setAddresses(addressResult.value.addresses)
    else setAddressesError(addressResult.reason instanceof Error ? addressResult.reason.message : 'Saved addresses could not be loaded.')
    if (wishlistResult.status === 'fulfilled') setWishlist(wishlistResult.value.items)
    else setWishlistError(wishlistResult.reason instanceof Error ? wishlistResult.reason.message : 'Your wishlist could not be loaded.')
    setLoading(false)
  }

  useEffect(() => {
    let active = true
    let orderChannel: ReturnType<typeof supabase.channel> | null = null
    setOrders([])
    setAddresses([])
    setWishlist([])
    setSelectedOrderId('')
    void loadAccount()
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return
      if (error) {
        setOrdersError(error.message)
        return
      }
      if (!data.user) {
        setOrders([])
        return
      }
      const userId = data.user.id
      orderChannel = supabase.channel(`customer-orders:${userId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `customer_user_id=eq.${userId}`,
        }, (payload) => {
          const changedRow = payload.eventType === 'DELETE' ? payload.old : payload.new
          if (!changedRow || typeof changedRow !== 'object' || !('id' in changedRow)) return
          const changedOrderId = String(changedRow.id)
          if (payload.eventType === 'DELETE') {
            setOrders((current) => current.filter((order) => order.id !== changedOrderId))
            return
          }
          void storeApi.customer.order(changedOrderId).then(({ order }) => {
            if (!active) return
            setOrders((current) => {
              if (!order) return current.filter((item) => item.id !== changedOrderId)
              const existingIndex = current.findIndex((item) => item.id === order.id)
              if (existingIndex < 0) {
                return [...current, order].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
              }
              return current.map((item) => item.id === order.id ? order : item)
            })
            setOrdersError('')
          }).catch((reason: unknown) => {
            if (active) setOrdersError(reason instanceof Error ? reason.message : 'The updated order could not be loaded.')
          })
        })
        .subscribe((status) => {
          if (active && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
            setOrdersError('Live order updates are temporarily unavailable. Retry loading your order history.')
          }
        })
    })
    return () => {
      active = false
      if (orderChannel) void supabase.removeChannel(orderChannel)
    }
  }, [email])

  const wishlistProducts = useMemo(() => wishlist
    .map((entry) => products.find((product) => product.id === entry.productId))
    .filter((product): product is Product => Boolean(product)), [products, wishlist])
  const pendingCount = orders.filter((order) => ['Pending', 'Confirmed', 'Processing'].includes(order.status)).length
  const completedCount = orders.filter((order) => order.status === 'Completed').length
  const recentOrders = orders.slice(0, 3)
  const filteredOrders = orders.filter((order) => orderFilter === 'All' || order.status === orderFilter)
  const pageSize = 6
  const orderPageCount = Math.ceil(filteredOrders.length / pageSize)
  const visibleOrders = filteredOrders.slice(orderPage * pageSize, (orderPage + 1) * pageSize)
  const orderCounts: Record<OrderFilter, number> = {
    All: orders.length,
    Pending: orders.filter((order) => order.status === 'Pending').length,
    Confirmed: orders.filter((order) => order.status === 'Confirmed').length,
    Processing: orders.filter((order) => order.status === 'Processing').length,
    'Ready for Dispatch': orders.filter((order) => order.status === 'Ready for Dispatch').length,
    Shipped: orders.filter((order) => order.status === 'Shipped').length,
    Delivered: orders.filter((order) => order.status === 'Delivered').length,
    Completed: orders.filter((order) => order.status === 'Completed').length,
    Cancelled: orders.filter((order) => order.status === 'Cancelled').length,
  }
  const selectedOrder = orders.find((order) => order.id === selectedOrderId)
  useEffect(() => {
    if (orderPageCount === 0 && orderPage !== 0) setOrderPage(0)
    else if (orderPageCount > 0 && orderPage >= orderPageCount) setOrderPage(orderPageCount - 1)
  }, [orderPage, orderPageCount])
  const pageTitle: Record<AccountSection, string> = {
    overview: 'My account', orders: 'My orders', details: 'Personal information',
    addresses: 'Address book', wishlist: 'My wishlist', security: 'Security',
  }
  const initials = customerName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'M'

  function changeSection(section: AccountSection) {
    setActiveSection(section)
    setMobileNavOpen(false)
    setNotice('')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function productImage(productId: string, snapshotUrl?: string) {
    return cloudinaryImageUrl(snapshotUrl || products.find((product) => product.id === productId)?.imageUrl || '/images/product-placeholder.svg', 640)
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = profileName.trim()
    const trimmedPhone = profilePhone.trim()
    if (!trimmedName || trimmedName.length > 120) {
      setError('Enter a name of 1 to 120 characters.')
      return
    }
    if (trimmedPhone && !/^\+?[0-9 ()-]{8,20}$/.test(trimmedPhone)) {
      setError('Enter a valid phone number, or leave it blank.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error: profileError } = await supabase.auth.updateUser({ data: { full_name: trimmedName, phone: trimmedPhone } })
      if (profileError) throw profileError
      setCustomerName(trimmedName)
      setNotice('Your personal information has been saved.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your profile could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function requestEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextEmail = profileEmail.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      setError('Enter a valid email address.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error: emailError } = await supabase.auth.updateUser({ email: nextEmail })
      if (emailError) throw emailError
      setNotice('Check your email and confirm the change before this address becomes active.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your email change could not be started.')
    } finally {
      setBusy(false)
    }
  }

  function startAddressEdit(address?: CustomerAddress) {
    setEditingAddressId(address?.id || '')
    setIsAddressEditorOpen(true)
    setAddressDraft(address ? {
      recipientName: address.recipientName,
      phone: address.phone,
      country: address.country,
      state: address.state,
      city: address.city,
      streetAddress: address.streetAddress,
      additionalDirections: address.additionalDirections,
      postalCode: address.postalCode,
    } : emptyAddress())
    setError('')
    setNotice('')
  }

  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = { ...addressDraft }
    if (!value.recipientName.trim() || !value.streetAddress.trim() || !value.city.trim() || !value.state.trim() || !value.country.trim()) {
      setError('Complete the recipient, street, city, state and country fields.')
      return
    }
    if (!/^\+?[0-9 ()-]{8,20}$/.test(value.phone.trim())) {
      setError('Enter a phone number with 8 to 20 digits, spaces or phone symbols.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { address } = await storeApi.customer.saveAddress(value, editingAddressId || undefined)
      const shouldSetDefault = !editingAddressId && addresses.length === 0
      if (shouldSetDefault) await storeApi.customer.setDefaultAddress(address.id)
      setAddresses((current) => {
        const updated = editingAddressId ? current.map((entry) => entry.id === address.id ? { ...address, isDefault: entry.isDefault } : entry) : [address, ...current]
        return shouldSetDefault ? updated.map((entry) => ({ ...entry, isDefault: entry.id === address.id })) : updated
      })
      setEditingAddressId('')
      setIsAddressEditorOpen(false)
      setAddressDraft(emptyAddress())
      setNotice(editingAddressId ? 'Address updated.' : 'Address saved.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Address could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function setDefaultAddress(id: string) {
    setError('')
    setNotice('')
    try {
      await storeApi.customer.setDefaultAddress(id)
      setAddresses((current) => current.map((address) => ({ ...address, isDefault: address.id === id })))
      setNotice('Default delivery address updated.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Default address could not be updated.')
    }
  }

  async function deleteAddress(id: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await storeApi.customer.removeAddress(id)
      const remaining = addresses.filter((address) => address.id !== id)
      setAddresses(remaining)
      if (addresses.find((address) => address.id === id)?.isDefault && remaining[0]) await setDefaultAddress(remaining[0].id)
      setConfirmDeleteAddressId('')
      setNotice('Address removed.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Address could not be removed.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleWishlist(productId: string, isSaved: boolean) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (isSaved) {
        await storeApi.customer.removeWishlistItem(productId)
        setWishlist((current) => current.filter((entry) => entry.productId !== productId))
        setNotice('Item removed from your wishlist.')
      } else {
        await storeApi.customer.addWishlistItem(productId)
        setWishlist((current) => current.some((entry) => entry.productId === productId)
          ? current
          : [{ id: crypto.randomUUID(), productId, createdAt: new Date().toISOString() }, ...current])
        setNotice('Item saved to your wishlist.')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your wishlist could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  async function requestPasswordReset() {
    setBusy(true)
    setError('')
    setSecurityNotice('')
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: getAuthRedirectUrl('/account') })
      if (resetError) throw resetError
      setSecurityNotice('Password reset instructions have been sent to your email address.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Password reset could not be started.')
    } finally {
      setBusy(false)
    }
  }

  function renderOrderCard(order: StoreOrder, compact = false) {
    const itemCount = order.lines.reduce((count, line) => count + line.quantity, 0)
    return (
      <article className={`customer-order-card ${compact ? 'customer-order-card--compact' : ''}`} key={order.id}>
        <div className="customer-order-card-head">
          <div><span className="customer-order-ref">{order.reference}</span><strong>{formatDate(order.createdAt)}</strong></div>
          <span className={orderStatusClass(order.status)}>{order.status}</span>
        </div>
        <div className="customer-order-lines" aria-label={`${itemCount} items in order ${order.reference}`}>
          {order.lines.map((line, index) => (
            <div className="customer-order-line" key={`${line.productId}-${index}`}>
              <img src={productImage(line.productId, line.imageUrl)} alt={line.name} loading="lazy" />
              <div><strong>{line.name}</strong><span>Qty {line.quantity} · {formatNGN(line.unitPriceNGN)} each</span></div>
              <strong>{formatNGN(line.unitPriceNGN * line.quantity)}</strong>
            </div>
          ))}
        </div>
        <div className="customer-order-card-foot">
          <div><span>Order total</span><strong>{formatNGN(order.totalNGN)}</strong><small>{order.paymentMethod === 'opay_transfer' ? 'OPay transfer' : order.paymentMethod === 'cash_on_delivery' ? 'Cash on delivery' : 'Payment method unavailable'}</small><small>{formatPaymentReviewStatus(order)} payment</small></div>
          <button type="button" className="customer-text-action" onClick={() => { setSelectedOrderId(order.id); changeSection('orders') }}>View order <ArrowRight size={14} /></button>
        </div>
      </article>
    )
  }

  function renderOrderDetails(order: StoreOrder) {
    const { steps, currentStep } = orderProgress(order.status, order.statusHistory)
    return (
      <section className="customer-detail-panel">
        <div className="customer-panel-heading">
          <button type="button" className="customer-back-link" onClick={() => setSelectedOrderId('')}><ChevronLeft size={15} /> All orders</button>
          <span className={orderStatusClass(order.status)}>{order.status}</span>
        </div>
        <div className="customer-detail-title"><p className="eyebrow">ORDER DETAILS</p><h2>{order.reference}</h2><span>Placed {formatDate(order.createdAt)}</span></div>
        {currentStep >= 0 ? <ol className="customer-order-timeline" aria-label={`Order ${order.status}`}>
          {steps.map(({ label, icon: Icon, at }, index) => <li className={index <= currentStep ? 'is-complete' : ''} key={label}><span><Icon size={15} /></span><small>{label}</small>{at && <time>{formatDateTime(at)}</time>}</li>)}
        </ol> : <p className="customer-cancelled-note">This order was cancelled. Contact us if you have questions about its payment or stock release.</p>}
        <div className="customer-detail-items">
          {order.lines.map((line, index) => <div className="customer-detail-item" key={`${line.productId}-${index}`}>
            <img src={productImage(line.productId, line.imageUrl)} alt={line.name} />
            <div><strong>{line.name}</strong><span>{[line.color, line.size, `Quantity ${line.quantity}`].filter(Boolean).join(' · ')}</span></div>
            <strong>{formatNGN(line.unitPriceNGN * line.quantity)}</strong>
          </div>)}
        </div>
        <div className="customer-order-summary">
          <div><span>Subtotal</span><strong>{formatNGN(order.subtotalNGN)}</strong></div>
          <div><span>Delivery</span><strong>{formatNGN(order.deliveryFeeNGN)}</strong></div>
          <div><span>Payment method</span><strong>{order.paymentMethod === 'opay_transfer' ? 'OPay transfer' : order.paymentMethod === 'cash_on_delivery' ? 'Cash on delivery' : 'Not recorded'}</strong></div>
          <div><span>Payment status</span><span className={paymentStatusClass(formatPaymentReviewStatus(order))}>{formatPaymentReviewStatus(order)}</span></div>
          {order.paymentReference && <div><span>Payment reference</span><strong>{order.paymentReference}</strong></div>}
          {order.paymentStatus === 'Paid' && order.paymentConfirmedAt && <div><span>Payment confirmed</span><strong>{formatDateTime(order.paymentConfirmedAt)}</strong></div>}
          {order.paymentMethod === 'opay_transfer' && order.paymentStatus === 'Pending Verification' && (
            <div><span>Review status</span><strong>Our team is reviewing the payment confirmation{order.paymentConfirmationSubmittedAt ? ` submitted ${formatDateTime(order.paymentConfirmationSubmittedAt)}` : ''}.</strong></div>
          )}
          {order.paymentMethod === 'opay_transfer' && order.paymentStatus === 'Rejected' && (
            <div><span>Review result</span><strong>{order.paymentRejectionReason || 'Payment could not be verified.'} Please contact us or retry the transfer.</strong></div>
          )}
          <div className="customer-order-grand-total"><span>{order.paymentStatus === 'Paid' ? 'Amount paid' : 'Amount due'}</span><strong>{formatNGN(order.totalNGN)}</strong></div>
        </div>
        <div className="customer-shipping-address"><p className="eyebrow">DELIVERY ADDRESS</p><strong>{order.customer.fullName}</strong><span>{order.customer.address}</span><span>{order.customer.city}, {order.customer.state}</span><span>{order.customer.phone}</span><span>{order.customer.deliveryMethod}</span></div>
        {(order.shippingCarrier || order.trackingNumber) && <div className="customer-shipping-address"><p className="eyebrow">SHIPMENT</p>{order.shippingCarrier && <strong>{order.shippingCarrier}</strong>}{order.trackingNumber && <span>Tracking: {order.trackingNumber}</span>}{order.shippingUpdatedAt && <span>Updated {formatDateTime(order.shippingUpdatedAt)}</span>}</div>}
        <p className="customer-order-updated">Last order update: {formatDateTime(order.updatedAt)}</p>
        <a className="button button-outline customer-support-link" href={whatsAppLink(`Hello Mamigloexclusive, I need help with order ${order.reference}.`)} target="_blank" rel="noreferrer">Get order support <ArrowUpRight size={15} /></a>
      </section>
    )
  }

  function renderOverview() {
    return <>
      <section className="customer-welcome-band">
        <div className="customer-welcome-avatar">{initials}</div>
        <div><p className="eyebrow">MAMIGLOEXCLUSIVE ACCOUNT</p><h2>Welcome back, {customerName}</h2><p>Your style, your orders, your Mamigloexclusive experience.</p></div>
      </section>
      <section className="customer-account-stats" aria-label="Account summary">
        <article><Package size={17} /><span>Total orders</span><strong>{orders.length}</strong></article>
        <article><Clock3 size={17} /><span>In progress</span><strong>{pendingCount}</strong></article>
        <article><Check size={17} /><span>Delivered</span><strong>{completedCount}</strong></article>
        <article><Heart size={17} /><span>Wishlist</span><strong>{wishlist.length}</strong></article>
      </section>
      <section className="customer-content-panel">
        <div className="customer-panel-heading"><div><p className="eyebrow">YOUR RECENT ACTIVITY</p><h2>Recent orders</h2></div><button type="button" className="customer-text-action" onClick={() => changeSection('orders')}>View all <ArrowRight size={14} /></button></div>
        {ordersError ? <div className="customer-error-state"><p>{ordersError}</p><button type="button" className="button button-outline" onClick={() => void loadAccount()}><RotateCw size={14} /> Retry</button></div>
          : loading ? <div className="customer-skeleton-list"><span /><span /><span /></div>
          : recentOrders.length ? <div className="customer-order-grid">{recentOrders.map((order) => renderOrderCard(order, true))}</div>
          : <div className="customer-empty-state"><ShoppingBag size={24} /><h3>Your first order starts here</h3><p>Explore considered finishing touches for work, celebration and every occasion.</p><button type="button" className="button button-dark" onClick={() => onNavigate('shop')}>Start shopping <ArrowRight size={15} /></button></div>}
      </section>
      <section className="customer-quick-actions">
        <button type="button" onClick={() => changeSection('orders')}><Package size={18} /><span><strong>Track an order</strong><small>Check the latest fulfilment status</small></span><ArrowRight size={15} /></button>
        <button type="button" onClick={() => changeSection('addresses')}><MapPin size={18} /><span><strong>Saved addresses</strong><small>Keep delivery details close</small></span><ArrowRight size={15} /></button>
        <button type="button" onClick={() => changeSection('details')}><CircleUserRound size={18} /><span><strong>Personal details</strong><small>Keep your account up to date</small></span><ArrowRight size={15} /></button>
        <button type="button" onClick={() => onNavigate('shop')}><ShoppingBag size={18} /><span><strong>Continue shopping</strong><small>{cartItemCount ? `${cartItemCount} items in your bag` : 'Explore the collection'}</small></span><ArrowRight size={15} /></button>
      </section>
      {products.length > 0 && <section className="customer-content-panel customer-recommendations">
        <div className="customer-panel-heading"><div><p className="eyebrow">THE COLLECTION</p><h2>Considered finishing touches</h2></div><button type="button" className="customer-text-action" onClick={() => onNavigate('shop')}>Shop all <ArrowRight size={14} /></button></div>
        <div className="customer-product-grid">{products.filter((product) => product.available && product.stockQuantity > 0).slice(0, 4).map((product) => (
          <article className="customer-product-card" key={product.id}><div className="customer-product-visual"><button type="button" className="customer-product-image" onClick={() => onOpenProduct(product)}><img src={product.imageUrl} alt={product.name} loading="lazy" /></button><button type="button" className={`customer-product-save ${wishlist.some((entry) => entry.productId === product.id) ? 'is-saved' : ''}`} aria-label={wishlist.some((entry) => entry.productId === product.id) ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`} disabled={busy} onClick={() => void toggleWishlist(product.id, wishlist.some((entry) => entry.productId === product.id))}><Heart size={15} fill={wishlist.some((entry) => entry.productId === product.id) ? 'currentColor' : 'none'} /></button></div><span>{product.category}</span><strong>{product.name}</strong><b>{formatNGN(product.salePriceNGN ?? product.priceNGN)}</b><button type="button" className="customer-product-add" onClick={() => onAddToCart(product)}>Add to bag <Plus size={13} /></button></article>
        ))}</div>
      </section>}
    </>
  }

  function renderOrders() {
    if (selectedOrder) return renderOrderDetails(selectedOrder)
    const filters: OrderFilter[] = ['All', 'Pending', 'Confirmed', 'Processing', 'Ready for Dispatch', 'Shipped', 'Delivered', 'Completed', 'Cancelled']
    return <section className="customer-content-panel">
      <div className="customer-panel-heading"><div><p className="eyebrow">ORDER HISTORY</p><h2>Every detail, in one place</h2></div><span className="customer-muted-count">{orders.length} orders</span></div>
      <div className="customer-filter-tabs" role="tablist" aria-label="Filter orders">
        {filters.map((filter) => <button type="button" role="tab" aria-selected={orderFilter === filter} className={orderFilter === filter ? 'is-active' : ''} key={filter} onClick={() => { setOrderFilter(filter); setOrderPage(0) }}>{filter} <span className="customer-filter-count">{orderCounts[filter]}</span></button>)}
      </div>
      {ordersError && <div className="customer-error-state"><p>{ordersError}</p><button type="button" className="button button-outline" onClick={() => void loadAccount()}><RotateCw size={14} /> Retry</button></div>}
      {loading ? <div className="customer-skeleton-list"><span /><span /><span /></div>
        : ordersError && !orders.length ? null
        : visibleOrders.length ? <div className="customer-order-grid">{visibleOrders.map((order) => renderOrderCard(order))}</div>
        : <div className="customer-empty-state"><Package size={24} /><h3>{orders.length ? 'No orders in this category' : 'No orders yet'}</h3><p>{orders.length ? 'Choose another order filter to see your history.' : 'Your orders will appear here once you place one.'}</p>{!orders.length && <button type="button" className="button button-dark" onClick={() => onNavigate('shop')}>Explore the collection <ArrowRight size={15} /></button>}</div>}
      {orderPageCount > 1 && <div className="customer-pagination"><span>Page {orderPage + 1} of {orderPageCount}</span><div><button type="button" aria-label="Previous page" disabled={orderPage === 0} onClick={() => setOrderPage((page) => page - 1)}><ChevronLeft size={16} /></button><button type="button" aria-label="Next page" disabled={orderPage + 1 >= orderPageCount} onClick={() => setOrderPage((page) => page + 1)}><ChevronRight size={16} /></button></div></div>}
    </section>
  }

  function renderDetails() {
    return <>
      {error && <div className="error-notice" role="alert">{error}</div>}{notice && <p className="success-message" role="status">{notice}</p>}
      <div className="customer-form-grid">
      <section className="customer-content-panel">
        <div className="customer-panel-heading"><div><p className="eyebrow">YOUR PROFILE</p><h2>Personal information</h2></div><BookUser size={20} /></div>
        <form className="customer-profile-form" onSubmit={saveProfile}>
          <label className="field"><span>Full name</span><input autoComplete="name" maxLength={120} required value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label>
          <label className="field"><span>Phone number</span><input autoComplete="tel" type="tel" value={profilePhone} onChange={(event) => setProfilePhone(event.target.value)} placeholder="+234 800 000 0000" /></label>
          <button className="button button-dark" disabled={busy}>{busy ? 'Saving…' : 'Save details'} <Check size={15} /></button>
        </form>
      </section>
      <section className="customer-content-panel">
        <div className="customer-panel-heading"><div><p className="eyebrow">SIGN-IN ADDRESS</p><h2>Email address</h2></div><ShieldCheck size={19} /></div>
        <p className="customer-form-note">Changing your email requires confirmation. It will not be considered active until you confirm it through Supabase Auth.</p>
        <form className="customer-profile-form" onSubmit={requestEmailChange}>
          <label className="field"><span>Email address</span><input autoComplete="email" type="email" required value={profileEmail} onChange={(event) => setProfileEmail(event.target.value)} /></label>
          <button className="button button-outline" disabled={busy}>{busy ? 'Requesting…' : 'Request email change'} <ArrowRight size={15} /></button>
        </form>
      </section>
      </div>
    </>
  }

  function renderAddresses() {
    return <section className="customer-content-panel">
      <div className="customer-panel-heading"><div><p className="eyebrow">DELIVERY DETAILS</p><h2>Your address book</h2></div><button type="button" className="button button-outline" onClick={() => startAddressEdit()}><Plus size={15} /> Add address</button></div>
      {addressesError && <div className="customer-error-state"><p>{addressesError}</p><button type="button" className="button button-outline" onClick={() => void loadAccount()}><RotateCw size={14} /> Retry</button></div>}
      {error && <div className="error-notice" role="alert">{error}</div>}{notice && <p className="success-message" role="status">{notice}</p>}
      {loading ? <div className="customer-skeleton-list"><span /><span /></div> : addresses.length ? <div className="customer-address-grid">
        {addresses.map((address) => <article className="customer-address-card" key={address.id}>
          <div className="customer-address-top"><strong>{address.recipientName}</strong>{address.isDefault && <span className="customer-default-label">DEFAULT</span>}</div>
          <p>{address.streetAddress}{address.additionalDirections ? `, ${address.additionalDirections}` : ''}</p>
          <span>{address.city}, {address.state}{address.postalCode ? ` ${address.postalCode}` : ''}</span><span>{address.country}</span><span>{address.phone}</span>
          <div className="customer-address-actions"><button type="button" className="customer-text-action" onClick={() => startAddressEdit(address)}><Pencil size={13} /> Edit</button>{!address.isDefault && <button type="button" className="customer-text-action" onClick={() => void setDefaultAddress(address.id)}>Set default</button>}<button type="button" className="customer-text-action customer-delete-action" onClick={() => setConfirmDeleteAddressId(address.id)}><Trash2 size={13} /> Remove</button></div>
          <button type="button" className="customer-use-address" onClick={() => onUseAddress(address)}>Use at checkout <ArrowRight size={14} /></button>
        </article>)}
      </div> : !addressesError && <div className="customer-empty-state"><MapPin size={24} /><h3>No saved addresses</h3><p>Save a delivery address to make your next order quicker.</p><button type="button" className="button button-dark" onClick={() => startAddressEdit()}><Plus size={15} /> Add your first address</button></div>}
      {isAddressEditorOpen ? <div className="customer-address-editor">
        <div className="customer-panel-heading"><div><p className="eyebrow">ADDRESS BOOK</p><h2>{editingAddressId ? 'Edit address' : 'New address'}</h2></div><button type="button" className="customer-icon-action" aria-label="Close address form" onClick={() => { setIsAddressEditorOpen(false); setEditingAddressId(''); setAddressDraft(emptyAddress()) }}><X size={17} /></button></div>
        <form className="customer-address-form" onSubmit={saveAddress}>
          <label className="field"><span>Recipient name</span><input autoComplete="name" maxLength={120} required value={addressDraft.recipientName} onChange={(event) => setAddressDraft({ ...addressDraft, recipientName: event.target.value })} /></label>
          <label className="field"><span>Phone number</span><input autoComplete="tel" type="tel" required value={addressDraft.phone} onChange={(event) => setAddressDraft({ ...addressDraft, phone: event.target.value })} /></label>
          <label className="field customer-field-wide"><span>Street address</span><input autoComplete="street-address" maxLength={400} required value={addressDraft.streetAddress} onChange={(event) => setAddressDraft({ ...addressDraft, streetAddress: event.target.value })} /></label>
          <label className="field"><span>Additional directions</span><input maxLength={400} value={addressDraft.additionalDirections} onChange={(event) => setAddressDraft({ ...addressDraft, additionalDirections: event.target.value })} /></label>
          <label className="field"><span>City</span><input autoComplete="address-level2" required value={addressDraft.city} onChange={(event) => setAddressDraft({ ...addressDraft, city: event.target.value })} /></label>
          <label className="field"><span>State</span><input autoComplete="address-level1" required value={addressDraft.state} onChange={(event) => setAddressDraft({ ...addressDraft, state: event.target.value })} /></label>
          <label className="field"><span>Country</span><input autoComplete="country-name" required value={addressDraft.country} onChange={(event) => setAddressDraft({ ...addressDraft, country: event.target.value })} /></label>
          <label className="field"><span>Postal code <small>Optional</small></span><input autoComplete="postal-code" maxLength={20} value={addressDraft.postalCode} onChange={(event) => setAddressDraft({ ...addressDraft, postalCode: event.target.value })} /></label>
          {error && <div className="error-notice customer-field-wide" role="alert">{error}</div>}
          <div className="customer-address-form-actions customer-field-wide"><button type="button" className="button button-outline" onClick={() => { setIsAddressEditorOpen(false); setEditingAddressId(''); setAddressDraft(emptyAddress()) }}>Cancel</button><button className="button button-dark" disabled={busy}>{busy ? 'Saving…' : 'Save address'} <Check size={15} /></button></div>
        </form>
      </div> : null}
      {confirmDeleteAddressId && <div className="customer-confirm-backdrop" role="presentation" onClick={() => setConfirmDeleteAddressId('')}><section className="customer-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-address-heading" onClick={(event) => event.stopPropagation()}><p className="eyebrow">REMOVE SAVED ADDRESS</p><h2 id="delete-address-heading">Are you sure?</h2><p>This address will be removed from your address book. Existing order records will not change.</p><div><button type="button" className="button button-outline" onClick={() => setConfirmDeleteAddressId('')}>Keep address</button><button type="button" className="button button-dark" disabled={busy} onClick={() => void deleteAddress(confirmDeleteAddressId)}>Remove address</button></div></section></div>}
    </section>
  }

  function renderWishlist() {
    return <section className="customer-content-panel">
      <div className="customer-panel-heading"><div><p className="eyebrow">SAVED FOR LATER</p><h2>Your wishlist</h2></div><span className="customer-muted-count">{wishlist.length} saved</span></div>
      {wishlistError && <div className="customer-error-state"><p>{wishlistError}</p><button type="button" className="button button-outline" onClick={() => void loadAccount()}><RotateCw size={14} /> Retry</button></div>}
      {error && <div className="error-notice" role="alert">{error}</div>}{notice && <p className="success-message" role="status">{notice}</p>}
      {loading ? <div className="customer-skeleton-list"><span /><span /></div> : wishlistProducts.length ? <div className="customer-wishlist-grid">{wishlistProducts.map((product) => {
        const available = product.available && product.stockQuantity > 0
        return <article className="customer-wishlist-card" key={product.id}>
          <button type="button" className="customer-wishlist-image" onClick={() => onOpenProduct(product)}><img src={product.imageUrl} alt={product.name} loading="lazy" /></button>
          <div className="customer-wishlist-info"><span>{product.category}</span><strong>{product.name}</strong><b>{formatNGN(product.salePriceNGN ?? product.priceNGN)}</b>{!available && <small className="customer-unavailable">Currently unavailable</small>}
            <div><button type="button" className="button button-dark" disabled={!available || busy} onClick={() => { onAddToCart(product); void toggleWishlist(product.id, true) }}>{available ? 'Move to bag' : 'Unavailable'} <ShoppingBag size={14} /></button><button type="button" className="customer-icon-action" aria-label={`Remove ${product.name} from wishlist`} disabled={busy} onClick={() => void toggleWishlist(product.id, true)}><Trash2 size={15} /></button></div>
          </div>
        </article>
      })}</div> : wishlist.length && !wishlistError ? <div className="customer-empty-state"><Heart size={24} /><h3>Saved products are no longer available</h3><p>These items are not in the current catalogue.</p></div> : !wishlistError && <div className="customer-empty-state"><Heart size={24} /><h3>Your wishlist is waiting</h3><p>Save pieces you love and return to them when the moment is right.</p><button type="button" className="button button-dark" onClick={() => onNavigate('shop')}>Explore the collection <ArrowRight size={15} /></button></div>}
    </section>
  }

  function renderSecurity() {
    return <section className="customer-content-panel customer-security-panel">
      <div className="customer-panel-heading"><div><p className="eyebrow">ACCOUNT PROTECTION</p><h2>Security and sign-in</h2></div><LockKeyhole size={20} /></div>
      <div className="customer-security-row"><div><strong>Password</strong><span>Request a secure password reset link to your email.</span></div><button type="button" className="button button-outline" disabled={busy} onClick={() => void requestPasswordReset()}>{busy ? 'Sending…' : 'Reset password'} <ArrowRight size={14} /></button></div>
      {securityNotice && <p className="success-message" role="status">{securityNotice}</p>}{error && <div className="error-notice" role="alert">{error}</div>}
      <div className="customer-security-row"><div><strong>Signed-in email</strong><span>{email}</span></div><ShieldCheck size={18} /></div>
      <div className="customer-security-row"><div><strong>Sign out</strong><span>End this session on this device.</span></div><button type="button" className="button button-outline" onClick={() => void onSignOut()}><LogOut size={14} /> Sign out</button></div>
      <p className="customer-form-note">Signing out other sessions and account deletion are not enabled by this project’s current authentication workflows.</p>
    </section>
  }

  return <main className="content-page customer-account-layout">
    <aside className={`customer-account-sidebar ${mobileNavOpen ? 'is-open' : ''}`}>
      <div className="customer-sidebar-profile"><div className="customer-profile-monogram">{initials}</div><div><strong>{customerName || 'Your account'}</strong><span>{email}</span></div></div>
      <nav aria-label="Customer account navigation">
        {['MY ACCOUNT', 'MY DETAILS'].map((group) => <div className="customer-nav-group" key={group}><p>{group}</p>{accountNav.filter((item) => item.group === group).map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={activeSection === id ? 'page' : undefined} className={activeSection === id ? 'is-active' : ''} onClick={() => changeSection(id)}><Icon size={16} /><span>{label}</span>{id === 'wishlist' && <small>{wishlist.length}</small>}</button>)}</div>)}
        <div className="customer-nav-group"><p>SUPPORT</p><button type="button" onClick={() => { setMobileNavOpen(false); onNavigate('contact') }}><ArrowUpRight size={16} /><span>Contact us</span></button><button type="button" onClick={() => { setMobileNavOpen(false); onNavigate('returns') }}><ArrowUpRight size={16} /><span>Returns and refunds</span></button></div>
      </nav>
      <div className="customer-sidebar-bottom"><button type="button" onClick={() => onNavigate('shop')}><ShoppingBag size={16} /> Continue shopping</button><button type="button" onClick={() => void onSignOut()}><LogOut size={16} /> Sign out</button></div>
    </aside>
    {mobileNavOpen && <button type="button" className="customer-account-backdrop" aria-label="Close account navigation" onClick={() => setMobileNavOpen(false)} />}
    <div className="customer-account-main">
      <header className="customer-account-header"><div className="customer-account-header-title"><button type="button" className="customer-mobile-toggle" aria-label="Open account navigation" onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button><div><p className="eyebrow">YOUR ACCOUNT</p><h1>{pageTitle[activeSection]}</h1></div></div><button type="button" className="customer-bag-link" onClick={onOpenCart}><ShoppingBag size={16} /><span>Shopping bag</span>{cartItemCount > 0 && <b>{cartItemCount}</b>}</button></header>
      {error && activeSection !== 'details' && activeSection !== 'addresses' && activeSection !== 'wishlist' && activeSection !== 'security' && <div className="error-notice" role="alert">{error}</div>}
      {notice && activeSection !== 'details' && activeSection !== 'addresses' && activeSection !== 'wishlist' && <p className="success-message" role="status">{notice}</p>}
      <div className="customer-view-content" key={activeSection}>
        {activeSection === 'overview' && renderOverview()}
        {activeSection === 'orders' && renderOrders()}
        {activeSection === 'details' && renderDetails()}
        {activeSection === 'addresses' && renderAddresses()}
        {activeSection === 'wishlist' && renderWishlist()}
        {activeSection === 'security' && renderSecurity()}
      </div>
    </div>
  </main>
}