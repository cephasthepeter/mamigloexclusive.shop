import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Archive, ArrowRight, ArrowUp, Bell, BookOpen, Boxes, Camera, Check, ClipboardList, ImagePlus, LayoutDashboard, LogOut, Menu, Package, Pencil, Plus, RotateCcw, Search, Settings, ShieldCheck, Tag, Trash2, Users, Video, X } from 'lucide-react'
import { ApiError, storeApi } from '../api'
import { formatNGN, storeConfig } from '../config'
import { AdminEligibilityCheckError, AdminNotAuthorizedError, getAdminEligibility, normalizeEmail, signInAdministrator, supabase, supabaseConfigured } from '../supabase'
import type { AdminAccessEntry, Category, OrderStatus, PaymentStatus, Product, StoreOrder } from '../types'
import { categories } from '../types'
import { buildRecentSalesSeries, summarizeDashboardData } from '../dashboard-summary'
import { JournalManagement } from './JournalManagement'
import { HeroCampaignManager } from './HeroCampaignManager'
import { deleteCloudinaryAsset } from '../media'
import type { CloudinaryAsset } from '../media'

const statuses: OrderStatus[] = ['Pending', 'Confirmed', 'Processing', 'Ready for Dispatch', 'Shipped', 'Delivered', 'Completed', 'Cancelled']
const adminOrderFilters: Array<'All' | OrderStatus> = ['All', ...statuses]
const paymentStatuses: PaymentStatus[] = ['Pending', 'Paid', 'Failed', 'Refunded']
const paymentStatusLabel = (status: PaymentStatus) => status === 'Pending' ? 'Unpaid' : status === 'Rejected' ? 'Failed' : status
type AdminView = 'overview' | 'orders' | 'products' | 'categories' | 'inventory' | 'customers' | 'journal' | 'hero' | 'settings' | 'admins'

const emptyProduct = (): Partial<Product> => ({
  sku: '', name: '', description: '', category: categories[0], priceNGN: 0, salePriceNGN: undefined,
  colors: [], sizes: [], imageUrls: [], stockQuantity: 0, featured: false, available: false,
  imageUrl: '/images/product-placeholder.svg',
})

function getAdminAvatarUrl(user: { user_metadata?: { avatar_url?: unknown; picture?: unknown } } | null | undefined) {
  const value = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : ''
  } catch {
    return ''
  }
}

export function AdminDashboard() {
  const [token, setToken] = useState('')
  const [accountEmail, setAccountEmail] = useState('')
  const [adminAvatarUrl, setAdminAvatarUrl] = useState('')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [orphanMediaIds, setOrphanMediaIds] = useState<string[]>([])
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
  const [mediaUploadProgress, setMediaUploadProgress] = useState(0)
  const [mediaUploading, setMediaUploading] = useState(false)
  const [removedMediaIds, setRemovedMediaIds] = useState<string[]>([])
  const mediaUploadController = useRef<AbortController | null>(null)
  const [loading, setLoading] = useState(false)
  const [authorizationState, setAuthorizationState] = useState<'loading' | 'guest' | 'customer' | 'admin' | 'error'>('loading')
  const [activeView, setActiveView] = useState<AdminView>('overview')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [globalSearch, setGlobalSearch] = useState('')
  const [expandedOrderIds, setExpandedOrderIds] = useState<Record<string, boolean>>({})
  const [orderStatusFilter, setOrderStatusFilter] = useState<'All' | OrderStatus>('All')
  const [showArchivedOrders, setShowArchivedOrders] = useState(false)
  const [savingOrderAction, setSavingOrderAction] = useState<{ orderId: string; action: 'fulfilment' | 'payment' | 'shipping' | 'review' | 'archive' | 'restore' } | null>(null)

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
      const orphanMedia = await storeApi.admin.orphanMedia(currentToken)
      setProducts(productResult.products)
      setOrphanMediaIds(orphanMedia.map((asset) => asset.id))
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

  async function changeAdminAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPG, PNG or WebP profile photo.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Profile photos must be 5 MB or smaller.')
      return
    }

    setAvatarUploading(true)
    setError('')
    setNotice('')
    try {
      const avatarUrl = (await storeApi.admin.uploadMedia(token, file, { scope: 'profile' })).secureUrl
      const { error: profileError } = await supabase.auth.updateUser({ data: { avatar_url: avatarUrl } })
      if (profileError) throw profileError
      setAdminAvatarUrl(avatarUrl)
      setNotice('Administrator profile photo updated.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Profile photo could not be updated.')
    } finally {
      setAvatarUploading(false)
    }
  }

  useEffect(() => {
    let active = true
    let authEventReceived = false
    let checkId = 0

    async function checkSession(nextEmail: string, nextToken: string, nextAvatarUrl: string) {
      const currentCheck = ++checkId
      setToken(nextToken)
      setAccountEmail(nextEmail)
      setAdminAvatarUrl(nextAvatarUrl)
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
      void checkSession(session?.user.email || '', session?.access_token || '', getAdminAvatarUrl(session?.user))
    })
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active || authEventReceived) return
      if (sessionError) {
        setError(sessionError.message)
        setAuthorizationState('error')
        return
      }
      void checkSession(data.session?.user.email || '', data.session?.access_token || '', getAdminAvatarUrl(data.session?.user))
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
      const deleteResults = await Promise.allSettled(removedMediaIds.map((id) => deleteCloudinaryAsset(id)))
      const failedDeletes = removedMediaIds.filter((_, index) => deleteResults[index]?.status === 'rejected')
      setProduct(emptyProduct())
      setRemovedMediaIds(failedDeletes)
      setNotice(failedDeletes.length
        ? `Saved ${saved.product.name}; ${failedDeletes.length} image deletion${failedDeletes.length === 1 ? '' : 's'} still need a retry.`
        : `Saved ${saved.product.name}.`)
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
    setMediaUploading(true)
    const controller = new AbortController()
    mediaUploadController.current = controller
    const uploaded: CloudinaryAsset[] = []
    try {
      const selectedFiles = Array.from(files)
      for (const [index, file] of selectedFiles.entries()) {
        uploaded.push(await storeApi.admin.uploadMedia(token, file, {
          scope: 'product',
          signal: controller.signal,
          onProgress: (progress) => setMediaUploadProgress(Math.round(((index + progress / 100) / selectedFiles.length) * 100)),
        }))
      }
      setProduct((current) => {
        const uploadedImages = uploaded.filter((asset) => asset.mediaType === 'image')
        const uploadedVideos = uploaded.filter((asset) => asset.mediaType === 'video')
        const previousGallery = (current.imageUrls || []).filter((url) => url !== current.imageUrl)
        const imageUrls = [...new Set([...uploadedImages.map((asset) => asset.secureUrl), ...previousGallery])]
        return {
          ...current,
          imageUrl: uploadedImages[0]?.secureUrl || current.imageUrl,
          imageUrls,
          imageMedia: [...uploadedImages.map((asset, index) => ({
            id: asset.id, publicId: asset.publicId, url: asset.secureUrl,
            altText: current.name || '', displayOrder: index,
          })), ...(current.imageMedia || [])],
          videoMedia: [...uploadedVideos.map((asset, index) => ({
            id: asset.id, publicId: asset.publicId, url: asset.secureUrl,
            altText: current.name || '', displayOrder: index,
          })), ...(current.videoMedia || [])],
        }
      })
      setNotice(`${uploaded.length} media file${uploaded.length === 1 ? '' : 's'} uploaded. Save the product to apply them.`)
    } catch (reason) {
      await Promise.allSettled(uploaded.map((asset) => deleteCloudinaryAsset(asset.id)))
      setError(reason instanceof Error ? reason.message : 'Image upload failed.')
    } finally {
      mediaUploadController.current = null
      setMediaUploading(false)
      setMediaUploadProgress(0)
    }
  }

  function removeProductMedia(id: string) {
    const media = [...(product.imageMedia || []), ...(product.videoMedia || [])].find((item) => item.id === id)
    if (!media) return
    setRemovedMediaIds((current) => [...new Set([...current, id])])
    setProduct((current) => {
      const imageMedia = (current.imageMedia || []).filter((item) => item.id !== id)
      const videoMedia = (current.videoMedia || []).filter((item) => item.id !== id)
      const imageUrls = (current.imageUrls || []).filter((url) => url !== media.url)
      const imageUrl = current.imageUrl === media.url ? imageMedia[0]?.url || imageUrls[0] || '/images/product-placeholder.svg' : current.imageUrl
      return { ...current, imageMedia, videoMedia, imageUrl, imageUrls }
    })
  }

  function moveProductMedia(id: string, direction: -1 | 1) {
    setProduct((current) => {
      const imageMedia = [...(current.imageMedia || [])]
      const index = imageMedia.findIndex((item) => item.id === id)
      const destination = index + direction
      if (index < 0 || destination < 0 || destination >= imageMedia.length) return current
      ;[imageMedia[index], imageMedia[destination]] = [imageMedia[destination], imageMedia[index]]
      const imageUrls = [current.imageUrl || '', ...imageMedia.map((item) => item.url)].filter(Boolean)
      return { ...current, imageUrl: imageMedia[0]?.url || current.imageUrl, imageMedia, imageUrls: [...new Set(imageUrls)] }
    })
  }

  function setPrimaryProductMedia(id: string) {
    setProduct((current) => {
      const imageMedia = [...(current.imageMedia || [])]
      const index = imageMedia.findIndex((item) => item.id === id)
      if (index < 0) return current
      const [primary] = imageMedia.splice(index, 1)
      imageMedia.unshift(primary)
      return { ...current, imageUrl: primary.url, imageMedia, imageUrls: [primary.url, ...(current.imageUrls || []).filter((url) => url !== primary.url)] }
    })
  }

  async function retryMediaCleanup() {
    const cleanupIds = [...new Set([...removedMediaIds, ...orphanMediaIds])]
    const results = await Promise.allSettled(cleanupIds.map((id) => deleteCloudinaryAsset(id)))
    const failed = cleanupIds.filter((_, index) => results[index]?.status === 'rejected')
    setRemovedMediaIds(failed)
    await refresh()
    setNotice(failed.length ? 'Some media deletions still need another retry.' : 'Unreferenced Cloudinary media removed.')
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

  async function updateStatus(order: StoreOrder, status: OrderStatus) {
    if (status === 'Cancelled' && !window.confirm(`Cancel order ${order.reference}? Reserved stock will be released.`)) return
    if (status === 'Shipped' && !order.shippingCarrier?.trim()) {
      setError('Save a shipping carrier before marking this order as Shipped.')
      return
    }
    if (['Processing', 'Ready for Dispatch', 'Shipped', 'Delivered', 'Completed'].includes(status) &&
      order.paymentMethod === 'opay_transfer' && order.paymentStatus !== 'Paid') {
      setError('Verify the OPay transfer before processing or dispatching this order.')
      return
    }
    setSavingOrderAction({ orderId: order.id, action: 'fulfilment' })
    setError('')
    setNotice('')
    try {
      await storeApi.admin.updateOrder(token, order.id, status)
      setNotice(`Order ${order.reference} updated to ${status}.`)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Order status could not be updated.')
    } finally {
      setSavingOrderAction(null)
    }
  }

  async function setOrderArchived(order: StoreOrder, archived: boolean) {
    const action = archived ? 'archive' : 'restore'
    const verb = archived ? 'Archive' : 'Restore'
    if (!window.confirm(`${verb} order ${order.reference}? ${archived ? 'It will remain in archived history and can be restored later.' : 'It will return to the active order list.'}`)) return
    setSavingOrderAction({ orderId: order.id, action })
    setError('')
    setNotice('')
    try {
      await storeApi.admin.setOrderArchived(token, order.id, archived)
      setNotice(`Order ${order.reference} ${archived ? 'archived' : 'restored'}.`)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Order could not be ${archived ? 'archived' : 'restored'}.`)
    } finally {
      setSavingOrderAction(null)
    }
  }

  async function updatePaymentStatus(order: StoreOrder, status: PaymentStatus) {
    if (status === 'Paid' && order.paymentMethod === 'opay_transfer') {
      setError('OPay payments must be confirmed from the pending verification workflow.')
      return
    }
    if (status === 'Pending Verification' || status === 'Rejected') {
      setError('Use the payment verification actions to submit or reject a manual transfer review.')
      return
    }
    if (status === 'Paid' && !window.confirm(`Confirm that ${formatNGN(order.totalNGN)} was received for ${order.reference} by ${order.customer.fullName}?`)) return
    setSavingOrderAction({ orderId: order.id, action: 'payment' })
    setError('')
    setNotice('')
    try {
      await storeApi.admin.updatePaymentStatus(token, order.id, status)
      setNotice(status === 'Paid' ? `Verified payment recorded for ${order.reference}.` : 'Payment status updated.')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Payment status could not be updated.')
    } finally {
      setSavingOrderAction(null)
    }
  }

  async function handleOpayVerification(orderId: string, action: 'confirm' | 'reject') {
    const order = orders.find((item) => item.id === orderId)
    if (!order) return
    let reason = ''
    try {
      if (action === 'reject') {
        reason = window.prompt('Enter the rejection reason to send to the customer:', 'We could not confirm the transfer in the merchant account.') || ''
        if (!reason || !reason.trim()) {
          setError('A rejection reason is required before rejecting a payment.')
          return
        }
      } else {
        if (order.paymentStatus !== 'Pending Verification') {
          setError('This order is not awaiting payment verification.')
          return
        }
        if (!window.confirm(`Confirm you verified the ${formatNGN(order.totalNGN)} OPay transfer for ${order.reference} against the merchant account?`)) return
      }
      setSavingOrderAction({ orderId, action: 'review' })
      setError('')
      setNotice('')
      await storeApi.admin.reviewPayment(token, orderId, action, reason.trim())
      setNotice(action === 'confirm' ? `Verified OPay payment recorded for ${order.reference}.` : `Payment rejected. Reason: ${reason.trim()}`)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The payment decision could not be saved.')
    } finally {
      setSavingOrderAction(null)
    }
  }

  async function updateShipping(order: StoreOrder, event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const carrier = String(formData.get('carrier') || '').trim()
    const trackingNumber = String(formData.get('trackingNumber') || '').trim()
    setSavingOrderAction({ orderId: order.id, action: 'shipping' })
    setError('')
    setNotice('')
    try {
      await storeApi.admin.updateShipping(token, order.id, carrier, trackingNumber)
      setNotice(`Shipping details saved for ${order.reference}.`)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Shipping details could not be saved.')
    } finally {
      setSavingOrderAction(null)
    }
  }

  async function searchOrders(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await refresh()
  }

  const summary = summarizeDashboardData(
    orders.map((item) => ({ totalNGN: item.totalNGN, paymentStatus: item.paymentStatus, status: item.status })),
    products.map((item) => ({ available: item.available, stockQuantity: item.stockQuantity })),
  )
  const publishedCount = products.filter((item) => item.available).length
  const paidRevenue = summary.totalRevenue
  const recentSales = buildRecentSalesSeries(orders.map((order) => ({
    totalNGN: order.totalNGN,
    paymentStatus: order.paymentStatus,
    status: order.status,
    createdAt: order.createdAt,
  })))
  const customers = Array.from(orders.reduce((result, order) => {
    const key = normalizeEmail(order.customer.email) || order.customer.phone
    const current = result.get(key)
    if (current) {
      current.orderCount += 1
      if (order.paymentStatus === 'Paid' && order.status !== 'Cancelled') current.verifiedSpend += order.totalNGN
      if (Date.parse(order.createdAt) < Date.parse(current.firstOrderAt)) current.firstOrderAt = order.createdAt
    } else {
      result.set(key, {
        key,
        name: order.customer.fullName,
        email: order.customer.email || '',
        phone: order.customer.phone,
        orderCount: 1,
        verifiedSpend: order.paymentStatus === 'Paid' && order.status !== 'Cancelled' ? order.totalNGN : 0,
        firstOrderAt: order.createdAt,
      })
    }
    return result
  }, new Map<string, { key: string; name: string; email: string; phone: string; orderCount: number; verifiedSpend: number; firstOrderAt: string }>()).values())
  const viewTitle: Record<AdminView, string> = {
    overview: 'Dashboard', orders: 'Orders', products: 'Products', categories: 'Categories',
    inventory: 'Inventory', customers: 'Customers', journal: 'The Journal', hero: 'Homepage Hero Manager', settings: 'Store settings', admins: 'Administrators',
  }
  const archivedOrders = orders.filter((order) => Boolean(order.archivedAt))
  const activeOrders = orders.filter((order) => !order.archivedAt)
  const listedOrders = showArchivedOrders ? archivedOrders : activeOrders
  const filteredOrders = listedOrders.filter((order) =>
    (orderStatusFilter === 'All' || order.status === orderStatusFilter) &&
    (!globalSearch || [order.reference, order.customer.fullName, order.customer.phone, order.customer.email].some((value) => value?.toLowerCase().includes(globalSearch.toLowerCase()))))
  const filteredProducts = products.filter((item) => !globalSearch || `${item.name} ${item.sku} ${item.category}`.toLowerCase().includes(globalSearch.toLowerCase()))
  const pendingVerificationOrders = orders.filter((order) => order.paymentMethod === 'opay_transfer' && order.paymentStatus === 'Pending Verification')
  const adminInitials = accountEmail.split('@')[0].split(/[._\-\s]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'A'
  const navItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'orders', label: 'Orders', icon: ClipboardList },
    { id: 'products', label: 'Products', icon: Package },
    { id: 'categories', label: 'Categories', icon: Tag },
    { id: 'inventory', label: 'Inventory', icon: Boxes },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'journal', label: 'The Journal', icon: BookOpen },
    { id: 'hero', label: 'Homepage Hero Manager', icon: Video },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'admins', label: 'Admins', icon: ShieldCheck },
  ] as const

  const toggleOrderExpanded = (orderId: string) => {
    setExpandedOrderIds((current) => ({ ...current, [orderId]: !current[orderId] }))
  }

  const renderActiveView = () => {
    switch (activeView) {
      case 'overview':
        return (
          <>
            <section className="admin-summary-grid" aria-label="Store overview">
              {overviewCards.map((card) => (
                <article className="admin-summary-card" key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <small>{card.note}</small>
                </article>
              ))}
            </section>

            <section className="admin-overview-grid">
              <article className="admin-panel admin-panel-large">
                <div className="admin-panel-header">
                  <div>
                    <p className="eyebrow">Performance</p>
                    <h2>Sales overview</h2>
                  </div>
                  <div className="sales-period-total"><strong>{formatNGN(recentSales.totalRevenue)}</strong><span>Paid sales · last 7 days</span></div>
                </div>
                <div className="admin-chart" role="img" aria-label={`Paid revenue for the last seven days totals ${formatNGN(recentSales.totalRevenue)}.`}>
                  {recentSales.days.map((day) => {
                    const height = recentSales.maxRevenue ? (day.revenue / recentSales.maxRevenue) * 100 : 0
                    return (
                      <div className="admin-chart-column" key={day.dateKey} title={`${day.label}, ${day.dateLabel}: ${formatNGN(day.revenue)}`}>
                        <span className="admin-chart-value">{new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 }).format(day.revenue)}</span>
                        <span className="admin-chart-track"><span className="admin-chart-bar" style={{ height: `${height}%` }} /></span>
                        <span className="admin-chart-day">{day.label}<small>{day.dateLabel}</small></span>
                      </div>
                    )
                  })}
                </div>
              </article>

              <article className="admin-panel">
                <div className="admin-panel-header">
                  <div>
                    <p className="eyebrow">Orders</p>
                    <h2>Status</h2>
                  </div>
                </div>
                <ul className="admin-status-list">
                  {statusBreakdown.map(({ label, count }) => (
                    <li key={label}>
                      <span>{label}</span>
                      <strong>{count}</strong>
                    </li>
                  ))}
                </ul>
              </article>
            </section>

            <section className="admin-panel admin-operations">
              <div className="admin-panel-header">
                <div>
                  <p className="eyebrow">Payment verification</p>
                  <h2>Awaiting OPay review</h2>
                </div>
                <span className="order-count">{pendingVerificationOrders.length} pending</span>
              </div>
              {pendingVerificationOrders.length ? (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Customer</th>
                        <th>Amount</th>
                        <th>Transfer reference</th>
                        <th>Submitted</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingVerificationOrders.map((order) => (
                        <tr key={order.id}>
                          <td>{order.reference}</td>
                          <td>{order.customer.fullName}<br />{order.customer.email || order.customer.phone}</td>
                          <td>{formatNGN(order.totalNGN)}</td>
                          <td>{order.paymentReference || 'Not supplied'}</td>
                          <td>{order.paymentConfirmationSubmittedAt ? new Date(order.paymentConfirmationSubmittedAt).toLocaleString() : 'Not available'}</td>
                          <td><div className="admin-payment-buttons"><button type="button" className="button button-dark" disabled={savingOrderAction?.orderId === order.id} onClick={() => void handleOpayVerification(order.id, 'confirm')}>{savingOrderAction?.orderId === order.id && savingOrderAction.action === 'review' ? 'Verifying…' : 'Confirm Payment'}</button><button type="button" className="button button-outline" disabled={savingOrderAction?.orderId === order.id} onClick={() => void handleOpayVerification(order.id, 'reject')}>Reject Payment</button></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="admin-help">No orders are currently waiting for OPay payment verification.</p>}
            </section>

            <section className="admin-panel admin-operations">
              <div className="admin-panel-header">
                <div>
                  <p className="eyebrow">Operations</p>
                  <h2>Recent orders</h2>
                </div>
                <button type="button" className="text-link">View all</button>
              </div>

              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Total</th>
                      <th>Payment</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.slice(0, 5).map((order) => (
                      <tr key={order.id}>
                        <td>{order.reference}</td>
                        <td>{order.customer.fullName}</td>
                        <td>{formatNGN(order.totalNGN)}</td>
                        <td>{order.paymentStatus}</td>
                        <td><span className="admin-badge">{order.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="admin-grid-two">
              <article className="admin-panel">
                <div className="admin-panel-header">
                  <div>
                    <p className="eyebrow">Catalogue</p>
                    <h2>Low stock alerts</h2>
                  </div>
                </div>
                <ul className="admin-alert-list">
                  {products.filter((item) => item.available && item.stockQuantity > 0 && item.stockQuantity <= 5).slice(0, 4).map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        <span>{item.category}</span>
                      </div>
                      <span className="admin-alert-count">{item.stockQuantity} left</span>
                    </li>
                  ))}
                </ul>
              </article>

              <article className="admin-panel">
                <div className="admin-panel-header">
                  <div>
                    <p className="eyebrow">Retail</p>
                    <h2>Store settings</h2>
                  </div>
                </div>
                <div className="admin-settings-grid">
                  <div className="admin-settings-row"><span>Announcement bar</span><strong>{announcement || 'No active message'}</strong></div>
                  <div className="admin-settings-row"><span>Delivery fee</span><strong>{formatNGN(deliveryFee)}</strong></div>
                  <div className="admin-settings-row"><span>Admin users</span><strong>{adminUsers.length}</strong></div>
                </div>
              </article>
            </section>
          </>
        )

      case 'orders':
        return (
          <section className="admin-section">
            <div className="admin-section-title">
              <div>
                <p className="eyebrow">CUSTOMER REQUESTS</p>
                <h2>Order management</h2>
              </div>
              <span className="order-count">{filteredOrders.length} orders</span>
            </div>
            <div className="order-archive-tabs" role="tablist" aria-label="Order archive view">
              <button type="button" role="tab" aria-selected={!showArchivedOrders} className={!showArchivedOrders ? 'is-active' : ''} onClick={() => { setShowArchivedOrders(false); setOrderStatusFilter('All') }}>Active orders <span>{orders.length}</span></button>
              <button type="button" role="tab" aria-selected={showArchivedOrders} className={showArchivedOrders ? 'is-active' : ''} onClick={() => { setShowArchivedOrders(true); setOrderStatusFilter('All') }}>Archived history <span>{archivedOrders.length}</span></button>
            </div>
            <form className="admin-search" onSubmit={searchOrders}>
              <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone or reference" /></label>
              <button className="button button-dark">Search</button>
            </form>
            <div className="admin-order-filters" role="group" aria-label="Filter orders by status">
              {adminOrderFilters.map((status) => {
                const count = status === 'All' ? listedOrders.length : listedOrders.filter((order) => order.status === status).length
                return <button key={status} type="button" aria-pressed={orderStatusFilter === status} className={orderStatusFilter === status ? 'is-active' : ''} onClick={() => setOrderStatusFilter(status)}>
                  <span>{status === 'All' ? 'All Orders' : status}</span><b>{count}</b>
                </button>
              })}
            </div>
            <div className="orders-list">
              {!filteredOrders.length && <div className="admin-orders-empty">{loading ? 'Loading orders…' : listedOrders.length ? 'No orders match the selected filters.' : showArchivedOrders ? 'No archived orders.' : 'No active orders.'}</div>}
              {filteredOrders.map((order) => {
                const isExpanded = Boolean(expandedOrderIds[order.id])
                return (
                  <article className={`order-card ${isExpanded ? 'is-expanded' : ''}`} key={order.id}>
                    <button type="button" className="order-card-toggle" onClick={() => toggleOrderExpanded(order.id)}>
                      <div className="order-card-toggle-copy">
                        <span className="order-reference">{order.reference}</span>
                        <h3>{order.customer.fullName}</h3>
                        <span>{new Date(order.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="order-card-toggle-meta">
                        <span className="admin-badge">{order.status}</span>
                        <span className="order-card-toggle-icon">{isExpanded ? '−' : '+'}</span>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="order-card-expanded">
                        <div className="order-card-detail">
                          <div>
                            <span>Contact</span>
                            <strong>{order.customer.phone}</strong>
                            <span>{order.customer.email || 'No email provided'}</span>
                            <span>Payment: {order.paymentMethod === 'opay_transfer' ? 'OPay transfer' : order.paymentMethod === 'cash_on_delivery' ? 'Cash on delivery' : 'Legacy order'}</span>
                          </div>
                          <div>
                            <span>Deliver to</span>
                            <strong>{order.customer.address}</strong>
                            <span>{order.customer.city}, {order.customer.state} · {order.customer.deliveryMethod}</span>
                          </div>
                          <div>
                            <span>Items</span>
                            <strong>{order.lines.map((line) => `${line.name} × ${line.quantity}`).join(', ')}</strong>
                            <span>Subtotal {formatNGN(order.subtotalNGN)} · Delivery {formatNGN(order.deliveryFeeNGN)}</span>
                          </div>
                          <div className="order-total-card">
                            <span>Order total</span>
                            <strong>{formatNGN(order.totalNGN)}</strong>
                          </div>
                        </div>
                        <div className="order-card-detail order-payment-detail">
                          <div><span>Payment method</span><strong>{order.paymentMethod === 'opay_transfer' ? 'OPay bank transfer' : order.paymentMethod === 'cash_on_delivery' ? 'Cash on delivery' : 'Legacy order'}</strong></div>
                          <div><span>Payment reference</span><strong>{order.paymentReference || 'Not supplied'}</strong></div>
                          <div><span>Payment status</span><strong>{paymentStatusLabel(order.paymentStatus)}</strong></div>
                          <div><span>Payment confirmed</span><strong>{order.paymentConfirmedAt ? new Date(order.paymentConfirmedAt).toLocaleString() : 'Not confirmed'}</strong></div>
                          {order.paymentConfirmationSubmittedAt && <div><span>Verification submitted</span><strong>{new Date(order.paymentConfirmationSubmittedAt).toLocaleString()}</strong></div>}
                          {order.paymentRejectionReason && <div><span>Rejection reason</span><strong>{order.paymentRejectionReason}</strong></div>}
                        </div>
                        <div className="order-status-controls order-card-controls">
                          <label className="status-select"><span>Fulfilment</span><select disabled={savingOrderAction?.orderId === order.id} value={order.status} onChange={(event) => void updateStatus(order, event.target.value as OrderStatus)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select>{savingOrderAction?.orderId === order.id && savingOrderAction.action === 'fulfilment' && <small role="status">Saving fulfilment…</small>}</label>
                          {order.paymentMethod === 'opay_transfer'
                            ? <div className="status-select"><span>Payment</span><strong>{paymentStatusLabel(order.paymentStatus)}</strong>{order.paymentStatus === 'Pending Verification' && <div className="admin-payment-buttons"><button type="button" className="button button-dark" disabled={savingOrderAction?.orderId === order.id} onClick={() => void handleOpayVerification(order.id, 'confirm')}>Confirm verified transfer</button><button type="button" className="button button-outline" disabled={savingOrderAction?.orderId === order.id} onClick={() => void handleOpayVerification(order.id, 'reject')}>Reject transfer</button>{savingOrderAction?.orderId === order.id && savingOrderAction.action === 'review' && <small role="status">Saving payment decision…</small>}</div>}</div>
                            : <label className="status-select"><span>Payment</span><select disabled={savingOrderAction?.orderId === order.id} value={order.paymentStatus} onChange={(event) => void updatePaymentStatus(order, event.target.value as PaymentStatus)}>{paymentStatuses.filter((status) => status !== 'Paid' || order.status === 'Delivered').map((status) => <option key={status} value={status}>{paymentStatusLabel(status)}</option>)}</select>{savingOrderAction?.orderId === order.id && savingOrderAction.action === 'payment' && <small role="status">Saving payment…</small>}</label>}
                        </div>
                        <div className="order-archive-actions">
                          <button type="button" className="button button-outline" disabled={savingOrderAction?.orderId === order.id} onClick={() => void setOrderArchived(order, !showArchivedOrders)}>
                            {showArchivedOrders ? <RotateCcw size={14} /> : <Archive size={14} />}
                            {savingOrderAction?.orderId === order.id && (savingOrderAction.action === 'archive' || savingOrderAction.action === 'restore') ? 'Saving…' : showArchivedOrders ? 'Restore order' : 'Archive order'}
                          </button>
                        </div>
                        {['Ready for Dispatch', 'Shipped', 'Delivered'].includes(order.status) ? <form className="order-shipping-form" onSubmit={(event) => void updateShipping(order, event)}>
                          <label className="field"><span>Shipping carrier</span><input name="carrier" maxLength={120} defaultValue={order.shippingCarrier || ''} placeholder="Carrier or delivery service" /></label>
                          <label className="field"><span>Tracking number</span><input name="trackingNumber" maxLength={160} defaultValue={order.trackingNumber || ''} placeholder="Tracking reference" /></label>
                          <button type="submit" className="button button-outline" disabled={savingOrderAction?.orderId === order.id}>{savingOrderAction?.orderId === order.id && savingOrderAction.action === 'shipping' ? 'Saving…' : 'Save shipping details'}</button>
                          {order.shippingUpdatedAt && <small>Updated {new Date(order.shippingUpdatedAt).toLocaleString()}{order.shippingUpdatedBy ? ` by ${order.shippingUpdatedBy}` : ''}</small>}
                        </form> : <p className="admin-help order-shipping-help">Carrier and tracking details become available when the order is ready for dispatch.</p>}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </section>
        )

      case 'products':
        return (
          <section className="admin-section">
            <div className="admin-section-title"><div><p className="eyebrow">CATALOGUE</p><h2>{product.id ? 'Edit product' : 'Add a product'}</h2></div>{product.id && <button className="text-link" onClick={() => setProduct(emptyProduct())}>Cancel edit</button>}</div>
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
              <div className="field admin-wide"><span>Product photography</span><div className="image-upload-row"><input aria-label="Primary product photo URL" name="imageUrl" value={product.imageUrl || ''} onChange={(event) => setProduct({ ...product, imageUrl: event.target.value })} /><label className="upload-button"><ImagePlus size={15} />{mediaUploading ? `Uploading ${mediaUploadProgress}%` : 'Upload photos'}<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={mediaUploading} onChange={(event) => void upload(event.target.files)} /></label>{mediaUploading && <button className="table-icon" type="button" aria-label="Cancel media upload" onClick={() => mediaUploadController.current?.abort()}><X size={14} /></button>}</div><small>JPG, PNG or WebP; maximum 10 MB each. Uploads use Cloudinary; existing Supabase image URLs remain supported.</small>{mediaUploading && <progress max="100" value={mediaUploadProgress}>{mediaUploadProgress}%</progress>}{product.imageUrl && <div className="admin-image-preview"><img src={product.imageUrl} alt={`Preview of ${product.name || 'product'}`} /><span>Primary image preview</span></div>}{Boolean(product.imageMedia?.length) && <div className="product-media-list">{product.imageMedia?.map((media, index) => <div className="product-media-item" key={media.id}><img src={media.url} alt={media.altText || ''} /><label className="field"><span>{index === 0 ? 'Primary image alt text' : `Gallery image ${index + 1} alt text`}</span><input maxLength={250} value={media.altText} onChange={(event) => setProduct((current) => ({ ...current, imageMedia: current.imageMedia?.map((item) => item.id === media.id ? { ...item, altText: event.target.value } : item) }))} /></label><button className="table-icon" type="button" aria-label={`Set ${index + 1} as primary image`} disabled={index === 0} onClick={() => setPrimaryProductMedia(media.id)}><Check size={14} /></button><button className="table-icon" type="button" aria-label={`Move image ${index + 1} earlier`} disabled={index === 0} onClick={() => moveProductMedia(media.id, -1)}><ArrowUp size={14} /></button><button className="table-icon danger-icon" type="button" aria-label={`Remove image ${index + 1}`} onClick={() => removeProductMedia(media.id)}><Trash2 size={14} /></button></div>)}</div>}</div>
              <div className="field admin-wide"><span>Product demonstration videos</span><div className="image-upload-row"><label className="upload-button"><Video size={15} />Upload videos<input type="file" accept="video/mp4,video/webm" multiple disabled={mediaUploading} onChange={(event) => void upload(event.target.files)} /></label>{mediaUploading && <button className="table-icon" type="button" aria-label="Cancel media upload" onClick={() => mediaUploadController.current?.abort()}><X size={14} /></button>}</div><small>MP4 or WebM; maximum 50 MB each. Uploads use Cloudinary adaptive delivery.</small>{product.videoMedia?.map((media, index) => <div className="product-video-item" key={media.id}><video src={media.url} controls muted playsInline preload="metadata" /><label className="field"><span>Video description</span><input maxLength={250} value={media.altText} onChange={(event) => setProduct((current) => ({ ...current, videoMedia: current.videoMedia?.map((item) => item.id === media.id ? { ...item, altText: event.target.value } : item) }))} /></label><button className="table-icon danger-icon" type="button" aria-label={`Remove demonstration video ${index + 1}`} onClick={() => removeProductMedia(media.id)}><Trash2 size={14} /></button></div>)}</div>
              <label className="field admin-wide"><span>Gallery photo URLs <small>Comma separated; uploaded photos are added automatically</small></span><textarea name="imageUrls" rows={2} value={(product.imageUrls || []).join(', ')} onChange={(event) => setProduct({ ...product, imageUrls: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
              <div className="admin-checks"><label><input name="available" type="checkbox" checked={product.available ?? false} onChange={(event) => setProduct({ ...product, available: event.target.checked })} /> Available for sale</label><label><input name="featured" type="checkbox" checked={product.featured ?? false} onChange={(event) => setProduct({ ...product, featured: event.target.checked })} /> Featured product</label></div>
              <div className="admin-actions"><button className="button button-dark" disabled={busy}>{busy ? 'Saving…' : product.id ? 'Save changes' : 'Add product'} <Plus size={15} /></button></div>
            </form>
            <div className="category-management"><div><p className="eyebrow">CATEGORY MANAGEMENT</p><h3>Store categories</h3></div><form onSubmit={addCategory}><input aria-label="New category name" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} maxLength={80} required placeholder="Add a category" /><button className="button button-dark">Add category <Plus size={14} /></button></form><div className="managed-categories">{managedCategories.map((name) => <div key={name}><span>{name}</span><button className="table-icon danger-icon" aria-label={`Remove ${name}`} onClick={() => void removeCategory(name)}><Trash2 size={13} /></button></div>)}</div></div>
            <div className="admin-product-list">{filteredProducts.map((item) => <article className="admin-product-row" key={item.id}><img src={item.imageUrl} alt="" /><div className="admin-row-main"><strong>{item.name}</strong><span>{item.sku} · {item.category}</span></div><div className="admin-row-inventory"><strong>{formatNGN(item.salePriceNGN ?? item.priceNGN)}</strong><span>{item.stockQuantity} units · {item.available ? 'Available' : 'Hidden'}</span></div><button className="table-icon" aria-label={`Edit ${item.name}`} onClick={() => setProduct(item)}><Pencil size={15} /></button><button className="table-icon danger-icon" aria-label={`Archive ${item.name}`} onClick={() => void remove(item)}><Trash2 size={15} /></button></article>)}</div>
          </section>
        )

      case 'categories':
        return (
          <section className="admin-section">
            <div className="admin-section-title"><div><p className="eyebrow">STORE TAXONOMY</p><h2>Categories</h2></div></div>
            <div className="category-management premium-box">
              <div><p className="eyebrow">CATEGORY MANAGEMENT</p><h3>Organise your collections</h3></div>
              <form onSubmit={addCategory}><input aria-label="New category name" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} maxLength={80} required placeholder="Add a category" /><button className="button button-dark">Add category <Plus size={14} /></button></form>
              <div className="managed-categories">{managedCategories.map((name) => <div key={name}><span>{name}</span><button className="table-icon danger-icon" aria-label={`Remove ${name}`} onClick={() => void removeCategory(name)}><Trash2 size={13} /></button></div>)}</div>
            </div>
          </section>
        )

      case 'inventory':
        return (
          <section className="admin-section">
            <div className="admin-section-title"><div><p className="eyebrow">STOCK HEALTH</p><h2>Inventory overview</h2></div><span className="order-count">{summary.inStockProducts} in stock</span></div>
            <div className="admin-summary-grid">
              <article className="admin-summary-card"><span>In stock</span><strong>{summary.inStockProducts}</strong><small>{publishedCount} published</small></article>
              <article className="admin-summary-card"><span>Low stock</span><strong>{summary.lowStockProducts}</strong><small>Restock soon</small></article>
              <article className="admin-summary-card"><span>Out of stock</span><strong>{products.length - summary.inStockProducts}</strong><small>Hidden or unavailable</small></article>
            </div>

            <div className="admin-table-wrap inventory-table">
              <table className="admin-table">
                <thead>
                  <tr><th>Product</th><th>Category</th><th>Stock</th><th>Price</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {products.map((item) => (
                    <tr key={item.id}>
                      <td><div className="inventory-product-cell"><img src={item.imageUrl} alt="" /><strong>{item.name}</strong></div></td>
                      <td>{item.category}</td>
                      <td>{item.stockQuantity}</td>
                      <td>{formatNGN(item.salePriceNGN ?? item.priceNGN)}</td>
                      <td><span className="admin-badge">{item.available ? 'available' : 'hidden'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )

      case 'customers':
        return (
          <section className="admin-section">
            <div className="admin-section-title"><div><p className="eyebrow">LOYALTY</p><h2>Customer insights</h2></div><span className="order-count">{customers.length} customers</span></div>
            <div className="customer-list">
              {customers.map((customer) => (
                <article className="customer-card" key={customer.key}>
                  <div>
                    <strong>{customer.name || customer.email || 'Customer'}</strong>
                    <span>{customer.email || customer.phone || 'No email on file'}</span>
                  </div>
                  <div className="customer-meta">
                    <span>{customer.orderCount} orders</span>
                    <span>{formatNGN(customer.verifiedSpend)} spend</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )

      case 'settings':
        return (
          <>
            <section className="admin-section announcement-editor"><div className="admin-section-title"><div><p className="eyebrow">STOREFRONT MESSAGE</p><h2>Announcement bar</h2></div></div><form onSubmit={saveAnnouncement}><label className="field"><span>Announcement text</span><input value={announcement} onChange={(event) => setAnnouncement(event.target.value)} maxLength={200} required /></label><button className="button button-dark">Save announcement</button></form></section>
            <section className="admin-section announcement-editor"><div className="admin-section-title"><div><p className="eyebrow">DELIVERY</p><h2>Default delivery fee</h2></div></div><form onSubmit={saveDeliveryFee}><label className="field"><span>Fee in Nigerian naira</span><input type="number" min="0" step="1" value={deliveryFee} onChange={(event) => setDeliveryFee(Number(event.target.value))} required /></label><button className="button button-dark">Save delivery fee</button></form><p className="admin-help">This is the authoritative checkout fee. Adjust it when destination-specific pricing applies.</p></section>
          </>
        )

      case 'admins':
        return (
          <section className="admin-section">
            <div className="admin-section-title"><div><p className="eyebrow">ACCESS CONTROL</p><h2>Administrator accounts</h2></div><span className="order-count">{adminUsers.length} administrators</span></div>
            <p className="admin-help">This list contains only emails on the administrator allowlist. Customer accounts are not listed here.</p>
            {adminUsersError && <div className="error-notice" role="alert">{adminUsersError}</div>}
            {adminUsersNotice && <p className="success-message" role="status">{adminUsersNotice}</p>}
            {adminUsersLoading ? <p className="admin-loading">Loading administrator accounts…</p> : adminUsers.length ? <div className="admin-access-list">{adminUsers.map((admin) => {
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
            })}</div> : !adminUsersError && <p className="account-empty">No administrator accounts were returned.</p>}
          </section>
        )

      case 'journal':
        return <JournalManagement token={token} products={products} />

      case 'hero':
        return <HeroCampaignManager />

      default:
        return null
    }
  }

  const statusBreakdown = statuses.map((status) => ({
    label: status,
    count: orders.filter((order) => order.status === status).length,
  }))

  const overviewCards = [
    { label: 'Total revenue', value: formatNGN(paidRevenue), note: 'Verified paid orders' },
    { label: 'Total orders', value: String(summary.totalOrders), note: `${summary.openOrders} open` },
    { label: 'Average order value', value: formatNGN(summary.averageOrderValue), note: 'Paid orders only' },
    { label: 'Customers', value: String(customers.length), note: `${customers.filter((customer) => customer.orderCount > 0).length} active` },
    { label: 'In stock', value: String(summary.inStockProducts), note: `${publishedCount} published` },
    { label: 'Low stock alerts', value: String(summary.lowStockProducts), note: 'Restock soon' },
  ]

  if (!supabaseConfigured) return <main className="content-page admin-page"><p className="eyebrow">STORE ADMINISTRATION</p><h1>Administrator access</h1><p>Set the Supabase project URL and publishable key before signing in.</p></main>

  if (authorizationState === 'loading') return <main className="content-page admin-page"><p className="eyebrow">STORE ADMINISTRATION</p><h1>Checking administrator access.</h1><p>Verifying your secure session and permission status…</p></main>

  if (authorizationState === 'error') return <main className="content-page admin-page"><p className="eyebrow">STORE ADMINISTRATION</p><h1>Access could not be verified.</h1>{error && <div className="error-notice" role="alert">{error}</div>}</main>

  if (authorizationState === 'customer') return <main className="content-page admin-page"><p className="eyebrow">STORE ADMINISTRATION</p><h1>Access denied.</h1><p>This account is not currently authorised to manage the store. Please sign in with an approved administrator account.</p>{error && <div className="error-notice" role="alert">{error}</div>}</main>

  if (authorizationState === 'guest' || !token) return <main className="content-page admin-page">
    <p className="eyebrow">STORE ADMINISTRATION</p><h1>Welcome back.</h1>
    <p>Sign in with an authorised business account to manage products and order requests.</p>
    {error && <div className="error-notice" role="alert">{error}</div>}{notice && <p className="success-message" role="status">{notice}</p>}{(removedMediaIds.length > 0 || orphanMediaIds.length > 0) && <button type="button" className="button button-outline" onClick={() => void retryMediaCleanup()}>Retry cleanup ({new Set([...removedMediaIds, ...orphanMediaIds]).size})</button>}
    <form className="admin-signin" onSubmit={signIn}>
      <label className="field"><span>Email address</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      <button className="button button-dark" disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'} <ArrowRight size={16} /></button>
      <button type="button" className="text-link" onClick={requestPasswordReset}>Reset password</button>
    </form>
  </main>

  return <main className="content-page admin-dashboard-shell">
    <aside className={`admin-sidebar ${mobileNavOpen ? 'is-open' : ''}`}>
      <div className="admin-brand">
        <div className="admin-brand-mark">M</div>
        <div>
          <strong>Mamigloexclusive</strong>
          <span>Commerce control centre</span>
        </div>
      </div>

      <nav className="admin-nav" aria-label="Admin pages">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={activeView === id ? 'admin-nav-item is-active' : 'admin-nav-item'}
            aria-current={activeView === id ? 'page' : undefined}
            onClick={() => { setActiveView(id); setMobileNavOpen(false) }}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="admin-sidebar-panel">
        <p className="eyebrow">System status</p>
        <div className="admin-status-row"><span className="admin-status-dot" /><strong>Store online</strong></div>
        <small>Supabase and storefront remain connected.</small>
      </div>
    </aside>

    <div className="admin-main-panel">
      {mobileNavOpen && <button type="button" className="admin-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <header className="admin-topbar">
        <div className="admin-topbar-left">
          <button type="button" className="admin-mobile-toggle" aria-label="Toggle navigation" onClick={() => setMobileNavOpen((current) => !current)}>
            <Menu size={18} />
          </button>
          <div>
            <p className="eyebrow">{viewTitle[activeView] || 'Dashboard'}</p>
            <h1>Good day, {accountEmail.split('@')[0] || 'Admin'}.</h1>
          </div>
        </div>

        <div className="admin-topbar-actions">
          <label className="admin-search-field">
            <Search size={15} />
            <input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Search products or orders" />
          </label>
          <button type="button" className="admin-avatar" aria-label={avatarUploading ? 'Uploading profile photo' : 'Change profile photo'} title={avatarUploading ? 'Uploading profile photo' : 'Change profile photo'} disabled={avatarUploading} onClick={() => avatarInputRef.current?.click()}>
            {adminAvatarUrl ? <img src={adminAvatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setAdminAvatarUrl('')} /> : <span>{adminInitials}</span>}
            <span className="admin-avatar-camera"><Camera size={13} /></span>
          </button>
          <input ref={avatarInputRef} className="admin-avatar-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void changeAdminAvatar(event)} />
          <button type="button" className="icon-button" aria-label="Notifications"><Bell size={16} /></button>
          <button type="button" className="button button-outline" onClick={signOut}><LogOut size={15} /> Sign out</button>
        </div>
      </header>

      {error && <div className="error-notice" role="alert">{error}</div>}
      {notice && <p className="success-message" role="status">{notice}</p>}
      {loading && <p className="admin-loading">Refreshing store data…</p>}

      <div key={activeView} className="admin-view-content">{renderActiveView()}</div>
    </div>
  </main>
}
