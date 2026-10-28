export type DashboardOrderSummary = {
  totalNGN: number
  paymentStatus?: string
  status?: string
}

export type DashboardProductSummary = {
  available?: boolean
  stockQuantity?: number
}

export type RecentSalesOrder = {
  totalNGN: number
  paymentStatus?: string
  status?: string
  createdAt: string
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function buildRecentSalesSeries(orders: RecentSalesOrder[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - index))
    return {
      dateKey: localDateKey(date),
      label: date.toLocaleDateString('en-NG', { weekday: 'short' }),
      dateLabel: String(date.getDate()),
      revenue: 0,
    }
  })
  const revenueByDate = new Map(days.map((day) => [day.dateKey, day]))

  for (const order of orders) {
    if (order.paymentStatus !== 'Paid' || order.status === 'Cancelled') continue
    const createdAt = new Date(order.createdAt)
    if (Number.isNaN(createdAt.getTime())) continue
    const day = revenueByDate.get(localDateKey(createdAt))
    if (day) day.revenue += Math.max(0, Number(order.totalNGN) || 0)
  }

  return {
    days,
    totalRevenue: days.reduce((total, day) => total + day.revenue, 0),
    maxRevenue: Math.max(0, ...days.map((day) => day.revenue)),
  }
}

export function summarizeDashboardData(
  orders: DashboardOrderSummary[],
  products: DashboardProductSummary[],
) {
  const paidOrders = orders.filter((order) => order.paymentStatus === 'Paid' && order.status !== 'Cancelled')
  const totalRevenue = paidOrders.reduce((sum, order) => sum + Number(order.totalNGN || 0), 0)
  const totalOrders = orders.length
  const averageOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0
  const inStockProducts = products.filter((product) => product.available && Number(product.stockQuantity || 0) > 0).length
  const lowStockProducts = products.filter((product) => product.available && Number(product.stockQuantity || 0) > 0 && Number(product.stockQuantity || 0) <= 5).length
  const openOrders = orders.filter((order) => !['Cancelled', 'Delivered'].includes(order.status || '')).length

  return {
    totalRevenue,
    totalOrders,
    averageOrderValue,
    inStockProducts,
    lowStockProducts,
    openOrders,
  }
}
