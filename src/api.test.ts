import { describe, expect, it } from 'vitest'
import { mapOrder } from './api'

describe('order status mapping', () => {
  it('maps administrator archive metadata without changing fulfilment or payment status', () => {
    const order = mapOrder({
      id: 'order-archived',
      reference: 'MG-ARCHIVED',
      customer: { fullName: 'Customer' },
      lines: [],
      fulfilment_status: 'Completed',
      payment_status: 'Paid',
      archived_at: '2026-10-28T12:00:00.000Z',
      archived_by: 'admin-user-id',
    })

    expect(order).toMatchObject({
      status: 'Completed',
      paymentStatus: 'Paid',
      archivedAt: '2026-10-28T12:00:00.000Z',
      archivedBy: 'admin-user-id',
    })
  })

  it('maps every persisted order item and its historical product snapshot', () => {
    const order = mapOrder({
      id: 'order-multiple-items',
      reference: 'MG-MULTI',
      fulfilment_status: 'Pending',
      payment_status: 'Pending',
      payment_method: 'opay_transfer',
      order_items: [
        { product_id: 'tie-1', product_image_url: '/images/classic-tie.jpg', product_name: 'Classic Tie', quantity: 2, unit_price_ngn: 4500 },
        { product_id: 'bow-1', product_image_url: '/images/premium-bow-tie.jpg', product_name: 'Premium Bow Tie', quantity: 1, unit_price_ngn: 5000 },
        { product_id: 'socks-1', product_image_url: '/images/mens-socks.jpg', product_name: "Men's Socks", quantity: 3, unit_price_ngn: 3500 },
      ],
      customer_name: 'Customer',
      customer_phone: '+2348000000000',
      delivery_address: 'Address',
      delivery_state: 'Lagos',
      delivery_city: 'Ikeja',
      delivery_method: 'Courier',
      subtotal_ngn: 24500,
      delivery_fee_ngn: 0,
      total_ngn: 24500,
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T09:00:00.000Z',
    })

    expect(order.lines).toHaveLength(3)
    expect(order.lines).toMatchObject([
      { productId: 'tie-1', imageUrl: '/images/classic-tie.jpg', name: 'Classic Tie', quantity: 2, unitPriceNGN: 4500 },
      { productId: 'bow-1', imageUrl: '/images/premium-bow-tie.jpg', name: 'Premium Bow Tie', quantity: 1, unitPriceNGN: 5000 },
      { productId: 'socks-1', imageUrl: '/images/mens-socks.jpg', name: "Men's Socks", quantity: 3, unitPriceNGN: 3500 },
    ])
    expect(order.lines.reduce((sum, line) => sum + line.quantity * line.unitPriceNGN, 0)).toBe(order.subtotalNGN)
    expect(order.paymentMethod).toBe('opay_transfer')
    expect(order.status).toBe('Pending')
  })

  it('keeps order-item image snapshots with historical product names and prices', () => {
    const order = mapOrder({
      id: 'order-image-snapshot',
      reference: 'MG-SNAPSHOT',
      status: 'Delivered',
      fulfilment_status: 'Delivered',
      payment_status: 'Paid',
      payment_method: 'opay_transfer',
      order_items: [{
        id: 'line-1',
        product_id: null,
        product_image_url: '/api/images/historical-photo.jpg',
        product_name: 'Silk Tie, archived edition',
        quantity: 2,
        unit_price_ngn: 15000,
      }],
      customer_name: 'Customer',
      customer_phone: '+2348000000000',
      delivery_address: 'Address',
      delivery_state: 'Lagos',
      delivery_city: 'Ikeja',
      delivery_method: 'Courier',
      subtotal_ngn: 30000,
      delivery_fee_ngn: 2000,
      total_ngn: 32000,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-03T00:00:00.000Z',
    })

    expect(order.status).toBe('Delivered')
    expect(order.lines[0]).toMatchObject({
      imageUrl: '/api/images/historical-photo.jpg',
      name: 'Silk Tie, archived edition',
      quantity: 2,
      unitPriceNGN: 15000,
    })
    expect(order.totalNGN).toBe(32000)
  })

  it('maps legacy paid orders to pending fulfilment and paid payment status', () => {
    const order = mapOrder({
      id: 'order-1',
      reference: 'MG-LEGACY',
      status: 'Paid',
      status_history: [{ status: 'Paid', at: '2026-01-01T00:00:00.000Z', changedBy: 'admin@example.com' }],
      order_items: [],
      customer_name: 'Customer',
      customer_phone: '+2348000000000',
      delivery_address: 'Address',
      delivery_state: 'Lagos',
      delivery_city: 'Ikeja',
      delivery_method: 'Courier',
      subtotal_ngn: 10000,
      delivery_fee_ngn: 2000,
      total_ngn: 12000,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })

    expect(order.status).toBe('Pending')
    expect(order.paymentStatus).toBe('Paid')
    expect(order.paymentHistory).toEqual([])
  })

  it('keeps fulfilment and payment states independent for migrated orders', () => {
    const order = mapOrder({
      id: 'order-2',
      reference: 'MG-CURRENT',
      status: 'Shipped',
      fulfilment_status: 'Shipped',
      payment_status: 'Refunded',
      payment_method: 'cash_on_delivery',
      status_history: [],
      payment_history: [{ status: 'Refunded', at: '2026-01-02T00:00:00.000Z', changedBy: 'admin@example.com' }],
      order_items: [],
      customer_name: 'Customer',
      customer_phone: '+2348000000000',
      delivery_address: 'Address',
      delivery_state: 'Lagos',
      delivery_city: 'Ikeja',
      delivery_method: 'Courier',
      subtotal_ngn: 10000,
      delivery_fee_ngn: 2000,
      total_ngn: 12000,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    })

    expect(order.status).toBe('Shipped')
    expect(order.paymentStatus).toBe('Refunded')
    expect(order.paymentMethod).toBe('cash_on_delivery')
    expect(order.paymentHistory).toHaveLength(1)
  })

  it('normalizes OPay confirmation and rejection statuses without changing the order status flow', () => {
    const verification = mapOrder({
      id: 'order-3',
      reference: 'MG-OPAY',
      status: 'Pending Payment Verification',
      fulfilment_status: 'Pending',
      payment_status: 'pending_verification',
      payment_method: 'opay_transfer',
      status_history: [],
      payment_history: [],
      order_items: [],
      customer_name: 'Customer',
      customer_phone: '+2348000000000',
      delivery_address: 'Address',
      delivery_state: 'Lagos',
      delivery_city: 'Ikeja',
      delivery_method: 'Courier',
      subtotal_ngn: 10000,
      delivery_fee_ngn: 2000,
      total_ngn: 12000,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    })

    expect(verification.status).toBe('Pending')
    expect(verification.paymentStatus).toBe('Pending Verification')

    const rejected = mapOrder({
      id: 'order-4',
      reference: 'MG-REJECTED',
      status: 'Pending',
      fulfilment_status: 'Pending',
      payment_status: 'rejected',
      payment_method: 'opay_transfer',
      status_history: [],
      payment_history: [],
      order_items: [],
      customer_name: 'Customer',
      customer_phone: '+2348000000000',
      delivery_address: 'Address',
      delivery_state: 'Lagos',
      delivery_city: 'Ikeja',
      delivery_method: 'Courier',
      subtotal_ngn: 10000,
      delivery_fee_ngn: 2000,
      total_ngn: 12000,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    })

    expect(rejected.paymentStatus).toBe('Rejected')
  })

  it('maps Ready for Dispatch and audited payment/shipping details into customer order history', () => {
    const order = mapOrder({
      id: 'order-shipping',
      reference: 'MG-SHIP',
      status: 'Ready for Dispatch',
      fulfilment_status: 'Ready for Dispatch',
      payment_status: 'Paid',
      payment_method: 'opay_transfer',
      payment_reference: 'OP-12345',
      payment_confirmation_submitted_at: '2026-03-01T10:00:00.000Z',
      payment_confirmed_at: '2026-03-01T10:05:00.000Z',
      verifying_admin_id: 'admin-user-id',
      shipping_carrier: 'Courier Co',
      tracking_number: 'TRACK-123',
      shipping_updated_at: '2026-03-02T10:00:00.000Z',
      shipping_updated_by: 'admin-user-id',
      shipping_updated_by_email: 'admin@example.com',
      status_history: [{ status: 'Ready for Dispatch', at: '2026-03-02T10:00:00.000Z', changedBy: 'admin@example.com' }],
      payment_history: [{ status: 'Paid', at: '2026-03-01T10:05:00.000Z', changedBy: 'admin@example.com' }],
      order_items: [],
      customer_name: 'Customer',
      customer_phone: '+2348000000000',
      delivery_address: 'Address',
      delivery_state: 'Lagos',
      delivery_city: 'Ikeja',
      delivery_method: 'Courier',
      subtotal_ngn: 10000,
      delivery_fee_ngn: 2000,
      total_ngn: 12000,
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-02T10:00:00.000Z',
    })

    expect(order).toMatchObject({
      status: 'Ready for Dispatch',
      paymentStatus: 'Paid',
      paymentReference: 'OP-12345',
      paymentConfirmationSubmittedAt: '2026-03-01T10:00:00.000Z',
      paymentConfirmedAt: '2026-03-01T10:05:00.000Z',
      paymentVerifiedBy: 'admin-user-id',
      shippingCarrier: 'Courier Co',
      trackingNumber: 'TRACK-123',
      shippingUpdatedAt: '2026-03-02T10:00:00.000Z',
      shippingUpdatedBy: 'admin@example.com',
      shippingUpdatedById: 'admin-user-id',
    })
  })

  it('keeps Completed separate from Delivered', () => {
    const order = mapOrder({
      id: 'order-completed',
      reference: 'MG-COMPLETED',
      status: 'Completed',
      fulfilment_status: 'Completed',
      payment_status: 'Paid',
      order_items: [],
      customer_name: 'Customer',
      customer_phone: '+2348000000000',
      delivery_address: 'Address',
      delivery_state: 'Lagos',
      delivery_city: 'Ikeja',
      delivery_method: 'Courier',
      subtotal_ngn: 10000,
      delivery_fee_ngn: 2000,
      total_ngn: 12000,
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-02T10:00:00.000Z',
    })

    expect(order.status).toBe('Completed')
    expect(order.status).not.toBe('Delivered')
  })
})
