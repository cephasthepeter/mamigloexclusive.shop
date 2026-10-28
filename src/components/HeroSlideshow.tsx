import { useEffect, useRef, useState } from 'react'
import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { defaultHeroSettings, getPublicHeroContent, type HeroCampaign, type HeroSettings } from '../hero'
import { getHeroOverlayContent, nextPlayableHeroIndex } from '../hero-presentation'

interface HeroSlideshowProps {
  onNavigate: (path: string) => void
}

export function HeroSlideshow({ onNavigate }: HeroSlideshowProps) {
  const [campaigns, setCampaigns] = useState<HeroCampaign[]>([])
  const [settings, setSettings] = useState<HeroSettings>(defaultHeroSettings)
  const [activeIndex, setActiveIndex] = useState(0)
  const [activeSlot, setActiveSlot] = useState(0)
  const [incomingIndex, setIncomingIndex] = useState<number | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set())
  const [reducedMotion, setReducedMotion] = useState(false)
  const [userPaused, setUserPaused] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [tabHidden, setTabHidden] = useState(false)
  const [mobileViewport, setMobileViewport] = useState(false)
  const [videoUnavailable, setVideoUnavailable] = useState(false)
  const [loadComplete, setLoadComplete] = useState(false)
  const [settingsError, setSettingsError] = useState(false)
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([null, null])
  const campaignsRef = useRef<HeroCampaign[]>([])
  const activeIndexRef = useRef(0)
  const activeSlotRef = useRef(0)
  const failedRef = useRef(new Set<string>())
  const pendingIndexRef = useRef<number | null>(null)
  const transitionRef = useRef(false)
  const startedRef = useRef(false)
  const displayTimerRef = useRef<number | null>(null)
  const crossfadeTimerRef = useRef<number | null>(null)

  const motionPaused = userPaused || tabHidden || reducedMotion || !settings.slideshowEnabled
  const validCampaigns = campaigns.filter((campaign) => campaign.videoUrl && !failedIds.has(campaign.id))
  const currentCampaign = campaigns[activeIndex]
  const activeCampaign = currentCampaign && !failedIds.has(currentCampaign.id) ? currentCampaign : validCampaigns[0]
  const activePresentation = settings.slideshowEnabled ? activeCampaign : undefined
  const visiblePoster = activePresentation?.posterUrl || settings.fallbackPosterUrl || currentCampaign?.posterUrl || ''
  const overlay = getHeroOverlayContent(activePresentation)
  const hasOverlay = Boolean(overlay.title || overlay.description || overlay.primaryCta || overlay.secondaryCta)

  useEffect(() => {
    let active = true
    let requestPending = false
    async function refreshContent() {
      if (requestPending) return
      requestPending = true
      try {
        const { campaigns: rows, settings: configured } = await getPublicHeroContent()
        if (!active) return
        const currentId = campaignsRef.current[activeIndexRef.current]?.id
        const nextIndex = currentId ? rows.findIndex((campaign) => campaign.id === currentId) : 0
        const remainingFailures = new Set([...failedRef.current].filter((id) => rows.some((campaign) => campaign.id === id)))
        campaignsRef.current = rows
        failedRef.current = remainingFailures
        setFailedIds(remainingFailures)
        setCampaigns(rows)
        setSettings(configured)
        setVideoUnavailable(!rows.length)
        setSettingsError(false)
        if (nextIndex < 0) {
          activeIndexRef.current = 0
          activeSlotRef.current = 0
          startedRef.current = false
          transitionRef.current = false
          pendingIndexRef.current = null
          clearDisplayTimer()
          videoRefs.current.forEach((video) => video?.pause())
          setActiveIndex(0)
          setActiveSlot(0)
          setIncomingIndex(null)
          setTransitioning(false)
        } else if (nextIndex !== activeIndexRef.current) {
          activeIndexRef.current = nextIndex
          setActiveIndex(nextIndex)
        }
      } catch {
        if (active) {
          setVideoUnavailable(campaignsRef.current.length === 0)
          setSettingsError(true)
        }
      } finally {
        requestPending = false
        if (active) setLoadComplete(true)
      }
    }
    void refreshContent()
    const refreshTimer = window.setInterval(() => {
      if (!document.hidden) void refreshContent()
    }, 60_000)
    return () => {
      active = false
      window.clearInterval(refreshTimer)
    }
  }, [])

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const update = () => setMobileViewport(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const update = () => setTabHidden(document.hidden)
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  useEffect(() => {
    activeIndexRef.current = activeIndex
    activeSlotRef.current = activeSlot
  }, [activeIndex, activeSlot])

  function clearDisplayTimer() {
    if (displayTimerRef.current !== null) window.clearTimeout(displayTimerRef.current)
    displayTimerRef.current = null
  }

  function markFailed(index: number) {
    const campaign = campaigns[index]
    if (!campaign) return
    failedRef.current.add(campaign.id)
    setFailedIds(new Set(failedRef.current))
    if (failedRef.current.size >= campaigns.length) setVideoUnavailable(true)
  }

  function beginTransition(index: number) {
    if (transitionRef.current || motionPaused || index < 0 || !campaigns[index]) return
    const nextSlot = 1 - activeSlotRef.current
    const incomingVideo = videoRefs.current[nextSlot]
    if (!incomingVideo || incomingVideo.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      pendingIndexRef.current = index
      return
    }
    pendingIndexRef.current = null
    incomingVideo.currentTime = 0
    transitionRef.current = true
    void incomingVideo.play().then(() => {
      setIncomingIndex(index)
      setTransitioning(true)
      crossfadeTimerRef.current = window.setTimeout(() => {
        const outgoingVideo = videoRefs.current[activeSlotRef.current]
        if (outgoingVideo) {
          outgoingVideo.pause()
          outgoingVideo.currentTime = 0
        }
        activeSlotRef.current = nextSlot
        activeIndexRef.current = index
        setActiveSlot(nextSlot)
        setActiveIndex(index)
        setIncomingIndex(null)
        setTransitioning(false)
        transitionRef.current = false
        startedRef.current = true
        scheduleDisplayTimer(index)
      }, Math.max(800, Math.min(1200, settings.crossfadeMs)))
    }).catch(() => {
      transitionRef.current = false
      setIncomingIndex(null)
      setTransitioning(false)
      if (pendingIndexRef.current === index) pendingIndexRef.current = null
      markFailed(index)
      requestNextTransition()
    })
  }

  function requestNextTransition() {
    if (motionPaused || transitionRef.current) return
    const nextIndex = nextPlayableHeroIndex(activeIndexRef.current, campaigns, failedRef.current)
    if (nextIndex < 0) {
      if (failedRef.current.size >= campaigns.length) setVideoUnavailable(true)
      return
    }
    beginTransition(nextIndex)
  }

  function toggleSound() {
    const nextEnabled = !soundEnabled
    setSoundEnabled(nextEnabled)
    videoRefs.current.forEach((video) => { if (video) video.muted = !nextEnabled })
  }

  function scheduleDisplayTimer(index: number) {
    clearDisplayTimer()
    if (motionPaused || validCampaigns.length < 2 || index !== activeIndexRef.current) return
    const duration = campaigns[index].durationSeconds || settings.defaultDurationSeconds
    displayTimerRef.current = window.setTimeout(requestNextTransition, duration * 1000)
  }

  function handleVideoReady(slot: number, index: number) {
    const video = videoRefs.current[slot]
    if (!video || motionPaused) return
    if (slot === activeSlotRef.current && index === activeIndexRef.current) {
      void video.play().then(() => {
        startedRef.current = true
        setVideoUnavailable(false)
        scheduleDisplayTimer(index)
      }).catch(() => handleVideoError(index))
      return
    }
    if (startedRef.current && pendingIndexRef.current === index && slot === 1 - activeSlotRef.current) {
      beginTransition(index)
    }
  }

  function handleVideoError(index: number) {
    const incomingFailure = index !== activeIndexRef.current &&
      (pendingIndexRef.current === index || transitionRef.current)
    if (incomingFailure) {
      if (crossfadeTimerRef.current !== null) window.clearTimeout(crossfadeTimerRef.current)
      crossfadeTimerRef.current = null
      transitionRef.current = false
      pendingIndexRef.current = null
      setIncomingIndex(null)
      setTransitioning(false)
    }
    markFailed(index)
    if (index === activeIndexRef.current) {
      clearDisplayTimer()
      startedRef.current = false
      requestNextTransition()
    } else if (incomingFailure) {
      requestNextTransition()
    }
  }

  useEffect(() => {
    if (motionPaused) {
      clearDisplayTimer()
      videoRefs.current.forEach((video) => video?.pause())
      return
    }
    const activeVideo = videoRefs.current[activeSlotRef.current]
    if (activeVideo && activeVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      void activeVideo.play().then(() => {
        startedRef.current = true
        scheduleDisplayTimer(activeIndexRef.current)
      }).catch(() => handleVideoError(activeIndexRef.current))
    }
    return () => clearDisplayTimer()
  }, [motionPaused, campaigns, settings.defaultDurationSeconds])

  useEffect(() => () => {
    clearDisplayTimer()
    if (crossfadeTimerRef.current !== null) window.clearTimeout(crossfadeTimerRef.current)
    videoRefs.current.forEach((video) => video?.pause())
  }, [])

  const incomingIndexForLayer = transitioning ? incomingIndex : nextPlayableHeroIndex(activeIndex, campaigns, failedIds)
  const showVideo = !reducedMotion && settings.slideshowEnabled && !videoUnavailable && validCampaigns.length > 0

  return <section className="hero-section video-hero" aria-label="Featured Mamigloexclusive campaign">
    <div className="hero-media">
    {showVideo && campaigns.map((campaign, index) => {
      const slot = index === activeIndex ? activeSlot : index === incomingIndexForLayer ? 1 - activeSlot : -1
      if (slot < 0) return null
      const isActive = slot === activeSlot
      const isIncoming = transitioning && index === incomingIndex
      const src = mobileViewport && campaign.mobileVideoUrl ? campaign.mobileVideoUrl : campaign.videoUrl
      return <video
        key={`${slot}-${campaign.id}`}
        ref={(element) => { videoRefs.current[slot] = element }}
        className={`hero-video-layer ${isActive ? 'is-active' : ''} ${isActive && transitioning ? 'is-outgoing' : ''} ${isIncoming ? 'is-incoming' : ''}`}
        style={{ transitionDuration: `${settings.crossfadeMs}ms` }}
        src={src}
        poster={campaign.posterUrl || undefined}
        muted={!soundEnabled}
        playsInline
        preload={isActive || index === incomingIndexForLayer ? 'auto' : 'none'}
        loop={validCampaigns.length === 1}
        aria-hidden="true"
        onCanPlay={() => handleVideoReady(slot, index)}
        onEnded={() => { if (slot === activeSlotRef.current) requestNextTransition() }}
        onError={() => handleVideoError(index)}
      />
    })}
    {!showVideo && (visiblePoster
      ? <img className="hero-static-fallback" src={visiblePoster} alt="" />
      : <div className="hero-static-fallback" aria-hidden="true" />)}
    <div className="hero-video-overlay" />
      {campaigns.length > 1 && <div className="hero-slide-count" aria-live="polite">{Math.min(activeIndex + 1, campaigns.length).toString().padStart(2, '0')} / {campaigns.length.toString().padStart(2, '0')}</div>}
      {showVideo && <div className="hero-video-controls">
        <button className="hero-sound-toggle" type="button" aria-label={soundEnabled ? 'Mute hero video' : 'Unmute hero video'} onClick={toggleSound}>
          {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>
        <button className="hero-playback-toggle" type="button" aria-label={userPaused ? 'Resume hero slideshow' : 'Pause hero slideshow'} onClick={() => setUserPaused((paused) => !paused)}>
          {userPaused ? <Play size={14} /> : <Pause size={14} />}
          <span>{userPaused ? 'Play' : 'Pause'}</span>
        </button>
      </div>}
    </div>
    {hasOverlay && <div className="hero-copy">
      {overlay.title && <h1>{overlay.title}</h1>}
      {overlay.description && <p className="hero-subtitle">{overlay.description}</p>}
      {(overlay.primaryCta || overlay.secondaryCta) && <div className="hero-actions">
        {overlay.primaryCta && <button className="button button-gold" onClick={() => onNavigate(overlay.primaryCta!.url)}>{overlay.primaryCta.text}</button>}
        {overlay.secondaryCta && <button className="button button-quiet hero-secondary-cta" onClick={() => onNavigate(overlay.secondaryCta!.url)}>{overlay.secondaryCta.text}</button>}
      </div>}
    </div>}
    {!loadComplete && <span className="hero-loading-indicator" role="status">Loading campaign</span>}
    {settingsError && <span className="sr-only">Showing the campaign poster or neutral fallback because hero settings are unavailable.</span>}
  </section>
}
