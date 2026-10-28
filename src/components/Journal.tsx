import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, Clock3, Share2 } from 'lucide-react'
import { formatNGN } from '../config'
import { getJournalCategories, getPublishedJournalArticles, subscribeToJournal, type JournalArticle, type JournalCategory } from '../journal'
import type { Product } from '../types'
import { cloudinaryImageUrl } from '../cloudinary'

const fallbackCategories = [
  'Style & Grooming',
  "The Gentleman's Guide",
  'Wedding & Groom',
  'Accessories & Details',
  'Gift Guides',
  'Fashion & Trends',
]

export function journalReadingTime(content: string) {
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(wordCount / 220))
}

function formatDate(value: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value))
}

function formattedText(value: string) {
  return value.split(/(\*\*[^*]+?\*\*|\*[^*]+?\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>
    return part
  })
}

export function JournalArticleContent({ content }: { content: string }) {
  const lines = content.split(/\r?\n/)
  const blocks: Array<{ type: 'paragraph' | 'heading' | 'image' | 'list'; value: string; items?: string[]; level?: number; alt?: string; ordered?: boolean }> = []
  let paragraph: string[] = []
  let list: string[] = []
  let orderedList = false
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', value: paragraph.join(' ') })
    paragraph = []
  }
  const flushList = () => {
    if (list.length) blocks.push({ type: 'list', value: '', items: list, ordered: orderedList })
    list = []
    orderedList = false
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }
    const heading = /^(#{2,3})\s+(.+)$/.exec(line)
    const image = /^!\[([^\]]*)\]\((https:\/\/[^\s)]+|\/[^\s)]*)\)$/.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', value: heading[2], level: heading[1].length })
    } else if (image) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'image', value: image[2], alt: image[1] })
    } else if (/^(?:[-*]|\d+\.)\s+/.test(line)) {
      flushParagraph()
      const currentOrdered = /^\d+\./.test(line)
      if (list.length && currentOrdered !== orderedList) flushList()
      orderedList = currentOrdered
      list.push(line.replace(/^(?:[-*]|\d+\.)\s+/, ''))
    } else {
      flushList()
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()

  return <div className="journal-prose">
    {blocks.map((block, index) => {
      if (block.type === 'heading') return block.level === 3
        ? <h3 key={index}>{formattedText(block.value)}</h3>
        : <h2 key={index}>{formattedText(block.value)}</h2>
      if (block.type === 'image') return <figure key={index}><img src={cloudinaryImageUrl(block.value, 1200)} alt={block.alt || ''} loading="lazy" /><figcaption>{block.alt}</figcaption></figure>
      if (block.type === 'list') return block.ordered
        ? <ol key={index}>{block.items?.map((item, itemIndex) => <li key={`${itemIndex}-${item}`}>{formattedText(item)}</li>)}</ol>
        : <ul key={index}>{block.items?.map((item) => <li key={item}>{formattedText(item)}</li>)}</ul>
      return <p key={index}>{formattedText(block.value)}</p>
    })}
  </div>
}

function ArticleCard({ article, onOpen }: { article: JournalArticle; onOpen: (article: JournalArticle) => void }) {
  return <article className="journal-story-card">
    <button className="journal-card-image" type="button" onClick={() => onOpen(article)} aria-label={`Read ${article.title}`}>
      <img src={cloudinaryImageUrl(article.coverImageUrl, 640)} alt={article.coverImageAlt || article.title} loading="lazy" />
    </button>
    <div className="journal-card-copy">
      <p className="journal-category-label">{article.category.name}</p>
      <h3><button type="button" onClick={() => onOpen(article)}>{article.title}</button></h3>
      <p className="journal-excerpt">{article.excerpt}</p>
      <div className="journal-card-meta"><time dateTime={article.publishedAt || ''}>{formatDate(article.publishedAt)}</time><span>{journalReadingTime(article.content)} min read</span></div>
      <button className="journal-read-link" type="button" onClick={() => onOpen(article)}>Read More <ArrowRight size={14} /></button>
    </div>
  </article>
}

export function JournalHome({ onArticle }: { onArticle: (article: JournalArticle) => void }) {
  const [articles, setArticles] = useState<JournalArticle[]>([])
  const [categories, setCategories] = useState<JournalCategory[]>([])
  const [activeCategory, setActiveCategory] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([getPublishedJournalArticles(), getJournalCategories()])
      .then(([stories, categoryList]) => {
        if (!active) return
        setArticles(stories)
        setCategories(categoryList)
        setError('')
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'The journal could not be loaded.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const categoryNames = categories.length ? categories.map((category) => category.name) : fallbackCategories
  const filteredStories = useMemo(() => activeCategory
    ? articles.filter((article) => article.category.name === activeCategory)
    : articles, [activeCategory, articles])
  const featured = filteredStories.find((article) => article.isFeatured) || filteredStories[0]
  const latest = featured ? filteredStories.filter((article) => article.id !== featured.id) : filteredStories

  return <main className="journal-page">
    <header className="journal-intro">
      <p className="eyebrow">A MAMIGLOEXCLUSIVE EDITORIAL</p>
      <h1>THE MAMIGLOEXCLUSIVE<br /><em>JOURNAL</em></h1>
      <p className="journal-tagline">Style, confidence and the art of the finishing touch.</p>
      <p className="journal-intro-copy">Discover inspiration, practical styling advice and thoughtful guides to help you dress with confidence. From everyday essentials to unforgettable occasions, explore the details that make a difference.</p>
    </header>

    {error && <div className="journal-notice journal-error" role="alert">{error}</div>}
    {loading && <div className="journal-loading" role="status">Gathering the latest stories…</div>}
    {!loading && !error && featured && <section className="journal-featured" aria-labelledby="journal-featured-heading">
      <div className="journal-featured-image"><img src={cloudinaryImageUrl(featured.coverImageUrl, 1600)} alt={featured.coverImageAlt || featured.title} fetchPriority="high" /></div>
      <div className="journal-featured-copy">
        <p className="eyebrow">FEATURED STORY <span className="journal-featured-rule" /></p>
        <p className="journal-category-label">{featured.category.name}</p>
        <h2 id="journal-featured-heading">{featured.title}</h2>
        <p className="journal-excerpt">{featured.excerpt}</p>
        <div className="journal-card-meta"><time dateTime={featured.publishedAt || ''}>{formatDate(featured.publishedAt)}</time><span><Clock3 size={13} /> {journalReadingTime(featured.content)} min read</span></div>
        <button className="button button-dark" type="button" onClick={() => onArticle(featured)}>Read the Story <ArrowRight size={15} /></button>
      </div>
    </section>}

    <section className="journal-categories" aria-labelledby="journal-categories-heading">
      <div className="journal-section-heading"><div><p className="eyebrow">EXPLORE BY SUBJECT</p><h2 id="journal-categories-heading">Journal Categories</h2></div></div>
      <div className="journal-category-list" role="group" aria-label="Filter stories by category">
        <button type="button" className={!activeCategory ? 'is-selected' : ''} aria-pressed={!activeCategory} onClick={() => setActiveCategory('')}>All stories</button>
        {categoryNames.map((name) => <button type="button" key={name} className={activeCategory === name ? 'is-selected' : ''} aria-pressed={activeCategory === name} onClick={() => setActiveCategory(activeCategory === name ? '' : name)}>{name}</button>)}
      </div>
    </section>

    <section className="journal-latest" aria-labelledby="journal-latest-heading">
      <div className="journal-section-heading"><div><p className="eyebrow">NOTES ON PERSONAL STYLE</p><h2 id="journal-latest-heading">{activeCategory || 'Latest Stories'}</h2></div><span className="journal-story-count">{filteredStories.length} {filteredStories.length === 1 ? 'story' : 'stories'}</span></div>
      {!loading && !error && latest.length > 0 && <div className="journal-story-grid">{latest.map((article) => <ArticleCard key={article.id} article={article} onOpen={onArticle} />)}</div>}
      {!loading && !error && !filteredStories.length && <div className="journal-empty"><p className="eyebrow">A FRESH PAGE</p><h3>No stories in this collection yet.</h3><p>Check back soon for considered notes from Mamigloexclusive.</p></div>}
      {!loading && !error && featured && !latest.length && filteredStories.length === 1 && <div className="journal-empty journal-single-feature"><p className="eyebrow">THE FEATURED STORY</p><h3>One story, chosen with care.</h3><button className="journal-read-link" type="button" onClick={() => onArticle(featured)}>Read the featured story <ArrowRight size={14} /></button></div>}
    </section>

    <NewsletterSection />
  </main>
}

function NewsletterSection() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    setError('')
    setBusy(true)
    try {
      const result = await subscribeToJournal(email)
      setMessage(result === 'subscribed'
        ? 'Thank you. Your email has been added to the journal list.'
        : 'This email is already subscribed to the journal.')
      if (result === 'subscribed') setEmail('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your subscription could not be confirmed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="journal-newsletter" aria-labelledby="journal-newsletter-heading">
    <div className="journal-newsletter-copy"><p className="eyebrow">A NOTE FROM THE JOURNAL</p><h2 id="journal-newsletter-heading">Letters for the<br /><em>Well-Dressed Gentleman</em></h2><p>Receive styling inspiration, new articles and carefully selected updates from Mamigloexclusive.</p></div>
    <form className="journal-newsletter-form" onSubmit={submit}>
      <label htmlFor="journal-email">Email address</label>
      <div className="journal-email-row"><input id="journal-email" name="email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your email address" aria-describedby="journal-newsletter-feedback" /><button className="button button-dark" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Subscribe'} <ArrowRight size={15} /></button></div>
      <p id="journal-newsletter-feedback" className={error ? 'journal-feedback is-error' : 'journal-feedback'} role={error ? 'alert' : 'status'} aria-live="polite">{error || message}</p>
    </form>
  </section>
}

export function JournalArticlePage({ article, products, onBack, onArticle, onProduct }: {
  article: JournalArticle
  products: Product[]
  onBack: () => void
  onArticle: (article: JournalArticle) => void
  onProduct: (product: Product) => void
}) {
  const [related, setRelated] = useState<JournalArticle[]>([])
  useEffect(() => {
    let active = true
    getPublishedJournalArticles(article.categoryId)
      .then((items) => { if (active) setRelated(items.filter((item) => item.id !== article.id).slice(0, 3)) })
      .catch(() => { if (active) setRelated([]) })
    return () => { active = false }
  }, [article.categoryId, article.id])

  const recommendations = products.filter((product) => article.recommendedProductIds.includes(product.id)).slice(0, 4)
  const currentUrl = typeof window === 'undefined' ? '' : window.location.href
  const shareText = encodeURIComponent(`${article.title} | Mamigloexclusive Journal`)
  const shareUrl = encodeURIComponent(currentUrl)

  return <main className="journal-article-page">
    <div className="journal-article-top"><button className="journal-back-link" type="button" onClick={onBack}><ArrowLeft size={15} /> Back to The Journal</button><span className="journal-category-label">{article.category.name}</span></div>
    <header className="journal-article-header">
      <p className="eyebrow">THE MAMIGLOEXCLUSIVE JOURNAL</p>
      <h1>{article.title}</h1>
      <p className="journal-article-deck">{article.excerpt}</p>
      <div className="journal-article-byline"><span>By {article.author}</span><time dateTime={article.publishedAt || ''}>{formatDate(article.publishedAt)}</time><span><Clock3 size={13} /> {journalReadingTime(article.content)} min read</span></div>
    </header>
    <figure className="journal-article-cover"><img src={cloudinaryImageUrl(article.coverImageUrl, 1600)} alt={article.coverImageAlt || article.title} fetchPriority="high" /></figure>
    <div className="journal-article-layout">
      <article className="journal-article-body"><JournalArticleContent content={article.content} />
        <div className="journal-share"><span><Share2 size={14} /> Share this story</span><a href={`https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`} target="_blank" rel="noreferrer">Facebook <ArrowUpRight size={12} /></a><a href={`https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`} target="_blank" rel="noreferrer">X <ArrowUpRight size={12} /></a><a href={`https://wa.me/?text=${shareText}%20${shareUrl}`} target="_blank" rel="noreferrer">WhatsApp <ArrowUpRight size={12} /></a></div>
      </article>
      {recommendations.length > 0 && <aside className="journal-shop-look" aria-labelledby="journal-shop-look-heading"><p className="eyebrow">THE DETAILS, CONSIDERED</p><h2 id="journal-shop-look-heading">Shop the Look</h2><div className="journal-product-list">{recommendations.map((product) => <article className="journal-product-card" key={product.id}><button type="button" className="journal-product-image" onClick={() => onProduct(product)}><img src={product.imageUrl} alt={product.name} loading="lazy" /></button><div><h3><button type="button" onClick={() => onProduct(product)}>{product.name}</button></h3><p>{formatNGN(product.salePriceNGN ?? product.priceNGN)}</p></div><button className="journal-product-arrow" type="button" aria-label={`View ${product.name}`} onClick={() => onProduct(product)}><ArrowUpRight size={15} /></button></article>)}</div></aside>}
    </div>
    {related.length > 0 && <section className="journal-related" aria-labelledby="journal-related-heading"><div className="journal-section-heading"><div><p className="eyebrow">CONTINUE READING</p><h2 id="journal-related-heading">Related Stories</h2></div></div><div className="journal-story-grid">{related.map((item) => <ArticleCard key={item.id} article={item} onOpen={onArticle} />)}</div></section>}
  </main>
}

export function JournalArticleNotFound({ onBack }: { onBack: () => void }) {
  return <main className="journal-empty journal-not-found"><p className="eyebrow">THE JOURNAL</p><h1>This story is not available.</h1><p>It may be unpublished or the address may have changed.</p><button className="journal-read-link" type="button" onClick={onBack}>Return to The Journal <ArrowRight size={14} /></button></main>
}
