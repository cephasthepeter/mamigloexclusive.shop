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
  const [{ data: products, error: productError }, { data: articles, error: articleError }] = await Promise.all([
    supabase.from('products')
    .select('id, updated_at').eq('is_published', true)
    , supabase.from('journal_articles')
      .select('slug, updated_at').eq('status', 'published')
  ])
  if (productError) throw new Error(`Could not build the product sitemap: ${productError.message}`)
  if (articleError) throw new Error(`Could not build the journal sitemap: ${articleError.message}`)
  urls.push('/', '/shop', '/about', '/contact', '/journal')
  for (const product of products || []) urls.push(`/product/${encodeURIComponent(product.id)}`)
  for (const article of articles || []) urls.push(`/journal/${encodeURIComponent(article.slug)}`)
}

const escapeXml = (value) => value.replace(/[<>&"']/g, (character) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
})[character])
const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map((path) => `  <url><loc>${escapeXml(`${siteUrl}${path}`)}</loc></url>`),
  '</urlset>',
  '',
].join('\n')

await writeFile(resolve('public/sitemap.xml'), xml, 'utf8')
