import { app, type HttpRequest, type InvocationContext } from '@azure/functions'
import { errorResponse, json, preflight } from '../http.js'
import { getCategoryNames } from '../store.js'

async function list(request: HttpRequest, context: InvocationContext) {
  const options = preflight(request)
  if (options) return options
  try {
    return json(200, { categories: await getCategoryNames() }, request)
  } catch (error) {
    return errorResponse(error, request, context)
  }
}

app.http('categories', {
  methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'categories', handler: list,
})
