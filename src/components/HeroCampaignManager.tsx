import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Plus, Save, Send, Trash2, Video, X } from 'lucide-react'
import {
  defaultHeroSettings,
  getAdminHeroContent,
  heroPosterMaxBytes,
  heroVideoMaxBytes,
  publishHeroContent,
  removeHeroCampaign,
  removeUnusedHeroAssets,
  saveHeroCampaign,
  saveHeroSettings,
  uploadHeroAsset,
  type HeroCampaign,
  type HeroCampaignInput,
  type HeroSettings,
} from '../hero'

const heroRoutes = [
  { value: '/shop', label: 'The Collection' },
  { value: '/shop?category=Wedding%20Ties', label: 'Wedding Edit' },
  { value: '/about', label: 'Our Story' },
  { value: '/contact', label: 'Get in Touch' },
  { value: '/journal', label: 'The Journal' },
]

function emptyCampaign(order: number): HeroCampaignInput {
  return {
    id: crypto.randomUUID(), name: '', title: '', description: '', videoPath: '', videoPublicId: '', videoUrl: '',
    posterPath: '', posterPublicId: '', posterUrl: '', posterAltText: '', mobileVideoPath: '', mobileVideoPublicId: '', mobileVideoUrl: '',
    primaryCtaText: '', primaryCtaUrl: '/shop', secondaryCtaText: '', secondaryCtaUrl: '/shop',
    displayOrder: order, durationSeconds: null, isActive: true, isPublished: false, startsAt: '', endsAt: '',
  }
}

function toLocalDateTime(value: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function toUtcIso(value: string) {
  return value ? new Date(value).toISOString() : ''
}

function toCampaignInput(campaign: HeroCampaign): HeroCampaignInput {
  return {
    id: campaign.id,
    name: campaign.name,
    title: campaign.title,
    description: campaign.description,
    videoPath: campaign.videoPath,
    videoPublicId: campaign.videoPublicId,
    videoUrl: campaign.videoUrl,
    posterPath: campaign.posterPath,
    posterPublicId: campaign.posterPublicId,
    posterUrl: campaign.posterUrl,
    posterAltText: campaign.posterAltText,
    mobileVideoPath: campaign.mobileVideoPath,
    mobileVideoPublicId: campaign.mobileVideoPublicId,
    mobileVideoUrl: campaign.mobileVideoUrl,
    primaryCtaText: campaign.primaryCtaText,
    primaryCtaUrl: campaign.primaryCtaUrl,
    secondaryCtaText: campaign.secondaryCtaText,
    secondaryCtaUrl: campaign.secondaryCtaUrl,
    displayOrder: campaign.displayOrder,
    durationSeconds: campaign.durationSeconds,
    isActive: campaign.isActive,
    isPublished: campaign.isPublished,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
  }
}

export function HeroCampaignManager() {
  const [campaigns, setCampaigns] = useState<HeroCampaign[]>([])
  const [settings, setSettings] = useState<HeroSettings>(defaultHeroSettings)
  const [campaign, setCampaign] = useState<HeroCampaignInput>(() => emptyCampaign(0))
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState<'video' | 'poster' | 'mobile' | 'fallback' | ''>('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadController, setUploadController] = useState<AbortController | null>(null)
  const [videoPreview, setVideoPreview] = useState('')
  const [posterPreview, setPosterPreview] = useState('')
  const [mobileVideoPreview, setMobileVideoPreview] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [orphanCandidates, setOrphanCandidates] = useState<string[]>([])
  const videoInputRef = useRef<HTMLInputElement>(null)
  const posterInputRef = useRef<HTMLInputElement>(null)
  const mobileVideoInputRef = useRef<HTMLInputElement>(null)
  const fallbackInputRef = useRef<HTMLInputElement>(null)

  const previewPoster = posterPreview || (campaign.posterPath || campaign.posterUrl ? campaign.posterUrl : settings.fallbackPosterUrl)
  const scheduledLabel = campaign.startsAt || campaign.endsAt
    ? 'Dates use your local timezone and are stored as UTC.'
    : 'No date limits. The campaign is eligible when published and active.'

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const result = await getAdminHeroContent()
      setCampaigns(result.campaigns)
      setSettings(result.settings)
      if (selectedId) {
        const selected = result.campaigns.find((item) => item.id === selectedId)
        if (selected) setCampaign(toCampaignInput(selected))
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Homepage hero campaigns could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  useEffect(() => () => {
    for (const url of [videoPreview, posterPreview, mobileVideoPreview]) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [mobileVideoPreview, posterPreview, videoPreview])

  const orderedCampaigns = useMemo(() => [...campaigns].sort((a, b) => a.displayOrder - b.displayOrder), [campaigns])

  function updateCampaign<K extends keyof HeroCampaignInput>(key: K, value: HeroCampaignInput[K]) {
    setCampaign((current) => ({ ...current, [key]: value }))
  }

  function updateSettings<K extends keyof HeroSettings>(key: K, value: HeroSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  function selectCampaign(item: HeroCampaign) {
    setSelectedId(item.id)
    setCampaign(toCampaignInput(item))
    setVideoPreview('')
    setPosterPreview('')
    setMobileVideoPreview('')
    setNotice('')
    setError('')
  }

  function createCampaign() {
    setSelectedId('')
    setCampaign(emptyCampaign(campaigns.length))
    setVideoPreview('')
    setPosterPreview('')
    setMobileVideoPreview('')
    setNotice('')
    setError('')
  }

  async function uploadAsset(file: File | undefined, kind: 'video' | 'poster', target: 'video' | 'poster' | 'mobile' | 'fallback') {
    if (!file) return
    const oldPath = target === 'fallback'
      ? settings.fallbackPosterPublicId || settings.fallbackPosterPath
      : target === 'video' ? campaign.videoPublicId || campaign.videoPath
        : target === 'poster' ? campaign.posterPublicId || campaign.posterPath
          : campaign.mobileVideoPublicId || campaign.mobileVideoPath
    const controller = new AbortController()
    setUploadController(controller)
    setUploading(target)
    setUploadProgress(0)
    setError('')
    setNotice('')
    try {
      const asset = await uploadHeroAsset(file, kind, setUploadProgress, controller.signal)
      const preview = URL.createObjectURL(file)
      if (target === 'fallback') {
        setSettings((current) => ({ ...current, fallbackPosterPath: '', fallbackPosterPublicId: asset.publicId, fallbackPosterUrl: asset.secureUrl }))
        setPosterPreview(preview)
      } else if (target === 'video') {
        updateCampaign('videoPath', '')
        updateCampaign('videoPublicId', asset.publicId)
        updateCampaign('videoUrl', asset.secureUrl)
        setVideoPreview(preview)
      } else if (target === 'poster') {
        updateCampaign('posterPath', '')
        updateCampaign('posterPublicId', asset.publicId)
        updateCampaign('posterUrl', asset.secureUrl)
        setPosterPreview(preview)
      } else {
        updateCampaign('mobileVideoPath', '')
        updateCampaign('mobileVideoPublicId', asset.publicId)
        updateCampaign('mobileVideoUrl', asset.secureUrl)
        setMobileVideoPreview(preview)
      }
      if (oldPath && oldPath !== asset.publicId) setOrphanCandidates((current) => [...current, oldPath])
      setNotice(`${kind === 'video' ? 'Video' : 'Poster'} uploaded. Save a draft to retain this change.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The media upload failed.')
    } finally {
      setUploadController(null)
      setUploading('')
    }
  }

  function handleMediaInput(event: ChangeEvent<HTMLInputElement>, kind: 'video' | 'poster', target: 'video' | 'poster' | 'mobile' | 'fallback') {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    void uploadAsset(file, kind, target)
  }

  function clearCampaignMedia(target: 'video' | 'poster' | 'mobile') {
    const publicId = target === 'video' ? campaign.videoPublicId : target === 'poster' ? campaign.posterPublicId : campaign.mobileVideoPublicId
    const path = target === 'video' ? campaign.videoPath : target === 'poster' ? campaign.posterPath : campaign.mobileVideoPath
    const candidate = publicId || path
    if (candidate) setOrphanCandidates((current) => [...current, candidate])
    if (target === 'video') {
      updateCampaign('videoPath', '')
      updateCampaign('videoPublicId', '')
      updateCampaign('videoUrl', '')
      setVideoPreview('')
    } else if (target === 'poster') {
      updateCampaign('posterPath', '')
      updateCampaign('posterPublicId', '')
      updateCampaign('posterUrl', '')
      setPosterPreview('')
    } else {
      updateCampaign('mobileVideoPath', '')
      updateCampaign('mobileVideoPublicId', '')
      updateCampaign('mobileVideoUrl', '')
      setMobileVideoPreview('')
    }
  }

  async function saveDraft() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (campaign.name.trim() || campaign.videoPath || campaign.videoPublicId) {
        if (!campaign.name.trim() || !(campaign.videoPath || campaign.videoPublicId)) throw new Error('Add a campaign name and upload a video before saving this campaign.')
        if (campaign.endsAt && campaign.startsAt && new Date(campaign.endsAt) <= new Date(campaign.startsAt)) throw new Error('The end date must be after the start date.')
        const saved = await saveHeroCampaign({
          ...campaign,
          startsAt: toUtcIso(campaign.startsAt),
          endsAt: toUtcIso(campaign.endsAt),
        })
        setSelectedId(saved.id)
        setCampaign(toCampaignInput(saved))
      }
      await saveHeroSettings({ ...settings, fallbackPosterUrl: '' })
      await refresh()
      setNotice('Draft changes saved. The public homepage is unchanged until you publish.')
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Draft changes could not be saved.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function publishChanges() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      let savedCampaign: HeroCampaign | null = null
      if (campaign.name.trim() || campaign.videoPath || campaign.videoPublicId) {
        if (!campaign.name.trim() || !(campaign.videoPath || campaign.videoPublicId)) throw new Error('Complete the campaign name and video before publishing.')
        if (campaign.endsAt && campaign.startsAt && new Date(campaign.endsAt) <= new Date(campaign.startsAt)) throw new Error('The end date must be after the start date.')
        savedCampaign = await saveHeroCampaign({ ...campaign, startsAt: toUtcIso(campaign.startsAt), endsAt: toUtcIso(campaign.endsAt) })
        setSelectedId(savedCampaign.id)
        setCampaign(toCampaignInput(savedCampaign))
      }
      const campaignWillPublish = [
        ...campaigns.filter((item) => item.id !== savedCampaign?.id),
        ...(savedCampaign ? [savedCampaign] : []),
      ].some((item) => item.isActive && item.isPublished && Boolean(item.videoPath || item.videoPublicId || item.videoUrl))
      if (!campaignWillPublish) throw new Error('No active video is selected for publication. Upload a video, then enable Active and Include when changes are published.')
      if (!settings.slideshowEnabled) throw new Error('Video slideshow is disabled. Enable it under Video playback before publishing the homepage hero.')
      await saveHeroSettings({ ...settings, fallbackPosterUrl: '' })
      await publishHeroContent()
      await removeUnusedHeroAssets(orphanCandidates)
      setOrphanCandidates([])
      await refresh()
      setNotice('Homepage hero changes published successfully.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Homepage hero changes could not be published.')
    } finally {
      setBusy(false)
    }
  }

  async function reorder(item: HeroCampaign, direction: -1 | 1) {
    const sorted = [...orderedCampaigns]
    const index = sorted.findIndex((entry) => entry.id === item.id)
    const target = index + direction
    if (target < 0 || target >= sorted.length) return
    setBusy(true)
    setError('')
    try {
      const [current, next] = [sorted[index], sorted[target]]
      await Promise.all([
        saveHeroCampaign({ ...toCampaignInput(current), displayOrder: next.displayOrder }),
        saveHeroCampaign({ ...toCampaignInput(next), displayOrder: current.displayOrder }),
      ])
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Campaign order could not be changed.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: HeroCampaign) {
    if (!window.confirm(`Delete “${item.name}”? Its live version remains until you publish changes.`)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await removeHeroCampaign(item.id)
      setOrphanCandidates((current) => [...current,
        item.videoPublicId || item.videoPath,
        item.posterPublicId || item.posterPath,
        item.mobileVideoPublicId || item.mobileVideoPath,
      ].filter(Boolean))
      if (selectedId === item.id) createCampaign()
      await refresh()
      setNotice('Campaign draft deleted. Publish changes to remove it from the public hero.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Campaign draft could not be deleted.')
    } finally {
      setBusy(false)
    }
  }

  const videoSource = videoPreview || campaigns.find((item) => item.id === selectedId)?.videoUrl || ''

  return <section className="hero-manager" aria-labelledby="hero-manager-heading">
    <header className="admin-section-title hero-manager-heading">
      <div><p className="eyebrow">STOREFRONT EDITORIAL</p><h2 id="hero-manager-heading">Homepage Hero Manager</h2><p>Manage campaign media, messaging, order and publication separately from the live homepage.</p></div>
      <button type="button" className="button button-dark" onClick={createCampaign}><Plus size={15} /> New campaign</button>
    </header>
    {error && <div className="error-notice" role="alert">{error}</div>}
    {notice && <p className="success-message" role="status">{notice}</p>}
    <div className="hero-manager-layout">
      <aside className="hero-campaign-list" aria-label="Hero campaign drafts">
        <div className="hero-campaign-list-head"><strong>Campaign order</strong><span>{campaigns.length} drafts</span></div>
        {loading ? <p className="admin-loading">Loading hero campaigns…</p> : orderedCampaigns.length ? orderedCampaigns.map((item, index) => <article key={item.id} className={`hero-campaign-row ${selectedId === item.id ? 'is-selected' : ''}`}>
          <button type="button" className="hero-campaign-select" onClick={() => selectCampaign(item)}><span className={`hero-campaign-state ${item.isPublished && item.isActive ? 'is-ready' : ''}`} /><span><strong>{item.name}</strong><small>{item.isPublished ? item.isActive ? 'Included on publish' : 'Inactive' : 'Draft only'}</small></span></button>
          <div className="hero-campaign-order"><button type="button" aria-label={`Move ${item.name} earlier`} disabled={index === 0 || busy} onClick={() => void reorder(item, -1)}><ArrowUp size={14} /></button><button type="button" aria-label={`Move ${item.name} later`} disabled={index === orderedCampaigns.length - 1 || busy} onClick={() => void reorder(item, 1)}><ArrowDown size={14} /></button></div>
          <button type="button" className="hero-campaign-delete" aria-label={`Delete ${item.name}`} disabled={busy} onClick={() => void remove(item)}><Trash2 size={14} /></button>
        </article>) : <p className="hero-campaign-empty">No campaign drafts yet.</p>}
      </aside>

      <div className="hero-manager-main">
        <form className="hero-campaign-editor" onSubmit={(event) => { event.preventDefault(); void saveDraft() }}>
          <div className="hero-manager-subhead"><div><p className="eyebrow">CAMPAIGN CONTENT</p><h3>{campaign.name || 'New campaign'}</h3></div><button type="button" className="button button-outline" onClick={() => setPreviewOpen((value) => !value)}><Video size={14} /> {previewOpen ? 'Hide preview' : 'Preview'}</button></div>
          <div className="hero-editor-grid">
            <label className="field"><span>Campaign name</span><input required maxLength={120} value={campaign.name} onChange={(event) => updateCampaign('name', event.target.value)} placeholder="Autumn Wedding Edit" /></label>
            <label className="field"><span>Hero heading</span><input maxLength={180} value={campaign.title} onChange={(event) => updateCampaign('title', event.target.value)} placeholder="Optional headline" /></label>
            <label className="field hero-field-wide"><span>Description</span><textarea rows={3} maxLength={700} value={campaign.description} onChange={(event) => updateCampaign('description', event.target.value)} placeholder="Optional subtitle" /></label>
          </div>

          <div className="hero-upload-grid">
            <div className="hero-upload-card"><div><Video size={16} /><strong>Desktop video</strong></div><p>Compressed MP4 recommended (5–15 MB); MP4 or WebM up to {heroVideoMaxBytes / (1024 * 1024)} MB. Cloudinary optimizes delivery for playback.</p>{(campaign.videoPath || campaign.videoPublicId) && <video className="hero-upload-preview" src={videoPreview || campaign.videoUrl || campaigns.find((item) => item.id === selectedId)?.videoUrl} poster={previewPoster || undefined} muted playsInline controls preload="metadata" />}{uploading === 'video' && <progress max="100" value={uploadProgress}>{uploadProgress}%</progress>}<button type="button" className="upload-button" disabled={Boolean(uploading)} onClick={() => videoInputRef.current?.click()}><Video size={14} />{uploading === 'video' ? `Uploading ${uploadProgress}%` : campaign.videoPublicId || campaign.videoPath ? 'Replace video' : 'Upload video'}</button>{Boolean(campaign.videoPublicId || campaign.videoPath) && <button type="button" className="table-icon danger-icon" aria-label="Remove desktop video" onClick={() => clearCampaignMedia('video')}><Trash2 size={14} /></button>}<input ref={videoInputRef} hidden type="file" accept="video/mp4,video/webm" onChange={(event) => handleMediaInput(event, 'video', 'video')} /></div>
            <div className="hero-upload-card"><div><ImagePlus size={16} /><strong>Poster image</strong></div><p>JPG, PNG or WebP, up to {heroPosterMaxBytes / (1024 * 1024)} MB. Used while the video loads and as a fallback.</p>{(posterPreview || campaign.posterUrl || campaigns.find((item) => item.id === selectedId)?.posterUrl) && <img className="hero-poster-preview" src={posterPreview || campaign.posterUrl || campaigns.find((item) => item.id === selectedId)?.posterUrl} alt={campaign.posterAltText || 'Campaign poster preview'} />}{uploading === 'poster' && <progress max="100" value={uploadProgress}>{uploadProgress}%</progress>}<button type="button" className="upload-button" disabled={Boolean(uploading)} onClick={() => posterInputRef.current?.click()}><ImagePlus size={14} />{uploading === 'poster' ? `Uploading ${uploadProgress}%` : campaign.posterPublicId || campaign.posterPath ? 'Replace poster' : 'Upload poster'}</button>{Boolean(campaign.posterPublicId || campaign.posterPath) && <button type="button" className="table-icon danger-icon" aria-label="Remove poster image" onClick={() => clearCampaignMedia('poster')}><Trash2 size={14} /></button>}<input ref={posterInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => handleMediaInput(event, 'poster', 'poster')} /><label className="field"><span>Poster alternative text</span><input maxLength={250} value={campaign.posterAltText} onChange={(event) => updateCampaign('posterAltText', event.target.value)} /></label></div>
            <div className="hero-upload-card"><div><Video size={16} /><strong>Optional mobile video</strong></div><p>MP4 or WebM, up to {heroVideoMaxBytes / (1024 * 1024)} MB. Used on narrow screens.</p>{uploading === 'mobile' && <progress max="100" value={uploadProgress}>{uploadProgress}%</progress>}<button type="button" className="upload-button" disabled={Boolean(uploading)} onClick={() => mobileVideoInputRef.current?.click()}><Video size={14} />{uploading === 'mobile' ? `Uploading ${uploadProgress}%` : campaign.mobileVideoPublicId || campaign.mobileVideoPath ? 'Replace mobile video' : 'Upload mobile video'}</button>{Boolean(campaign.mobileVideoPublicId || campaign.mobileVideoPath) && <button type="button" className="table-icon danger-icon" aria-label="Remove mobile video" onClick={() => clearCampaignMedia('mobile')}><Trash2 size={14} /></button>}<input ref={mobileVideoInputRef} hidden type="file" accept="video/mp4,video/webm" onChange={(event) => handleMediaInput(event, 'video', 'mobile')} /></div>
          </div>

          <fieldset className="hero-cta-settings"><legend>Campaign buttons</legend><div className="hero-editor-grid">
            <label className="field"><span>Primary button text</span><input maxLength={48} value={campaign.primaryCtaText} onChange={(event) => updateCampaign('primaryCtaText', event.target.value)} placeholder="Optional" /></label>
            <label className="field"><span>Primary destination</span><select disabled={!campaign.primaryCtaText.trim()} value={campaign.primaryCtaUrl} onChange={(event) => updateCampaign('primaryCtaUrl', event.target.value)}>{heroRoutes.map((route) => <option value={route.value} key={route.value}>{route.label}</option>)}</select></label>
            <label className="field"><span>Secondary button text</span><input maxLength={48} value={campaign.secondaryCtaText} onChange={(event) => updateCampaign('secondaryCtaText', event.target.value)} placeholder="Optional" /></label>
            <label className="field"><span>Secondary destination</span><select disabled={!campaign.secondaryCtaText.trim()} value={campaign.secondaryCtaUrl} onChange={(event) => updateCampaign('secondaryCtaUrl', event.target.value)}>{heroRoutes.map((route) => <option value={route.value} key={route.value}>{route.label}</option>)}</select></label>
          </div></fieldset>

          <div className="hero-campaign-options">
            <label className="hero-check"><input type="checkbox" checked={campaign.isActive} onChange={(event) => updateCampaign('isActive', event.target.checked)} /> Active</label>
            <label className="hero-check"><input type="checkbox" checked={campaign.isPublished} onChange={(event) => updateCampaign('isPublished', event.target.checked)} /> Include when changes are published</label>
            <label className="field"><span>Display duration (seconds)</span><input type="number" min="5" max="120" value={campaign.durationSeconds ?? ''} placeholder={`Default: ${settings.defaultDurationSeconds}`} onChange={(event) => updateCampaign('durationSeconds', event.target.value ? Number(event.target.value) : null)} /></label>
            <label className="field"><span>Starts at</span><input type="datetime-local" value={toLocalDateTime(campaign.startsAt)} onChange={(event) => updateCampaign('startsAt', event.target.value)} /></label>
            <label className="field"><span>Ends at</span><input type="datetime-local" value={toLocalDateTime(campaign.endsAt)} onChange={(event) => updateCampaign('endsAt', event.target.value)} /></label>
            <p className="admin-help hero-timezone-note">{scheduledLabel}</p>
          </div>

          <div className="hero-editor-actions"><span>Draft edits never affect the public homepage until Publish Changes.</span><div><button className="button button-outline" type="submit" disabled={busy || Boolean(uploading)}><Save size={14} /> Save Draft</button><button className="button button-dark" type="button" disabled={busy || Boolean(uploading)} onClick={() => void publishChanges()}><Send size={14} /> {busy ? 'Saving…' : 'Publish Changes'}</button></div></div>
        </form>

        <section className="hero-settings-editor" aria-labelledby="hero-default-settings-heading"><div className="hero-manager-subhead"><div><p className="eyebrow">SLIDESHOW SETTINGS</p><h3 id="hero-default-settings-heading">Video playback</h3></div></div>
          <div className="hero-editor-grid">
            <label className="field"><span>Default duration (seconds)</span><input type="number" min="5" max="120" value={settings.defaultDurationSeconds} onChange={(event) => updateSettings('defaultDurationSeconds', Number(event.target.value))} /></label>
            <label className="field"><span>Crossfade (milliseconds)</span><input type="number" min="800" max="1200" step="100" value={settings.crossfadeMs} onChange={(event) => updateSettings('crossfadeMs', Number(event.target.value))} /></label>
          </div>
          <div className="hero-settings-bottom"><label className="hero-check"><input type="checkbox" checked={settings.slideshowEnabled} onChange={(event) => updateSettings('slideshowEnabled', event.target.checked)} /> Enable video slideshow</label><div><button type="button" className="upload-button" disabled={Boolean(uploading)} onClick={() => fallbackInputRef.current?.click()}><ImagePlus size={14} />{uploading === 'fallback' ? `Uploading ${uploadProgress}%` : 'Upload fallback poster'}</button><input ref={fallbackInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => handleMediaInput(event, 'poster', 'fallback')} /></div></div>
          {uploading === 'fallback' && <progress max="100" value={uploadProgress}>{uploadProgress}%</progress>}
          {uploading && <button type="button" className="table-icon" aria-label="Cancel hero media upload" onClick={() => uploadController?.abort()}><X size={14} /></button>}
        </section>

        {previewOpen && <section className="hero-admin-preview" aria-label="Live unpublished hero preview"><div className="hero-admin-preview-header"><p className="eyebrow">UNPUBLISHED PREVIEW</p><span>Not visible on the public homepage</span></div><div className="hero-admin-preview-screen" style={{ backgroundImage: `linear-gradient(90deg, rgba(13,12,10,.78), rgba(15,14,12,.2)), url("${previewPoster || settings.fallbackPosterUrl || ''}")` }}>{videoSource && <video key={videoSource} src={videoSource} poster={previewPoster || undefined} muted loop autoPlay playsInline /> }<div>{campaign.title.trim() && <h3>{campaign.title}</h3>}{campaign.description.trim() && <p>{campaign.description}</p>}{campaign.primaryCtaText.trim() && <span>{campaign.primaryCtaText}</span>}{campaign.secondaryCtaText.trim() && <span>{campaign.secondaryCtaText}</span>}</div></div></section>}
      </div>
    </div>
  </section>
}
