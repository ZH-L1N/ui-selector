// tests/e2e/shot.spec.ts
import { expect, test } from '@playwright/test'
import { DETERMINISTIC_STREAM } from './shot-helpers'

test.beforeEach(async ({ page }) => { await page.addInitScript(DETERMINISTIC_STREAM) })

test('crops from the video scale, not devicePixelRatio', async ({ page }) => {
  await page.goto('http://localhost:8081/shot.html')
  // A canvas.captureStream() is a real MediaStream with dimensions we choose, so the
  // crop arithmetic is checked exactly, with no display-capture permission involved.
  const out = await page.evaluate(async () => {
    const el = document.getElementById('target')!
    const r = el.getBoundingClientRect()
    // A magenta marker at the element's own SOURCE-space position: only a crop
    // that sources from exactly (left*scale, top*scale) sees it at its origin.
    // A crop from the frame origin samples the white (0,0) marker instead, and
    // any other wrong offset samples the teal background — so the source
    // OFFSET is asserted, not just the canvas size.
    const { stream, stop } = window.__mkStream(3, { x: r.left * 3, y: r.top * 3 })  // 3x, deliberately NOT the DPR
    try {
      const ctx = window.__uiSelectorTest.ctx()
      const shot = await window.__uiSelectorTest.screenshot(el, ctx, {
        streamFactory: async () => stream,
      })
      const g = shot!.canvas.getContext('2d')!
      const at = (x: number, y: number) => Array.from(g.getImageData(x, y, 1, 1).data)
      return { scale: shot!.scale, w: shot!.canvas.width, h: shot!.canvas.height,
               expectW: Math.round(r.width * 3), expectH: Math.round(r.height * 3),
               dpr: devicePixelRatio, origin: at(3, 3), interior: at(60, 60) }
    } finally {
      stop()                                            // never leak the paint loop
    }
  })
  expect(out.scale).toBeCloseTo(3, 1)
  expect(out.scale).not.toBeCloseTo(out.dpr, 1)     // the bug this test exists to catch
  expect(out.w).toBe(out.expectW)
  expect(out.h).toBe(out.expectH)
  expect(out.origin).toEqual([255, 0, 255, 255])    // the marker planted at the element's source rect
  expect(out.interior).toEqual([0, 170, 119, 255])  // past the marker: plain background, not blank
})

test('clamps an oversized element to the viewport and reports clipped', async ({ page }) => {
  await page.goto('http://localhost:8081/shot.html')
  const out = await page.evaluate(async () => {
    const { stream, stop } = window.__mkStream(1)
    try {
      const ctx = window.__uiSelectorTest.ctx()
      const shot = await window.__uiSelectorTest.screenshot(document.getElementById('tall')!, ctx, {
        streamFactory: async () => stream,
      })
      return { h: shot!.canvas.height, clipped: shot!.clipped, vh: window.innerHeight,
               omissions: ctx.omissions }
    } finally { stop() }
  })
  expect(out.clipped).toBe(true)
  expect(out.h).toBeLessThanOrEqual(out.vh)
  expect(out.omissions.some(o => o.reason === 'clipped-screenshot')).toBe(true)
})

test('stops every track when the crop path throws', async ({ page }) => {
  await page.goto('http://localhost:8081/shot.html')
  const out = await page.evaluate(async () => {
    const { stream, stop } = window.__mkStream(1)
    try {
      // Force a failure INSIDE the crop, after the stream is live, through an injected
      // seam rather than by mutating HTMLCanvasElement.prototype. A global prototype
      // patch that is only restored after the awaited call leaves the whole page
      // poisoned if anything throws unexpectedly.
      const ctx = window.__uiSelectorTest.ctx()
      const result = await window.__uiSelectorTest
        .screenshot(document.getElementById('target')!, ctx, {
          streamFactory: async () => stream,
          canvasFactory: () => { throw new Error('forced crop failure') },
        })
        .then(() => 'resolved', () => 'rejected')
      return { result, ended: stream.getTracks().every(t => t.readyState === 'ended') }
    } finally { stop() }
  })
  expect(out.result).toBe('rejected')
  expect(out.ended).toBe(true)       // the assertion that needs a real failure to mean anything
})

test('emits an unsupported-browser omission when getDisplayMedia is absent', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
  })
  await page.goto('http://localhost:8081/shot.html')
  const omissions = await page.evaluate(async () => {
    const ctx = window.__uiSelectorTest.ctx()
    await window.__uiSelectorTest.screenshot(document.getElementById('target')!, ctx)
    return ctx.omissions
  })
  expect(omissions.some(o => o.reason === 'unsupported-browser')).toBe(true)
})

test('a browser without getSupportedConstraints still captures — support is getDisplayMedia alone', async ({ page }) => {
  // Spec §7: support is decided by the presence of getDisplayMedia and nothing else.
  // The old getSupportedConstraints probe is gone entirely, so this fixture — which
  // omits it — must behave exactly like a fully-featured browser.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: async () => (window as never as { __mkStream: (n: number) => { stream: MediaStream } })
          .__mkStream(1).stream,
        // no getSupportedConstraints at all
      },
    })
  })
  await page.goto('http://localhost:8081/shot.html')
  const out = await page.evaluate(async () => {
    const ctx = window.__uiSelectorTest.ctx()
    const shot = await window.__uiSelectorTest.screenshot(document.getElementById('target')!, ctx)
    return { got: Boolean(shot), omissions: ctx.omissions }
  })
  expect(out.got).toBe(true)
  expect(out.omissions.some(o => o.reason === 'unsupported-browser')).toBe(false)
})

test('records user-declined when the permission is refused', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: async () => { throw new DOMException('denied', 'NotAllowedError') } },
    })
  })
  await page.goto('http://localhost:8081/shot.html')
  const omissions = await page.evaluate(async () => {
    const ctx = window.__uiSelectorTest.ctx()
    await window.__uiSelectorTest.screenshot(document.getElementById('target')!, ctx)
    return ctx.omissions
  })
  expect(omissions.some(o => o.reason === 'user-declined')).toBe(true)
})

test('a frame timeout reports no-frame-delivered, NOT unsupported-browser', async ({ page }) => {
  // The distinction is the point. The browser supports capture; this attempt did not
  // deliver a frame. Labelling that 'unsupported-browser' told a consuming agent the
  // browser cannot screenshot at all — a different and false claim. Found by a real click
  // during the Phase 0 manual check: no synthetic stream is slow enough to reach here.
  await page.goto('http://localhost:8081/shot.html')
  const out = await page.evaluate(async () => {
    const ctx = window.__uiSelectorTest.ctx()
    const shot = await window.__uiSelectorTest.screenshot(document.getElementById('target')!, ctx, {
      streamFactory: async () => new MediaStream(),      // no tracks, so no frames ever
    })
    return { shot: shot === null, omissions: ctx.omissions }
  })
  expect(out.shot).toBe(true)
  expect(out.omissions.some(o => o.reason === 'no-frame-delivered')).toBe(true)
  expect(out.omissions.some(o => o.reason === 'unsupported-browser')).toBe(false)
})

test('a successful retry supersedes the previous attempt\'s failure record', async ({ page }) => {
  // The screenshot control is retryable, and a real user clicked it twice: the first
  // attempt timed out, the second succeeded, and the panel then showed an image ALONGSIDE
  // "screenshot — not captured". Copy JSON would have handed an agent both facts at once.
  await page.addInitScript(DETERMINISTIC_STREAM)
  await page.goto('http://localhost:8081/shot.html')
  const out = await page.evaluate(async () => {
    const ctx = window.__uiSelectorTest.ctx()
    const el = document.getElementById('target')!

    // Attempt 1: a trackless stream, so it times out and records the failure.
    const first = await window.__uiSelectorTest.screenshot(el, ctx, {
      streamFactory: async () => new MediaStream(),
    })
    const afterFirst = ctx.omissions.filter(o => o.field === 'screenshot').length

    // Attempt 2: a real frame source, exactly as clicking the control again would do.
    const { stream, stop } = window.__mkStream(1)
    try {
      const second = await window.__uiSelectorTest.screenshot(el, ctx, {
        streamFactory: async () => stream,
      })
      return {
        firstWasNull: first === null,
        afterFirst,
        secondGotImage: Boolean(second && second.canvas.width > 0),
        screenshotOmissionsAfterRetry: ctx.omissions.filter(o => o.field === 'screenshot').length,
        otherOmissionsSurvived: ctx.omissions.filter(o => o.field !== 'screenshot').length,
      }
    } finally {
      stop()
    }
  })
  expect(out.firstWasNull).toBe(true)
  expect(out.afterFirst).toBe(1)                      // the failure was recorded
  expect(out.secondGotImage).toBe(true)
  expect(out.screenshotOmissionsAfterRetry).toBe(0)   // ...and then superseded
})

test('superseding screenshot omissions leaves other fields untouched', async ({ page }) => {
  await page.goto('http://localhost:8081/shot.html')
  const out = await page.evaluate(async () => {
    const ctx = window.__uiSelectorTest.ctx()
    ctx.omit('styles.matchedRules', 'cross-origin-stylesheet', 'http://elsewhere/a.css')
    await window.__uiSelectorTest.screenshot(document.getElementById('target')!, ctx, {
      streamFactory: async () => new MediaStream(),
    })
    return ctx.omissions.map(o => o.field)
  })
  expect(out).toContain('styles.matchedRules')        // a different field must survive
  expect(out).toContain('screenshot')
})
