import { app, type HttpRequest, type InvocationContext } from '@azure/functions'
import { errorResponse, json, preflight } from '../http.js'
import { getAnnouncement } from '../store.js'

async function get(request: HttpRequest, context: InvocationContext) {
  const options = preflight(request)
  if (options) return options
  try {
    return json(200, { announcement: await getAnnouncement() }, request)
  } catch (error) {
    return errorResponse(error, request, context)
  }
}

app.http('store-config', {
  methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'store-config', handler: get,
})
