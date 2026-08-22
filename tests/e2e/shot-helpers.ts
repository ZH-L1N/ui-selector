// tests/e2e/shot-helpers.ts — installed with page.addInitScript so every crop test
// shares one frame-readiness scheme instead of inventing its own.
//
// A canvas captureStream only produces frames while the canvas is actually drawn to,
// so this paints on a rAF loop — and hands back a stop() that cancels the loop AND
// ends the tracks. Each test calls stop() in a `finally`: a rejected screenshot must
// not leave a self-scheduling loop running for the rest of the page's life.
//
// Two markers, both load-bearing for the crop-offset assertion:
//  - a white square at SOURCE (0,0): a crop that wrongly sources from the frame
//    origin samples this instead of the background;
//  - an optional magenta square at a caller-chosen SOURCE coordinate (the element's
//    own rect × scale): only a crop sourcing from exactly that offset sees it at
//    its destination origin. Together they discriminate the offset, not just size.
export const DETERMINISTIC_STREAM = `
window.__mkStream = (scaleFactor, marker) => {
  const src = document.createElement('canvas')
  src.width = Math.round(window.innerWidth * scaleFactor)
  src.height = Math.round(window.innerHeight * scaleFactor)
  const c = src.getContext('2d')
  let frame = 0
  const paint = () => {
    c.fillStyle = '#0a7'; c.fillRect(0, 0, src.width, src.height)
    c.fillStyle = '#fff'; c.fillRect(0, 0, 40, 40)      // origin marker
    if (marker) { c.fillStyle = '#f0f'; c.fillRect(marker.x, marker.y, 12, 12) }
    frame = requestAnimationFrame(paint)
  }
  paint()
  const stream = src.captureStream(30)
  return { stream, stop: () => { cancelAnimationFrame(frame); stream.getTracks().forEach(t => t.stop()) } }
}`
