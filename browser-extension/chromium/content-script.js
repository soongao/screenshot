(function () {
  const BRIDGE_BASE_URL = 'http://127.0.0.1:32123'
  const SESSION_POLL_INTERVAL = 500
  const HOVER_POST_INTERVAL = 120
  const AUTO_SCROLL_INTERVAL = 360

  let bridgeActive = false
  let autoScrolling = false
  let overlay = null
  let currentCandidate = null
  let lastHoverPostAt = 0
  let sessionPollTimer = null
  let autoScrollTimer = null

  function ensureOverlay() {
    if (overlay) {
      return overlay
    }

    overlay = document.createElement('div')
    overlay.style.position = 'fixed'
    overlay.style.zIndex = '2147483646'
    overlay.style.pointerEvents = 'none'
    overlay.style.border = '2px solid #1890ff'
    overlay.style.background = 'rgba(24, 144, 255, 0.12)'
    overlay.style.boxSizing = 'border-box'
    overlay.style.borderRadius = '8px'
    overlay.style.display = 'none'

    const label = document.createElement('div')
    label.dataset.role = 'label'
    label.style.position = 'absolute'
    label.style.left = '0'
    label.style.top = '-30px'
    label.style.maxWidth = '320px'
    label.style.padding = '4px 10px'
    label.style.borderRadius = '999px'
    label.style.background = 'rgba(24, 144, 255, 0.96)'
    label.style.color = '#fff'
    label.style.font = '12px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    label.style.whiteSpace = 'nowrap'
    label.style.overflow = 'hidden'
    label.style.textOverflow = 'ellipsis'
    overlay.appendChild(label)

    document.documentElement.appendChild(overlay)
    return overlay
  }

  function hideOverlay() {
    if (overlay) {
      overlay.style.display = 'none'
    }
  }

  function postBridge(path, payload) {
    return fetch(`${BRIDGE_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).catch(() => null)
  }

  function getViewportScreenOffset() {
    const visualViewport = window.visualViewport
    return {
      x: window.screenX + (visualViewport ? visualViewport.offsetLeft : 0),
      y: window.screenY + (visualViewport ? visualViewport.offsetTop : 0),
    }
  }

  function isScrollableElement(element) {
    if (!(element instanceof HTMLElement)) {
      return false
    }

    const style = window.getComputedStyle(element)
    const overflowY = style.overflowY
    const overflowX = style.overflowX
    const scrollableY = element.scrollHeight > element.clientHeight + 8 && ['auto', 'scroll', 'overlay'].includes(overflowY)
    const scrollableX = element.scrollWidth > element.clientWidth + 8 && ['auto', 'scroll', 'overlay'].includes(overflowX)
    return scrollableY || scrollableX
  }

  function clampRectToViewport(rect) {
    const left = Math.max(0, rect.left)
    const top = Math.max(0, rect.top)
    const right = Math.min(window.innerWidth, rect.right)
    const bottom = Math.min(window.innerHeight, rect.bottom)
    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    }
  }

  function buildCandidateFromElement(element) {
    const rect = element.getBoundingClientRect()
    const clampedRect = clampRectToViewport(rect)
    if (clampedRect.width < 120 || clampedRect.height < 80) {
      return null
    }

    const viewportOffset = getViewportScreenOffset()
    return {
      element,
      label: element.getAttribute('aria-label') || element.id || element.className || document.title || '可滚动区域',
      x: Math.round(viewportOffset.x + clampedRect.left),
      y: Math.round(viewportOffset.y + clampedRect.top),
      width: Math.round(clampedRect.width),
      height: Math.round(clampedRect.height),
      left: clampedRect.left,
      top: clampedRect.top,
    }
  }

  function getScrollableAncestors(element) {
    const candidates = []
    let current = element
    while (current && current !== document.body && current !== document.documentElement) {
      if (isScrollableElement(current)) {
        candidates.push(current)
      }
      current = current.parentElement
    }

    const scrollingElement = document.scrollingElement
    if (scrollingElement instanceof HTMLElement) {
      candidates.push(scrollingElement)
    }

    return candidates
  }

  function scoreCandidate(element) {
    const rect = element.getBoundingClientRect()
    const visibleArea = Math.max(0, Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left))
      * Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top))
    const scrollDistance = Math.max(
      element.scrollHeight - element.clientHeight,
      element.scrollWidth - element.clientWidth,
    )
    return scrollDistance * 2 + visibleArea
  }

  function findBestScrollableCandidate(clientX, clientY) {
    const target = document.elementFromPoint(clientX, clientY)
    if (!(target instanceof HTMLElement)) {
      return null
    }

    const ancestors = getScrollableAncestors(target)
    if (ancestors.length === 0) {
      return null
    }

    const bestElement = ancestors
      .sort((left, right) => scoreCandidate(right) - scoreCandidate(left))[0]

    return bestElement ? buildCandidateFromElement(bestElement) : null
  }

  function renderCandidate(candidate) {
    const nextOverlay = ensureOverlay()
    nextOverlay.style.display = 'block'
    nextOverlay.style.left = `${candidate.left}px`
    nextOverlay.style.top = `${candidate.top}px`
    nextOverlay.style.width = `${candidate.width}px`
    nextOverlay.style.height = `${candidate.height}px`
    const label = nextOverlay.querySelector('[data-role="label"]')
    if (label) {
      label.textContent = candidate.label || '可滚动区域'
    }
  }

  function onPointerMove(event) {
    if (!bridgeActive || autoScrolling) {
      return
    }

    const candidate = findBestScrollableCandidate(event.clientX, event.clientY)
    currentCandidate = candidate

    if (!candidate) {
      hideOverlay()
      return
    }

    renderCandidate(candidate)
    const now = Date.now()
    if (now - lastHoverPostAt < HOVER_POST_INTERVAL) {
      return
    }

    lastHoverPostAt = now
    void postBridge('/api/hover', {
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
      label: candidate.label,
      url: location.href,
    })
  }

  function performScrollStep(candidate, previousTop) {
    const element = candidate.element
    const step = Math.max(160, Math.round(element.clientHeight * 0.72))
    if (element === document.scrollingElement || element === document.documentElement || element === document.body) {
      window.scrollBy({ top: step, behavior: 'auto' })
      return window.scrollY !== previousTop
    }

    element.scrollBy({ top: step, behavior: 'auto' })
    return element.scrollTop !== previousTop
  }

  function startAutoScroll(candidate) {
    if (autoScrollTimer) {
      window.clearInterval(autoScrollTimer)
    }

    autoScrolling = true
    let stalledCount = 0

    autoScrollTimer = window.setInterval(() => {
      const element = candidate.element
      const previousTop = element === document.scrollingElement || element === document.documentElement || element === document.body
        ? window.scrollY
        : element.scrollTop
      const moved = performScrollStep(candidate, previousTop)
      if (moved) {
        stalledCount = 0
        return
      }

      stalledCount += 1
      if (stalledCount < 3) {
        return
      }

      window.clearInterval(autoScrollTimer)
      autoScrollTimer = null
      autoScrolling = false
      void postBridge('/api/scroll-complete', { url: location.href })
    }, AUTO_SCROLL_INTERVAL)
  }

  function onPointerClick(event) {
    if (!bridgeActive || autoScrolling || !currentCandidate) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    const confirmedCandidate = currentCandidate
    void postBridge('/api/confirm', {
      x: confirmedCandidate.x,
      y: confirmedCandidate.y,
      width: confirmedCandidate.width,
      height: confirmedCandidate.height,
      label: confirmedCandidate.label,
      url: location.href,
    })

    startAutoScroll(confirmedCandidate)
  }

  function activateBridge() {
    if (bridgeActive) {
      return
    }

    bridgeActive = true
    document.addEventListener('mousemove', onPointerMove, true)
    document.addEventListener('click', onPointerClick, true)
  }

  function deactivateBridge() {
    bridgeActive = false
    autoScrolling = false
    currentCandidate = null
    hideOverlay()
    document.removeEventListener('mousemove', onPointerMove, true)
    document.removeEventListener('click', onPointerClick, true)
    if (autoScrollTimer) {
      window.clearInterval(autoScrollTimer)
      autoScrollTimer = null
    }
  }

  async function pollSession() {
    try {
      const response = await fetch(`${BRIDGE_BASE_URL}/api/session`)
      if (!response.ok) {
        deactivateBridge()
        return
      }

      const session = await response.json()
      if (session.active && session.mode === 'scroll') {
        activateBridge()
        return
      }

      deactivateBridge()
    } catch {
      deactivateBridge()
    }
  }

  sessionPollTimer = window.setInterval(() => {
    void pollSession()
  }, SESSION_POLL_INTERVAL)
  void pollSession()
})()
