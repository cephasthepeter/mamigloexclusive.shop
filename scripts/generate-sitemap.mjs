import { createClient } from '@supabase/supabase-js'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const configuredSiteUrl = process.env.VITE_SITE_URL?.trim()
const siteUrl = configuredSiteUrl ? new URL(configuredSiteUrl).origin : ''
const supabaseUrl = process.env.VITE_SUPABASE_URL
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const urls = []

if (siteUrl && supabaseUrl && publishableKey) {
  const supabase = createClient(supabaseUrl, publishableKey)
  const { data, error } = await supabase.from('products')
    .select('id, updated_at').eq('is_published', true)
  if (error) throw new Error(`Could not build the product sitemap: ${error.message}`)
  urls.push('/', '/shop', '/about', '/contact')
  for (const product of data || []) urls.push(`/product/${encodeURIComponent(product.id)}`)
}

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map((path) => `  <url><loc>${siteUrl}${path}</loc></url>`),
  '</urlset>',
  '',
].join('\n')

await writeFile(resolve('public/sitemap.xml'), xml, 'utf8')
