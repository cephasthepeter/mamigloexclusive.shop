import { getAdminEligibility, requireSupabase, supabase } from './supabase'
import { deleteCloudinaryAsset } from './media'

export interface JournalCategory {
  id: string
  name: string
  slug: string
}

export interface JournalArticle {
  id: string
  title: string
  slug: string
  excerpt: string
  content: string
  coverImageUrl: string
  coverImageAlt: string
  categoryId: string
  category: JournalCategory
  author: string
  status: 'draft' | 'published'
  publishedAt: string | null
  isFeatured: boolean
  seoTitle: string
  seoDescription: string
  recommendedProductIds: string[]
  createdAt: string
  updatedAt: string
  cleanupPending?: boolean
}

export type JournalArticleInput = Omit<JournalArticle, 'id' | 'category' | 'createdAt' | 'updatedAt'> & { id?: string }

type JournalCategoryRow = { id: string; name: string; slug: string }
type JournalArticleRow = Record<string, unknown> & {
  id: string
  title: string
  slug: string
  excerpt: string
  content: string
  cover_image_url: string
  cover_image_alt: string
  category_id: string
  category: JournalCategoryRow | JournalCategoryRow[] | null
  author: string
  status: 'draft' | 'published'
  published_at: string | null
  is_featured: boolean
  seo_title: string | null
  seo_description: string | null
  recommended_product_ids: string[]
  created_at: string
  updated_at: string
}

function throwIfError(error: { message: string; code?: string } | null) {
  if (!error) return
  const message = error.code === '42501'
    ? 'Administrator access is required to manage journal content.'
    : error.message
  throw new Error(message)
}

function mapArticle(row: JournalArticleRow): JournalArticle {
  const category = Array.isArray(row.category) ? row.category[0] : row.category
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    content: row.content,
    coverImageUrl: row.cover_image_url,
    coverImageAlt: row.cover_image_alt,
    categoryId: row.category_id,
    category: category || { id: row.category_id, name: '', slug: '' },
    author: row.author,
    status: row.status,
    publishedAt: row.published_at,
    isFeatured: row.is_featured,
    seoTitle: row.seo_title || '',
    seoDescription: row.seo_description || '',
    recommendedProductIds: row.recommended_product_ids || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function requireJournalAdmin() {
  requireSupabase()
  const { data, error } = await supabase.auth.getUser()
  throwIfError(error)
  if (!data.user?.email || !await getAdminEligibility(data.user.email)) {
    throw new Error('Administrator access is required to manage journal content.')
  }
}

const categorySelect = 'id, name, slug'
const articleSelect = '*, category:journal_categories!journal_articles_category_id_fkey(id, name, slug)'

export async function getJournalCategories(): Promise<JournalCategory[]> {
  requireSupabase()
  const { data, error } = await supabase.from('journal_categories').select(categorySelect).order('name')
  throwIfError(error)
  return (data || []) as JournalCategory[]
}

export async function getPublishedJournalArticles(categoryId?: string): Promise<JournalArticle[]> {
  requireSupabase()
  let query = supabase.from('journal_articles').select(articleSelect)
    .eq('status', 'published').order('published_at', { ascending: false })
  if (categoryId) query = query.eq('category_id', categoryId)
  const { data, error } = await query
  throwIfError(error)
  return ((data || []) as JournalArticleRow[]).map(mapArticle)
}

export async function getPublishedJournalArticle(slug: string): Promise<JournalArticle | null> {
  requireSupabase()
  const { data, error } = await supabase.from('journal_articles').select(articleSelect)
    .eq('slug', slug).eq('status', 'published').maybeSingle()
  throwIfError(error)
  return data ? mapArticle(data as JournalArticleRow) : null
}

export async function getAdminJournalArticles(): Promise<JournalArticle[]> {
  await requireJournalAdmin()
  const { data, error } = await supabase.from('journal_articles').select(articleSelect)
    .order('updated_at', { ascending: false })
  throwIfError(error)
  return ((data || []) as JournalArticleRow[]).map(mapArticle)
}

export async function saveJournalArticle(input: JournalArticleInput): Promise<JournalArticle> {
  await requireJournalAdmin()
  const previousAssets = input.id
    ? await supabase.from('media_assets').select('id, secure_url').eq('journal_article_id', input.id)
    : { data: [], error: null }
  throwIfError(previousAssets.error)
  const publishedAt = input.status === 'published' ? input.publishedAt || new Date().toISOString() : null
  const record = {
    ...(input.id ? { id: input.id } : {}),
    title: input.title.trim(),
    slug: input.slug.trim().toLowerCase(),
    excerpt: input.excerpt.trim(),
    content: input.content,
    cover_image_url: input.coverImageUrl.trim(),
    cover_image_alt: input.coverImageAlt.trim(),
    category_id: input.categoryId,
    author: input.author.trim(),
    status: input.status,
    published_at: publishedAt,
    is_featured: input.isFeatured,
    seo_title: input.seoTitle.trim() || null,
    seo_description: input.seoDescription.trim() || null,
    recommended_product_ids: input.recommendedProductIds,
  }
  const { data, error } = await supabase.from('journal_articles').upsert(record)
    .select(articleSelect).single()
  throwIfError(error)
  const article = mapArticle(data as JournalArticleRow)
  const { error: detachError } = await supabase.from('media_assets').update({ journal_article_id: null })
    .eq('journal_article_id', article.id)
  throwIfError(detachError)
  const contentImageUrls = [...article.content.matchAll(/!\[[^\]]*\]\((https:\/\/res\.cloudinary\.com\/[^\s)]+)\)/g)]
    .map((match) => match[1])
  const articleMediaUrls = [...new Set([article.coverImageUrl, ...contentImageUrls])]
    .filter((url) => url.startsWith('https://res.cloudinary.com/'))
  if (articleMediaUrls.length) {
    const { error: attachError } = await supabase.from('media_assets').update({
      journal_article_id: article.id,
      is_active: true,
    }).eq('folder', 'mamiglo/journal').in('secure_url', articleMediaUrls)
    throwIfError(attachError)
  }
  if (article.coverImageUrl.startsWith('https://res.cloudinary.com/')) {
    const { error: coverMetadataError } = await supabase.from('media_assets').update({
      alt_text: article.coverImageAlt.slice(0, 250),
      display_order: 0,
    }).eq('journal_article_id', article.id).eq('secure_url', article.coverImageUrl)
    throwIfError(coverMetadataError)
  }
  let cleanupPending = false
  for (const asset of previousAssets.data || []) {
    if (!articleMediaUrls.includes(asset.secure_url)) {
      try { await deleteCloudinaryAsset(asset.id) } catch { cleanupPending = true }
    }
  }
  return cleanupPending ? { ...article, cleanupPending: true } : article
}

export async function deleteJournalArticle(id: string): Promise<boolean> {
  await requireJournalAdmin()
  const { data: assets, error: assetsError } = await supabase.from('media_assets')
    .select('id').eq('journal_article_id', id)
  throwIfError(assetsError)
  const { error } = await supabase.from('journal_articles').delete().eq('id', id)
  throwIfError(error)
  let cleanupPending = false
  for (const asset of assets || []) {
    try { await deleteCloudinaryAsset(asset.id) } catch { cleanupPending = true }
  }
  return cleanupPending
}

export async function addJournalCategory(name: string): Promise<JournalCategory[]> {
  await requireJournalAdmin()
  const normalized = name.trim()
  const slug = normalized.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!normalized || normalized.length > 80 || !slug) throw new Error('Enter a category name of 1 to 80 characters.')
  const { error } = await supabase.from('journal_categories').insert({ name: normalized, slug })
  throwIfError(error)
  return getJournalCategories()
}

export function validateJournalEmail(email: string) {
  const normalized = email.trim().toLowerCase()
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return ''
  return normalized
}

export async function subscribeToJournal(email: string): Promise<'subscribed' | 'already_subscribed'> {
  requireSupabase()
  const normalized = validateJournalEmail(email)
  if (!normalized) throw new Error('Enter a valid email address.')
  const { data, error } = await supabase.rpc('subscribe_to_journal', { p_email: normalized })
  throwIfError(error)
  if (data !== 'subscribed' && data !== 'already_subscribed') {
    throw new Error('We could not confirm your subscription. Please try again.')
  }
  return data
}
