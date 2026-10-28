import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Eye, ImagePlus, Plus, Save, Send, Trash2, X } from 'lucide-react'
import { ApiError, storeApi } from '../api'
import { JournalArticleContent, journalReadingTime } from './Journal'
import {
  addJournalCategory,
  deleteJournalArticle,
  getAdminJournalArticles,
  getJournalCategories,
  saveJournalArticle,
  type JournalArticle,
  type JournalArticleInput,
  type JournalCategory,
} from '../journal'
import type { Product } from '../types'

const emptyArticle = (categoryId = ''): JournalArticleInput => ({
  title: '', slug: '', excerpt: '', content: '', coverImageUrl: '', coverImageAlt: '', categoryId,
  author: 'Mamigloexclusive Editorial', status: 'draft', publishedAt: null, isFeatured: false,
  seoTitle: '', seoDescription: '', recommendedProductIds: [],
})

function slugify(value: string) {
  return value.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : 'Not published'
}

export function JournalManagement({ token, products }: { token: string; products: Product[] }) {
  const [articles, setArticles] = useState<JournalArticle[]>([])
  const [categories, setCategories] = useState<JournalCategory[]>([])
  const [article, setArticle] = useState<JournalArticleInput>(() => emptyArticle())
  const [selectedId, setSelectedId] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [filter, setFilter] = useState<'all' | 'draft' | 'published'>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const uploadController = useRef<AbortController | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const coverInput = useRef<HTMLInputElement>(null)
  const inlineImageInput = useRef<HTMLInputElement>(null)
  const editorForm = useRef<HTMLFormElement>(null)

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const [articleRows, categoryRows] = await Promise.all([getAdminJournalArticles(), getJournalCategories()])
      setArticles(articleRows)
      setCategories(categoryRows)
      setArticle((current) => ({ ...current, categoryId: current.categoryId || categoryRows[0]?.id || '' }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Journal content could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const filteredArticles = useMemo(() => articles.filter((item) => filter === 'all' || item.status === filter), [articles, filter])
  const recommendationOptions = products.filter((item) => item.available)

  function edit(item: JournalArticle) {
    setSelectedId(item.id)
    setArticle({
      id: item.id,
      title: item.title,
      slug: item.slug,
      excerpt: item.excerpt,
      content: item.content,
      coverImageUrl: item.coverImageUrl,
      coverImageAlt: item.coverImageAlt,
      categoryId: item.categoryId,
      author: item.author,
      status: item.status,
      publishedAt: item.publishedAt,
      isFeatured: item.isFeatured,
      seoTitle: item.seoTitle,
      seoDescription: item.seoDescription,
      recommendedProductIds: item.recommendedProductIds,
    })
    setPreviewOpen(false)
    setNotice('')
    setError('')
  }

  function createNew() {
    setSelectedId('')
    setArticle(emptyArticle(categories[0]?.id || ''))
    setPreviewOpen(false)
    setNotice('')
    setError('')
  }

  function updateField<K extends keyof JournalArticleInput>(field: K, value: JournalArticleInput[K]) {
    setArticle((current) => ({ ...current, [field]: value }))
  }

  async function save(intent: 'draft' | 'published') {
    if (!editorForm.current?.reportValidity()) return
    setSaving(true)
    setNotice('')
    setError('')
    try {
      const saved = await saveJournalArticle({ ...article, status: intent, publishedAt: intent === 'published' ? article.publishedAt : null })
      setArticle({
        id: saved.id,
        title: saved.title,
        slug: saved.slug,
        excerpt: saved.excerpt,
        content: saved.content,
        coverImageUrl: saved.coverImageUrl,
        coverImageAlt: saved.coverImageAlt,
        categoryId: saved.categoryId,
        author: saved.author,
        status: saved.status,
        publishedAt: saved.publishedAt,
        isFeatured: saved.isFeatured,
        seoTitle: saved.seoTitle,
        seoDescription: saved.seoDescription,
        recommendedProductIds: saved.recommendedProductIds,
      })
      setSelectedId(saved.id)
      setNotice(saved.cleanupPending
        ? 'Article saved, but an unused media asset needs cleanup from the admin media retry control.'
        : saved.status === 'published' ? 'Article published.' : 'Draft saved.')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The article could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function changePublication(item: JournalArticle) {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await saveJournalArticle({
        id: item.id, title: item.title, slug: item.slug, excerpt: item.excerpt, content: item.content,
        coverImageUrl: item.coverImageUrl, coverImageAlt: item.coverImageAlt, categoryId: item.categoryId,
        author: item.author, status: item.status === 'published' ? 'draft' : 'published',
        publishedAt: item.status === 'published' ? null : new Date().toISOString(), isFeatured: item.isFeatured,
        seoTitle: item.seoTitle, seoDescription: item.seoDescription, recommendedProductIds: item.recommendedProductIds,
      })
      setNotice(item.status === 'published' ? 'Article unpublished and saved as a draft.' : 'Article published.')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The publication status could not be changed.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(item: JournalArticle) {
    if (!window.confirm(`Permanently delete “${item.title}”?`)) return
    setError('')
    setNotice('')
    try {
      const cleanupPending = await deleteJournalArticle(item.id)
      if (selectedId === item.id) createNew()
      setNotice(cleanupPending ? 'Article deleted; an unused media asset needs cleanup from the admin media retry control.' : 'Article deleted.')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The article could not be deleted.')
    }
  }

  async function uploadCover(file: File | undefined) {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
      setError('Choose a JPG, PNG or WebP cover image no larger than 12 MB.')
      return
    }
    setUploading(true)
    setUploadProgress(0)
    const controller = new AbortController()
    uploadController.current = controller
    setError('')
    setNotice('')
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      context?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      const optimizedBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.84))
      const optimizedFile = optimizedBlob
        ? new File([optimizedBlob], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' })
        : file
      if (optimizedFile.size > 5 * 1024 * 1024) throw new Error('The optimized cover image is still larger than 5 MB. Choose a smaller image.')
      const asset = await storeApi.admin.uploadMedia(token, optimizedFile, {
        scope: 'journal',
        signal: controller.signal,
        onProgress: setUploadProgress,
      })
      updateField('coverImageUrl', asset.secureUrl)
      setNotice('Cover image uploaded. Save the article to apply it.')
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : 'Cover image upload failed.')
    } finally {
      uploadController.current = null
      setUploading(false)
      setUploadProgress(0)
    }
  }

  async function uploadInlineImage(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setUploadProgress(0)
    setError('')
    setNotice('')
    const controller = new AbortController()
    uploadController.current = controller
    try {
      const asset = await storeApi.admin.uploadMedia(token, file, {
        scope: 'journal',
        signal: controller.signal,
        onProgress: setUploadProgress,
      })
      const altText = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/[\])]/g, '')
      setArticle((current) => ({ ...current, content: `${current.content.trimEnd()}\n\n![${altText}](${asset.secureUrl})\n` }))
      setNotice('Inline image uploaded and added to the article draft. Save the article to retain it.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Inline image upload failed.')
    } finally {
      uploadController.current = null
      setUploading(false)
      setUploadProgress(0)
    }
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    try {
      const updated = await addJournalCategory(newCategory)
      setCategories(updated)
      setArticle((current) => ({ ...current, categoryId: current.categoryId || updated.find((item) => item.name === newCategory.trim())?.id || '' }))
      setNewCategory('')
      setNotice('Journal category added.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The category could not be added.')
    }
  }

  function toggleProduct(id: string) {
    setArticle((current) => {
      const includes = current.recommendedProductIds.includes(id)
      return { ...current, recommendedProductIds: includes
        ? current.recommendedProductIds.filter((item) => item !== id)
        : current.recommendedProductIds.length < 8 ? [...current.recommendedProductIds, id] : current.recommendedProductIds }
    })
  }

  const previewArticle: JournalArticle = {
    id: article.id || 'preview',
    title: article.title || 'Untitled story',
    slug: article.slug || slugify(article.title) || 'preview',
    excerpt: article.excerpt || '',
    content: article.content || '',
    coverImageUrl: article.coverImageUrl || '/images/product-placeholder.svg',
    coverImageAlt: article.coverImageAlt || article.title,
    categoryId: article.categoryId,
    category: categories.find((item) => item.id === article.categoryId) || { id: article.categoryId, name: 'Journal', slug: 'journal' },
    author: article.author || 'Mamigloexclusive Editorial',
    status: article.status,
    publishedAt: article.publishedAt,
    isFeatured: article.isFeatured,
    seoTitle: article.seoTitle,
    seoDescription: article.seoDescription,
    recommendedProductIds: article.recommendedProductIds,
    createdAt: '',
    updatedAt: '',
  }

  return <section className="journal-admin-view" aria-labelledby="journal-admin-heading">
    <header className="admin-section-title journal-admin-heading">
      <div><p className="eyebrow">EDITORIAL STUDIO</p><h2 id="journal-admin-heading">The Journal</h2><p>Prepare stories, refine their presentation and publish when they are ready.</p></div>
      <button className="button button-dark" type="button" onClick={createNew}><Plus size={15} /> New article</button>
    </header>
    {error && <div className="error-notice" role="alert">{error}</div>}
    {notice && <p className="success-message" role="status">{notice}</p>}
    <div className="journal-admin-layout">
      <aside className="journal-admin-list" aria-label="Journal article list">
        <div className="journal-admin-list-head"><h3>Stories</h3><select aria-label="Filter articles" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">All</option><option value="draft">Drafts</option><option value="published">Published</option></select></div>
        {loading ? <p className="admin-loading">Loading journal articles…</p> : filteredArticles.length ? filteredArticles.map((item) => <article key={item.id} className={`journal-admin-row ${selectedId === item.id ? 'is-selected' : ''}`}>
          <button type="button" className="journal-admin-row-main" onClick={() => edit(item)}><span className={`journal-status-dot is-${item.status}`} /><span><strong>{item.title}</strong><small>{item.category.name} · {formatDate(item.publishedAt)}</small></span></button>
          <div className="journal-admin-row-actions"><button type="button" title={item.status === 'published' ? 'Unpublish article' : 'Publish article'} aria-label={item.status === 'published' ? `Unpublish ${item.title}` : `Publish ${item.title}`} disabled={saving} onClick={() => void changePublication(item)}>{item.status === 'published' ? <X size={14} /> : <Send size={14} />}</button><button type="button" title="Delete article" aria-label={`Delete ${item.title}`} onClick={() => void remove(item)}><Trash2 size={14} /></button></div>
        </article>) : <div className="journal-admin-empty">No articles in this view yet.</div>}
      </aside>

      <div className="journal-admin-editor">
        <form ref={editorForm} className="admin-product-form journal-editor-form" onSubmit={(event) => { event.preventDefault(); void save('draft') }}>
          <div className="journal-editor-toolbar"><div><p className="eyebrow">{selectedId ? 'EDIT STORY' : 'NEW STORY'}</p><h3>{article.title || 'Untitled article'}</h3></div><button type="button" className="button button-outline" onClick={() => setPreviewOpen(true)}><Eye size={14} /> Preview</button></div>
          <label className="field admin-wide"><span>Article title</span><input required maxLength={180} value={article.title} onChange={(event) => {
            const title = event.target.value
            setArticle((current) => ({ ...current, title, ...(!current.id ? { slug: slugify(title) } : {}) }))
          }} /></label>
          <label className="field"><span>Unique URL slug</span><input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={180} value={article.slug} onChange={(event) => updateField('slug', slugify(event.target.value))} /></label>
          <label className="field"><span>Category</span><select required value={article.categoryId} onChange={(event) => updateField('categoryId', event.target.value)}><option value="">Choose a category</option>{categories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label className="field admin-wide"><span>Short introduction / excerpt</span><textarea required maxLength={500} rows={3} value={article.excerpt} onChange={(event) => updateField('excerpt', event.target.value)} /></label>
          <label className="field admin-wide"><span>Cover image URL</span><div className="image-upload-row"><input required value={article.coverImageUrl} onChange={(event) => updateField('coverImageUrl', event.target.value)} /><button type="button" className="upload-button" disabled={uploading} onClick={() => coverInput.current?.click()}><ImagePlus size={14} />{uploading ? `Uploading ${uploadProgress}%` : 'Upload cover'}</button>{uploading && <button type="button" className="table-icon" aria-label="Cancel cover upload" onClick={() => uploadController.current?.abort()}><X size={14} /></button>}<input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { void uploadCover(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /></div>{uploading && <progress max="100" value={uploadProgress}>{uploadProgress}%</progress>}</label>
          <label className="field admin-wide"><span>Image alternative text</span><input maxLength={250} value={article.coverImageAlt} onChange={(event) => updateField('coverImageAlt', event.target.value)} /></label>
          <label className="field"><span>Author</span><input required maxLength={120} value={article.author} onChange={(event) => updateField('author', event.target.value)} /></label>
          <label className="field journal-featured-toggle"><span><input type="checkbox" checked={article.isFeatured} onChange={(event) => updateField('isFeatured', event.target.checked)} /> Feature on Journal homepage</span></label>
          <label className="field admin-wide"><span>Article content</span><textarea required rows={18} value={article.content} onChange={(event) => updateField('content', event.target.value)} placeholder={'Write in clear paragraphs. Use ## for section headings, ### for subheadings, - for lists, and ![description](image-url) for an in-article image.'} /></label>
          <div className="field admin-wide"><span>Inline article image</span><div className="image-upload-row"><button type="button" className="upload-button" disabled={uploading} onClick={() => inlineImageInput.current?.click()}><ImagePlus size={14} />Upload inline image</button>{uploading && <button type="button" className="table-icon" aria-label="Cancel inline image upload" onClick={() => uploadController.current?.abort()}><X size={14} /></button>}<input ref={inlineImageInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { void uploadInlineImage(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /></div>{uploading && <progress max="100" value={uploadProgress}>{uploadProgress}%</progress>}</div>
          <fieldset className="journal-recommendations admin-wide"><legend>Shop the Look · choose up to 8 live products</legend>{recommendationOptions.length ? <div className="journal-product-options">{recommendationOptions.map((product) => <label key={product.id}><input type="checkbox" checked={article.recommendedProductIds.includes(product.id)} onChange={() => toggleProduct(product.id)} /><span>{product.name}</span></label>)}</div> : <p>No published products are available to recommend.</p>}</fieldset>
          <div className="journal-seo-fields admin-wide"><p className="eyebrow">SEARCH PRESENTATION</p><label className="field"><span>SEO title</span><input maxLength={180} value={article.seoTitle} onChange={(event) => updateField('seoTitle', event.target.value)} /></label><label className="field"><span>SEO description</span><textarea maxLength={320} rows={3} value={article.seoDescription} onChange={(event) => updateField('seoDescription', event.target.value)} /></label></div>
          <div className="journal-editor-actions admin-wide"><span>{article.content.trim() ? `${journalReadingTime(article.content)} min estimated read` : 'Reading time appears after adding content.'}</span><div><button className="button button-outline" type="button" onClick={() => void save('draft')} disabled={saving}><Save size={14} /> Save draft</button><button className="button button-dark" type="button" onClick={() => void save('published')} disabled={saving}><Send size={14} /> {saving ? 'Saving…' : 'Publish'}</button></div></div>
        </form>

        <form className="journal-category-form" onSubmit={addCategory}><label className="field"><span>Add a journal category</span><div className="image-upload-row"><input required maxLength={80} value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="Category name" /><button className="button button-outline" type="submit"><Plus size={14} /> Add</button></div></label></form>
      </div>
    </div>

    {previewOpen && <div className="journal-preview-backdrop" role="presentation" onClick={() => setPreviewOpen(false)}><section className="journal-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="journal-preview-title" onClick={(event) => event.stopPropagation()}><div className="journal-preview-bar"><h2 id="journal-preview-title">Article preview</h2><button className="icon-button" type="button" aria-label="Close article preview" onClick={() => setPreviewOpen(false)}><X size={17} /></button></div><article className="journal-preview-content"><p className="eyebrow">{previewArticle.category.name}</p><h1>{previewArticle.title}</h1><p className="journal-article-deck">{previewArticle.excerpt}</p><p className="journal-preview-meta">By {previewArticle.author} · {journalReadingTime(previewArticle.content)} min read · Preview only</p><img className="journal-preview-cover" src={previewArticle.coverImageUrl} alt={previewArticle.coverImageAlt} /><JournalArticleContent content={previewArticle.content} /></article></section></div>}
  </section>
}
