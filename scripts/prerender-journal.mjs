import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const siteUrl = process.env.VITE_SITE_URL?.trim() ? new URL(process.env.VITE_SITE_URL.trim()).origin : ''
const supabaseUrl = process.env.VITE_SUPABASE_URL
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!siteUrl || !supabaseUrl || !publishableKey) {
  console.info('Skipping journal prerender: set VITE_SITE_URL and the public Supabase environment variables during production builds.')
  process.exit(0)
}

const supabase = createClient(supabaseUrl, publishableKey)
const { data: articles, error: articleError } = await supabase.from('journal_articles')
  .select('title, slug, excerpt, content, cover_image_url, cover_image_alt, author, published_at, updated_at, seo_title, seo_description, category:journal_categories(name)')
  .eq('status', 'published').order('published_at', { ascending: false })
if (articleError) throw new Error(`Could not prerender the journal: ${articleError.message}`)
const { data: categories, error: categoryError } = await supabase.from('journal_categories').select('name, slug').order('name')
if (categoryError) throw new Error(`Could not prerender journal categories: ${categoryError.message}`)

const template = await readFile(resolve('dist/index.html'), 'utf8')
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])
const absoluteUrl = (value) => new URL(value, siteUrl).toString()
const setMeta = (html, pattern, replacement) => pattern.test(html) ? html.replace(pattern, replacement) : html.replace('</head>', `  ${replacement}\n  </head>`)
const setPageMeta = (source, { title, description, url, image, type = 'website', structuredData = '' }) => {
  let html = source.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
  html = setMeta(html, /<meta\s+name="description"[^>]*>/i, `<meta name="description" content="${escapeHtml(description)}" />`)
  html = setMeta(html, /<meta\s+property="og:title"[^>]*>/i, `<meta property="og:title" content="${escapeHtml(title)}" />`)
  html = setMeta(html, /<meta\s+property="og:description"[^>]*>/i, `<meta property="og:description" content="${escapeHtml(description)}" />`)
  html = setMeta(html, /<meta\s+property="og:type"[^>]*>/i, `<meta property="og:type" content="${type}" />`)
  html = setMeta(html, /<meta\s+property="og:url"[^>]*>/i, `<meta property="og:url" content="${escapeHtml(url)}" />`)
  if (image) html = setMeta(html, /<meta\s+property="og:image"[^>]*>/i, `<meta property="og:image" content="${escapeHtml(image)}" />`)
  html = html.replace(/\s*<link\s+rel="canonical"[^>]*>/i, '')
  html = html.replace('</head>', `  <link rel="canonical" href="${escapeHtml(url)}" />\n  ${structuredData}\n  </head>`)
  return html
}

function renderContent(content) {
  return content.split(/\r?\n/).map((rawLine) => {
    const line = rawLine.trim()
    if (!line) return ''
    const heading = /^(#{2,3})\s+(.+)$/.exec(line)
    if (heading) return `<h${heading[1].length}>${escapeHtml(heading[2])}</h${heading[1].length}>`
    const image = /^!\[([^\]]*)\]\((https:\/\/[^\s)]+|\/[^\s)]*)\)$/.exec(line)
    if (image) return `<figure><img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}" loading="lazy"><figcaption>${escapeHtml(image[1])}</figcaption></figure>`
    if (/^[-*]\s+/.test(line)) return `<li>${escapeHtml(line.replace(/^[-*]\s+/, ''))}</li>`
    return `<p>${escapeHtml(line)}</p>`
  }).join('\n').replace(/(?:<li>.*<\/li>\n?)+/g, (items) => `<ul>${items}</ul>`)
}

const journalUrl = `${siteUrl}/journal`
const journalStories = (articles || []).map((article) => `<article class="journal-story-card"><a class="journal-card-image" href="/journal/${encodeURIComponent(article.slug)}"><img src="${escapeHtml(article.cover_image_url)}" alt="${escapeHtml(article.cover_image_alt || article.title)}" loading="lazy"></a><div class="journal-card-copy"><p class="journal-category-label">${escapeHtml(Array.isArray(article.category) ? article.category[0]?.name : article.category?.name)}</p><h2><a href="/journal/${encodeURIComponent(article.slug)}">${escapeHtml(article.title)}</a></h2><p class="journal-excerpt">${escapeHtml(article.excerpt)}</p></div></article>`).join('\n')
const categoryLinks = (categories || []).map((category) => `<span>${escapeHtml(category.name)}</span>`).join('')
const journalBody = `<main class="journal-page"><header class="journal-intro"><p class="eyebrow">A MAMIGLOEXCLUSIVE EDITORIAL</p><h1>THE MAMIGLOEXCLUSIVE<br><em>JOURNAL</em></h1><p class="journal-tagline">Style, confidence and the art of the finishing touch.</p><p class="journal-intro-copy">Discover inspiration, practical styling advice and thoughtful guides to help you dress with confidence. From everyday essentials to unforgettable occasions, explore the details that make a difference.</p></header><nav class="journal-category-list" aria-label="Journal categories">${categoryLinks}</nav><section class="journal-latest"><h2>Latest Stories</h2><div class="journal-story-grid">${journalStories || '<p>New stories are being prepared for the journal.</p>'}</div></section></main>`
const journalHtml = setPageMeta(template, {
  title: 'The Mamigloexclusive Journal | Mamigloexclusive',
  description: 'Style, confidence and the art of the finishing touch. Discover practical styling advice and thoughtful guides from Mamigloexclusive.',
  url: journalUrl,
})
await mkdir(resolve('dist/journal'), { recursive: true })
await writeFile(resolve('dist/journal/index.html'), journalHtml.replace('<div id="root"></div>', `<div id="root">${journalBody}</div>`), 'utf8')

for (const article of articles || []) {
  const category = Array.isArray(article.category) ? article.category[0]?.name : article.category?.name
  const url = `${siteUrl}/journal/${encodeURIComponent(article.slug)}`
  const image = absoluteUrl(article.cover_image_url)
  const title = article.seo_title || `${article.title} | The Mamigloexclusive Journal`
  const description = article.seo_description || article.excerpt
  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.title,
    description,
    image,
    datePublished: article.published_at,
    dateModified: article.updated_at,
    author: { '@type': 'Organization', name: article.author },
    publisher: { '@type': 'Organization', name: 'Mamigloexclusive' },
    mainEntityOfPage: url,
  }).replace(/</g, '\\u003c')}</script>`
  const body = `<main class="journal-article-page"><nav class="journal-article-top"><a class="journal-back-link" href="/journal">Back to The Journal</a><span class="journal-category-label">${escapeHtml(category)}</span></nav><header class="journal-article-header"><p class="eyebrow">THE MAMIGLOEXCLUSIVE JOURNAL</p><h1>${escapeHtml(article.title)}</h1><p class="journal-article-deck">${escapeHtml(article.excerpt)}</p><div class="journal-article-byline"><span>By ${escapeHtml(article.author)}</span><time datetime="${escapeHtml(article.published_at)}">${new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(article.published_at))}</time></div></header><figure class="journal-article-cover"><img src="${escapeHtml(article.cover_image_url)}" alt="${escapeHtml(article.cover_image_alt || article.title)}"></figure><article class="journal-article-body"><div class="journal-prose">${renderContent(article.content)}</div></article></main>`
  const html = setPageMeta(template, { title, description, url, image, type: 'article', structuredData: jsonLd })
  const output = resolve('dist/journal', article.slug, 'index.html')
  await mkdir(resolve('dist/journal', article.slug), { recursive: true })
  await writeFile(output, html.replace('<div id="root"></div>', `<div id="root">${body}</div>`), 'utf8')
}

console.info(`Prerendered ${articles?.length || 0} published journal stories.`)
