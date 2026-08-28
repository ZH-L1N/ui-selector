import { execFileSync, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SOURCE_DIR, '../../..')
const OUTPUT = resolve(SOURCE_DIR, '..')
const FIXTURE_URL = 'http://localhost:8080/'

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

async function waitForFixture() {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(FIXTURE_URL)
      if (response.ok) return
    } catch {
      // The local server is still starting.
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
  }
  throw new Error(`fixture server did not become ready at ${FIXTURE_URL}`)
}

function markdownExcerpt(markdown) {
  const lines = markdown.split('\n')
  const wanted = [
    lines[0],
    '',
    '## Identity and locator',
    lines.find(line => line.startsWith('- Role:')),
    lines.find(line => line.startsWith('- Accessible name:')),
    lines.find(line => line.startsWith('- Visible text:')),
    lines.find(line => line.startsWith('- Locator:')),
  ]
  return wanted.filter(line => line !== undefined).join('\n')
}

function boardHtml(selectedData, panelData, excerpt) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { width: 1200px; height: 820px; margin: 0; }
  body {
    overflow: hidden;
    background: #f5f3ec;
    color: #12211e;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .board { position: relative; width: 1200px; height: 820px; border: 2px solid #cfd8d5; border-radius: 28px; overflow: hidden; }
  .kicker { position: absolute; left: 52px; top: 38px; color: #0a7766; font: 650 18px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 1.5px; }
  h1 { position: absolute; left: 52px; top: 58px; margin: 0; font-size: 36px; line-height: 1.1; letter-spacing: -1px; }
  .fixture { position: absolute; right: 52px; top: 50px; color: #5f706b; font: 600 17px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-align: right; }
  .stage { position: absolute; border-radius: 16px; background: #fff; border: 2px solid #cfd8d5; overflow: hidden; }
  .stage-label { position: absolute; z-index: 2; left: 16px; top: 14px; display: flex; align-items: center; gap: 10px; color: #12211e; font: 700 18px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .stage-label b { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 50%; background: #0a7766; color: #fff; font-size: 16px; }
  .select { left: 52px; top: 126px; width: 684px; height: 300px; }
  .select img { width: 100%; height: 100%; object-fit: cover; object-position: left top; }
  .select .stage-label { padding: 7px 10px; border-radius: 18px; background: rgba(255,255,255,.94); box-shadow: 0 2px 10px rgba(18,33,30,.14); }
  .target { position: absolute; left: 107px; top: 143px; width: 75px; height: 31px; border: 3px solid #0a7766; border-radius: 5px; box-shadow: 0 0 0 3px rgba(255,255,255,.92); }
  .select::after { content: "REAL PICKER OVERLAY"; position: absolute; right: 16px; bottom: 14px; padding: 7px 10px; border-radius: 7px; background: rgba(18,33,30,.9); color: #fff; font: 650 15px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .7px; }
  .panel { left: 770px; top: 126px; width: 378px; height: 642px; background: #e7f0ed; }
  .panel .stage-label { position: relative; left: 16px; top: 14px; height: 42px; }
  .panel-shot { position: absolute; left: 16px; right: 16px; top: 68px; bottom: 16px; border-radius: 11px; overflow: hidden; border: 1px solid #9fb0ab; background: #fff; }
  .panel-shot img { width: 100%; height: 100%; object-fit: cover; object-position: right top; }
  .prompt { left: 52px; top: 460px; width: 684px; height: 308px; padding: 68px 24px 20px; background: #12211e; border-color: #12211e; }
  .prompt .stage-label { color: #fff; }
  .prompt pre { margin: 0; color: #e9f3f0; white-space: pre-wrap; overflow-wrap: anywhere; font: 17px/1.48 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .prompt pre::first-line { color: #78c9b4; font-weight: 700; }
  .arrow { position: absolute; color: #0a7766; font: 700 28px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .arrow.one { left: 742px; top: 250px; }
  .arrow.two { left: 382px; top: 428px; transform: rotate(90deg); }
</style>
</head>
<body>
  <main class="board">
    <div class="kicker">REAL SYNTHETIC PROOF</div>
    <h1>Select → inspect → copy a sanitized brief</h1>
    <div class="fixture">COMMITTED FIXTURE<br>NO PRIVATE PAGE DATA</div>
    <section class="stage select">
      <div class="stage-label"><b>1</b> SELECT</div>
      <img src="data:image/png;base64,${selectedData}" alt="">
      <div class="target"></div>
    </section>
    <div class="arrow one">→</div>
    <section class="stage panel">
      <div class="stage-label"><b>2</b> INSPECT</div>
      <div class="panel-shot"><img src="data:image/png;base64,${panelData}" alt=""></div>
    </section>
    <div class="arrow two">→</div>
    <section class="stage prompt">
      <div class="stage-label"><b>3</b> COPY AS PROMPT</div>
      <pre>${escapeHtml(excerpt)}</pre>
    </section>
  </main>
</body>
</html>`
}

execFileSync('npm', ['run', 'build:test'], { cwd: ROOT, stdio: 'inherit' })

const server = spawn(process.execPath, [join(ROOT, 'tests/server.mjs'), join(ROOT, 'tests/fixtures/site'), '8080'], {
  cwd: ROOT,
  stdio: 'ignore',
})

let browser
try {
  await waitForFixture()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await page.addInitScript(() => {
    const NativeDate = Date
    const fixedNow = '2026-08-28T12:00:00.000Z'
    class FixedDate extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedNow]))
      }

      static now() {
        return NativeDate.parse(fixedNow)
      }
    }
    window.Date = FixedDate
  })
  await page.goto(FIXTURE_URL)
  await page.addScriptTag({ path: join(ROOT, 'dist/ui-selector.test.js') })

  const target = page.locator('[data-testid="cta"]')
  await page.evaluate(() => {
    window.__readmePick = window.__uiSelectorTest.pick()
  })
  await target.hover()
  await page.waitForTimeout(120)
  await page.screenshot({ path: join(SOURCE_DIR, 'selected.png'), clip: { x: 0, y: 0, width: 1280, height: 430 } })
  await target.click()

  const proof = await page.evaluate(() => {
    const result = window.__uiSelectorTest.runHeadless('[data-testid="cta"]')
    return { result, markdown: window.__uiSelectorTest.toMarkdown(result) }
  })
  await page.evaluate(result => window.__uiSelectorTest.showPanel(result, null), proof.result)
  await page.waitForTimeout(120)
  await page.screenshot({ path: join(SOURCE_DIR, 'panel.png'), clip: { x: 748, y: 0, width: 532, height: 800 } })

  const selectedData = (await readFile(join(SOURCE_DIR, 'selected.png'))).toString('base64')
  const panelData = (await readFile(join(SOURCE_DIR, 'panel.png'))).toString('base64')
  const board = await context.newPage()
  await board.setViewportSize({ width: 1200, height: 820 })
  await board.setContent(boardHtml(selectedData, panelData, markdownExcerpt(proof.markdown)), { waitUntil: 'load' })
  await board.screenshot({ path: join(OUTPUT, 'proof-board.png') })
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}
