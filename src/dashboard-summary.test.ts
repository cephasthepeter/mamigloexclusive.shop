import { describe, expect, it } from 'vitest'
import { buildRecentSalesSeries, summarizeDashboardData } from './dashboard-summary'

describe('dashboard summary metrics', () => {
  it('calculates revenue, order counts, and stock alerts from real order and product data', () => {
    const summary = summarizeDashboardData(
      [
        { totalNGN: 30000, paymentStatus: 'Paid', status: 'Delivered' },
        { totalNGN: 15000, paymentStatus: 'Paid', status: 'Processing' },
        { totalNGN: 12000, paymentStatus: 'Pending', status: 'Pending' },
        { totalNGN: 16000, paymentStatus: 'Paid', status: 'Cancelled' },
      ],
      [
        { available: true, stockQuantity: 10 },
        { available: true, stockQuantity: 5 },
        { available: true, stockQuantity: 1 },
        { available: false, stockQuantity: 0 },
      ],
    )

    expect(summary.totalRevenue).toBe(45000)
    expect(summary.totalOrders).toBe(4)
    expect(summary.averageOrderValue).toBe(11250)
    expect(summary.inStockProducts).toBe(3)
    expect(summary.lowStockProducts).toBe(2)
    expect(summary.openOrders).toBe(2)
  })

  it('builds a seven-day paid revenue series and excludes unpaid, cancelled, and older orders', () => {
    const now = new Date(2026, 9, 26, 12)
    const series = buildRecentSalesSeries([
      { totalNGN: 25000, paymentStatus: 'Paid', status: 'Delivered', createdAt: new Date(2026, 9, 26, 9).toISOString() },
      { totalNGN: 5000, paymentStatus: 'Paid', status: 'Processing', createdAt: new Date(2026, 9, 26, 10).toISOString() },
      { totalNGN: 12000, paymentStatus: 'Pending', status: 'Pending', createdAt: new Date(2026, 9, 25, 9).toISOString() },
      { totalNGN: 8000, paymentStatus: 'Paid', status: 'Cancelled', createdAt: new Date(2026, 9, 25, 9).toISOString() },
      { totalNGN: 9000, paymentStatus: 'Paid', status: 'Delivered', createdAt: new Date(2026, 9, 18, 9).toISOString() },
    ], now)

    expect(series.days).toHaveLength(7)
    expect(series.days[5].revenue).toBe(0)
    expect(series.days[6].revenue).toBe(30000)
    expect(series.totalRevenue).toBe(30000)
    expect(series.maxRevenue).toBe(30000)
  })
})
