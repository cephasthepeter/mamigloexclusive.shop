import { CosmosClient, type Container, type JSONObject } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { demoProducts } from './demo.js'
import { categories, productSchema as zodProductSchema } from './validation.js'
import type { Product, StoreDocument, StoreOrder } from './types.js'

const localPath = () => resolve(process.env.LOCAL_STORE_PATH || resolve(process.cwd(), '.local', 'store.json'))
let cosmosContainer: Container | undefined
let localQueue = Promise.resolve()

function getContainer() {
  if (cosmosContainer) return cosmosContainer
  const endpoint = process.env.COSMOS_ENDPOINT
  if (!endpoint) throw new Error('COSMOS_ENDPOINT is not configured.')
  const client = process.env.COSMOS_KEY
    ? new CosmosClient({ endpoint, key: process.env.COSMOS_KEY })
    : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() })
  cosmosContainer = client.database(process.env.COSMOS_DATABASE || 'mamigloexclusive')
    .container(process.env.COSMOS_CONTAINER || 'store')
  return cosmosContainer
}

async function readLocal(): Promise<StoreDocument[]> {
  try {
    return JSON.parse(await readFile(localPath(), 'utf8')) as StoreDocument[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return []
  }
}

async function writeLocal(documents: StoreDocument[]) {
  const targetPath = localPath()
  await mkdir(dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.tmp`
  await writeFile(tempPath, JSON.stringify(documents, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(tempPath, targetPath)
}

async function localOperation<T>(operation: (documents: StoreDocument[]) => T | Promise<T>): Promise<T> {
  let result!: T
  const next = localQueue.then(async () => {
    const documents = await readLocal()
    result = await operation(documents)
    await writeLocal(documents)
  })
  localQueue = next.catch(() => undefined)
  await next
  return result
}

export async function listDocuments(type: StoreDocument['type']): Promise<StoreDocument[]> {
  if (process.env.COSMOS_ENDPOINT) {
    const { resources } = await getContainer().items.query<StoreDocument>({
      query: 'SELECT * FROM c WHERE c.type = @type',
      parameters: [{ name: '@type', value: type }],
    }).fetchAll()
    return resources
  }
  return localOperation((documents) => documents.filter((document) => document.type === type))
}

export async function findDocument(id: string, type: StoreDocument['type']): Promise<StoreDocument | undefined> {
  if (process.env.COSMOS_ENDPOINT) {
    try {
      const { resource } = await getContainer().item(id, 'store').read<StoreDocument>()
      if (resource?.type !== type) return undefined
      return { ...resource, etag: typeof resource._etag === 'string' ? resource._etag : undefined }
    } catch (error) {
      if ((error as { code?: number }).code === 404) return undefined
      throw error
    }
  }
  return localOperation((documents) => documents.find((document) => document.id === id && document.type === type))
}

export class StockConflictError extends Error {}

function cosmosDocument(document: object): JSONObject {
  const serialized = JSON.parse(JSON.stringify(document)) as JSONObject
  const body = { ...serialized }
  delete body.etag
  delete body._etag
  delete body._rid
  delete body._self
  delete body._attachments
  delete body._ts
  return body
}

function cleanDocumentMetadata(document: StoreDocument): StoreDocument {
  const { etag: _etag, _etag: _systemEtag, _rid, _self, _attachments, _ts, ...body } = document
  return body as StoreDocument
}

export async function createOrderWithStockReservation(
  order: StoreOrder,
  requestedQuantities: Map<string, number>,
): Promise<void> {
  if (process.env.COSMOS_ENDPOINT) {
    const container = getContainer()
    const products: StoreDocument[] = []
    for (const [id, quantity] of requestedQuantities) {
      const document = await findDocument(id, 'product')
      if (!document || Number(document.stockQuantity) < quantity) throw new StockConflictError('Stock has changed.')
      if (!document.etag) throw new Error(`Product ${id} is missing its Cosmos DB ETag.`)
      products.push({
        ...document,
        stockQuantity: Number(document.stockQuantity) - quantity,
      })
    }
    const operations = [
      ...products.map((product) => ({
        operationType: 'Replace' as const,
        id: product.id,
        ifMatch: String(product.etag),
        resourceBody: cosmosDocument(product),
      })),
      {
        operationType: 'Create' as const,
        resourceBody: cosmosDocument({ ...order, type: 'order', partitionKey: 'store' }),
      },
    ]
    const response = await container.items.batch(operations, 'store')
    if (response.code && response.code >= 400 || response.result?.some((operation) => operation.statusCode >= 400)) {
      throw new StockConflictError('The order could not reserve current stock.')
    }
    return
  }

  await localOperation((documents) => {
    const products = [...requestedQuantities.entries()].map(([id, quantity]) => {
      const product = documents.find((document) => document.id === id && document.type === 'product')
      if (!product || Number(product.stockQuantity) < quantity) throw new StockConflictError('Stock has changed.')
      return { product, quantity }
    })
    for (const { product, quantity } of products) {
      product.stockQuantity = Number(product.stockQuantity) - quantity
    }
    documents.push({ ...order, type: 'order', partitionKey: 'store' })
  })
}

export async function cancelOrderAndReleaseStock(order: StoreOrder, actor: string): Promise<StoreOrder> {
  const now = new Date().toISOString()
  const updated: StoreOrder = {
    ...order,
    status: 'Cancelled',
    updatedAt: now,
    inventoryReleasedAt: now,
    statusHistory: [...(order.statusHistory || []), { status: 'Cancelled', at: now, changedBy: actor }],
  }
  const quantities = new Map<string, number>()
  for (const line of order.lines) quantities.set(line.productId, (quantities.get(line.productId) || 0) + line.quantity)

  if (process.env.COSMOS_ENDPOINT) {
    const orderDocument = await findDocument(order.id, 'order')
    if (!orderDocument?.etag) throw new Error('The order is missing its Cosmos DB ETag.')
    const products: StoreDocument[] = []
    for (const [id, quantity] of quantities) {
      const product = await findDocument(id, 'product')
      if (!product || !product.etag) throw new StockConflictError('A product in this order is no longer available to restore.')
      products.push({ ...product, stockQuantity: Number(product.stockQuantity) + quantity })
    }
    const operations = [
      ...products.map((product) => ({
        operationType: 'Replace' as const,
        id: product.id,
        ifMatch: String(product.etag),
        resourceBody: cosmosDocument(product),
      })),
      {
        operationType: 'Replace' as const,
        id: orderDocument.id,
        ifMatch: String(orderDocument.etag),
        resourceBody: cosmosDocument({ ...updated, type: 'order', partitionKey: 'store' }),
      },
    ]
    const response = await getContainer().items.batch(operations, 'store')
    if (response.code && response.code >= 400 || response.result?.some((operation) => operation.statusCode >= 400)) {
      throw new StockConflictError('The order changed while inventory was being restored. Refresh and try again.')
    }
    return updated
  }

  await localOperation((documents) => {
    const orderIndex = documents.findIndex((document) => document.id === order.id && document.type === 'order')
    if (orderIndex < 0) throw new StockConflictError('The order no longer exists.')
    const products = [...quantities.entries()].map(([id, quantity]) => {
      const product = documents.find((document) => document.id === id && document.type === 'product')
      if (!product) throw new StockConflictError('A product in this order is no longer available to restore.')
      return { product, quantity }
    })
    for (const { product, quantity } of products) product.stockQuantity = Number(product.stockQuantity) + quantity
    documents[orderIndex] = { ...updated, type: 'order', partitionKey: 'store' }
  })
  return updated
}

export async function saveDocument(document: StoreDocument): Promise<void> {
  if (process.env.COSMOS_ENDPOINT) {
    await getContainer().items.upsert(document)
    return
  }
  await localOperation((documents) => {
    const index = documents.findIndex((item) => item.id === document.id)
    if (index < 0) documents.push(document)
    else documents[index] = document
  })
}

export async function deleteDocument(id: string): Promise<void> {
  if (process.env.COSMOS_ENDPOINT) {
    try {
      await getContainer().item(id, 'store').delete()
    } catch (error) {
      if ((error as { code?: number }).code !== 404) throw error
    }
    return
  }
  await localOperation((documents) => {
    const index = documents.findIndex((item) => item.id === id)
    if (index >= 0) documents.splice(index, 1)
  })
}

export async function getCategoryNames(): Promise<string[]> {
  const document = await findDocument('catalogue-categories', 'categories')
  const stored = document?.categories
  if (Array.isArray(stored) && stored.every((category) => typeof category === 'string')) return stored
  return [...categories]
}

export async function saveCategoryNames(names: string[]): Promise<void> {
  await saveDocument({
    id: 'catalogue-categories',
    type: 'categories',
    partitionKey: 'store',
    categories: names,
  })
}

export async function getAnnouncement(): Promise<string> {
  const document = await findDocument('store-settings', 'settings')
  return typeof document?.announcement === 'string'
    ? document.announcement
    : process.env.ANNOUNCEMENT || 'Welcome to Mamigloexclusive — Elevate Your Style.'
}

export async function saveAnnouncement(announcement: string): Promise<void> {
  await saveDocument({
    id: 'store-settings',
    type: 'settings',
    partitionKey: 'store',
    announcement,
  })
}

export async function seedDemoProducts(): Promise<boolean> {
  if (process.env.DEMO_MODE !== 'true' || process.env.COSMOS_ENDPOINT) return false
  const existing = await listDocuments('product')
  if (existing.length) return false
  for (const product of demoProducts) {
    await saveDocument({
      ...product,
      id: product.id,
      type: 'product',
      partitionKey: 'store',
    } as StoreDocument)
  }
  return true
}

export function asProduct(document: StoreDocument): Product {
  const {
    type: _type, partitionKey: _partitionKey, etag: _etag,
    _etag: _systemEtag, _rid: _rid, _self: _self, _attachments: _attachments, _ts: _ts,
    ...product
  } = document
  const parsed = zodProductSchema.safeParse(product)
  if (!parsed.success || typeof document.id !== 'string') {
    throw new Error(`Stored product ${document.id} is invalid.`)
  }
  return { ...parsed.data, id: document.id }
}

export function asOrder<T>(document: StoreDocument): T {
  const {
    type: _type, partitionKey: _partitionKey, etag: _etag,
    _etag: _systemEtag, _rid: _rid, _self: _self, _attachments: _attachments, _ts: _ts,
    ...order
  } = document
  return order as T
}
