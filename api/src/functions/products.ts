import { app, type HttpRequest, type InvocationContext } from '@azure/functions'
import { asProduct, findDocument, listDocuments, seedDemoProducts } from '../store.js'
import { errorResponse, json, preflight } from '../http.js'

async function list(request: HttpRequest, context: InvocationContext) {
  const options = preflight(request)
  if (options) return options
  try {
    await seedDemoProducts()
    const query = request.query
    const category = query.get('category')
    const search = (query.get('q') || '').trim().toLowerCase()
    const minPrice = Number(query.get('minPrice') || 0)
    const maxPrice = query.has('maxPrice') ? Number(query.get('maxPrice')) : Infinity
    if (!Number.isFinite(minPrice) || minPrice < 0 || Number.isNaN(maxPrice) || maxPrice < 0) {
      return json(400, { error: 'Price filters must be non-negative numbers.' }, request)
    }
    const products = (await listDocuments('product'))
      .map(asProduct)
      .filter((product) => product.available)
      .filter((product) => !category || product.category === category)
      .filter((product) => !search || `${product.name} ${product.description} ${product.sku}`.toLowerCase().includes(search))
      .filter((product) => {
        const price = product.salePriceNGN ?? product.priceNGN
        return price >= minPrice && price <= maxPrice
      })
      .sort((a, b) => {
        if (query.get('sort') === 'price-asc') return (a.salePriceNGN ?? a.priceNGN) - (b.salePriceNGN ?? b.priceNGN)
        if (query.get('sort') === 'price-desc') return (b.salePriceNGN ?? b.priceNGN) - (a.salePriceNGN ?? a.priceNGN)
        return a.name.localeCompare(b.name)
      })
    return json(200, { products, demoMode: process.env.DEMO_MODE === 'true' }, request)
  } catch (error) {
    return errorResponse(error, request, context)
  }
}

async function get(request: HttpRequest, context: InvocationContext) {
  const options = preflight(request)
  if (options) return options
  try {
    await seedDemoProducts()
    const document = await findDocument(request.params.id || '', 'product')
    if (!document) return json(404, { error: 'Product not found.' }, request)
    const product = asProduct(document)
    if (!product.available) return json(404, { error: 'Product not found.' }, request)
    return json(200, { product }, request)
  } catch (error) {
    return errorResponse(error, request, context)
  }
}

app.http('products', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'products',
  handler: list,
})

app.http('product', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'products/{id}',
  handler: get,
})
