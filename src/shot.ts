// src/shot.ts — one getDisplayMedia frame, cropped to the element's rect.
//
// Three decisions in here are each a fixed defect, not a preference:
//
//  1. Support is ONE fact: does navigator.mediaDevices.getDisplayMedia exist.
//     getSupportedConstraints() is not used anywhere. It enumerates *track*
//     constraints, and the Screen Capture spec's supported-constraint list does not
//     include preferCurrentTab — so probing it there reports the hint absent even on
//     Chromium, a detector that is systematically wrong rather than merely unreliable.
//     (The earlier draft also wrote
//     `'preferCurrentTab' in navigator.mediaDevices.getSupportedConstraints?.() ?? {}`,
//     which parses as `('preferCurrentTab' in undefined) ?? {}` because `in` binds
//     tighter than `??`: a TypeError instead of the intended omission.)
//
//  2. preferCurrentTab: true is passed UNCONDITIONALLY. It is a dictionary member, so
//     per WebIDL an engine that does not implement it ignores it. Chromium honours it;
//     Firefox and Safari show their own surface picker. Nothing to detect, no branch to
//     get wrong.
//
//  3. scale is video.videoWidth / window.innerWidth, NEVER devicePixelRatio. The
//     captured frame is not guaranteed to equal viewport x DPR.
import type { CaptureContext, Rect } from './types'

export interface Screenshot {
  canvas: HTMLCanvasElement
  rect: Rect
  scale: number
  clipped: boolean
}

// Both seams exist so the crop arithmetic can be driven deterministically — known
// stream contents, and an injectable failure — without any test mutating a global
// prototype. Production passes neither.
export interface ShotOptions {
  streamFactory?: () => Promise<MediaStream>
  canvasFactory?: () => HTMLCanvasElement
}

function displayCaptureSupported(): boolean {
  const md = navigator.mediaDevices
  return Boolean(md) && typeof md.getDisplayMedia === 'function'
}

// Two animation frames is NOT a frame-delivery guarantee: it can leave videoWidth at 0
// and crop a blank frame. Wait for the real signals, with a bounded fallback so a
// stream that never produces a frame cannot hang the tool.
// 8s, not 3s. The deadline starts only after getDisplayMedia resolves — i.e. after the
// user has already picked a surface — but a real first attempt still timed out at 3s
// during the Phase 0 manual check. A synthetic canvas.captureStream delivers instantly,
// so no automated test can find this boundary.
const FRAME_TIMEOUT_MS = 8000

async function firstFrame(video: HTMLVideoElement, timeoutMs = FRAME_TIMEOUT_MS): Promise<boolean> {
  // ONE deadline covering both waits. A trackless or dead stream never fires
  // loadedmetadata either, so bounding only the frame wait still hangs the tool
  // forever — which is exactly what a regression test on an empty MediaStream shows.
  const deadline = new Promise<boolean>(r => setTimeout(() => r(false), timeoutMs))
  if (video.readyState < 1) {
    const metadata = new Promise<boolean>(r =>
      video.addEventListener('loadedmetadata', () => r(true), { once: true }))
    if (!(await Promise.race([metadata, deadline]))) return false
  }
  const rvfc = (video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback
  const delivered = rvfc
    ? new Promise<boolean>(r => rvfc.call(video, () => r(true)))
    : new Promise<boolean>(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))
  const ok = await Promise.race([delivered, deadline])
  return ok && video.videoWidth > 0
}

export async function screenshot(
  el: Element,
  ctx: CaptureContext,
  opts: ShotOptions = {},
): Promise<Screenshot | null> {
  // Each attempt supersedes the last. The control is retryable, so a stale failure from a
  // previous click must not survive alongside a successful image — that combination hands
  // a consuming agent a screenshot and a "not captured" record for the same field.
  ctx.supersede('screenshot')
  const factory = opts.streamFactory
  if (!factory && !displayCaptureSupported()) {
    ctx.omit('screenshot', 'unsupported-browser', 'getDisplayMedia unavailable')
    return null
  }

  el.scrollIntoView({ block: 'nearest' })

  let stream: MediaStream
  try {
    stream = factory
      ? await factory()
      : await navigator.mediaDevices.getDisplayMedia(
          // preferCurrentTab is Chromium-only and not in lib.dom's dictionary type;
          // see note 2 in the header for why it is passed with no feature check.
          // No frameRate constraint. `frameRate: 1` saved nothing — we take exactly one frame —
        // and cost up to a full second of latency before the first one arrived, which is
        // what pushed a real attempt past the old deadline.
        { preferCurrentTab: true, video: true } as unknown as DisplayMediaStreamOptions,
        )
  } catch (err) {
    const name = err instanceof DOMException ? err.name : 'Error'
    if (name === 'NotAllowedError') ctx.omit('screenshot', 'user-declined', name)
    else ctx.omit('screenshot', 'unsupported-browser', name)
    return null
  }

  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    // Deliberately NOT awaited. play() on a stream that never produces media (a
    // trackless or already-ended MediaStream) returns a promise that never settles, so
    // awaiting it hangs past every timeout below. firstFrame() owns the waiting and it
    // is bounded; a rejection here (autoplay interruption) is not a capture failure.
    void video.play().catch(() => undefined)
    if (!(await firstFrame(video))) {
      ctx.omit('screenshot', 'no-frame-delivered', `no frame within ${FRAME_TIMEOUT_MS}ms; retrying may work`)
      return null
    }

    const scale = video.videoWidth / window.innerWidth
    const r = el.getBoundingClientRect()
    // Clamp to the viewport: the frame only ever contains what is on screen, so an
    // element taller or wider than the viewport is captured partially and says so.
    const left = Math.max(0, r.left)
    const top = Math.max(0, r.top)
    const right = Math.min(window.innerWidth, r.right)
    const bottom = Math.min(window.innerHeight, r.bottom)
    const width = Math.max(0, right - left)
    const height = Math.max(0, bottom - top)
    const clipped = width < r.width - 0.5 || height < r.height - 0.5
    if (clipped) {
      ctx.omit('screenshot', 'clipped-screenshot',
        `element is ${Math.round(r.width)}x${Math.round(r.height)}, captured ${Math.round(width)}x${Math.round(height)}`)
    }

    const canvas = (opts.canvasFactory ?? (() => document.createElement('canvas')))()
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const g = canvas.getContext('2d')
    if (!g) {
      ctx.omit('screenshot', 'unsupported-browser', 'no 2d context')
      return null
    }
    g.drawImage(video, left * scale, top * scale, width * scale, height * scale,
      0, 0, canvas.width, canvas.height)
    video.srcObject = null
    return { canvas, rect: { x: left, y: top, width, height }, scale, clipped }
  } finally {
    // The failure path matters as much as the success path: a live display-capture
    // track left running keeps the browser's "sharing" indicator up forever.
    for (const track of stream.getTracks()) track.stop()
  }
}
