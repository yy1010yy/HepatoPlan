import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const output = new URL('../src/assets/studies/', import.meta.url)
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)),
  server: { host: '127.0.0.1', port: 0, hmr: false } })
try {
  await server.listen()
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 420 } })
    await page.route(origin + '/capture', route => route.fulfill({
      contentType: 'text/html',
      body: '<div id="study" style="width:560px;height:360px;background:#090e17"></div>',
    }))
    await page.goto(origin + '/capture')
    const release = await page.evaluate(async () => {
      const { loadCaseIndex, loadCaseBundle } = await import('/src/planning/case-loader.ts')
      const { defaultPlane, normalAtAngle } = await import('/src/planning/plane-controls.ts')
      const { PreparedCase } = await import('/src/planning/volumetry.ts')
      const { mountResectionViewer } = await import('/src/planning/resection-viewer.ts')
      const index = await loadCaseIndex(new URL('/cases/index.json', location.href))
      const caseId = 'case-002'
      const { labels, ...assets } = await loadCaseBundle(index, caseId)
      const prepared = new PreparedCase(assets.metadata, new Uint8Array(labels))
      const centred = defaultPlane(assets.liver.bounds)
      let publish
      mountResectionViewer(document.getElementById('study'), {
        subscribe(listener) { publish = listener; return () => {} },
      }, { rotateOnly: true })
      window.captureStudy = async (angleDeg, revision) => {
        const plane = { ...centred, unitNormal: normalAtAngle(angleDeg) }
        const result = prepared.evaluate(plane)
        publish({ ...assets, caseId, status: 'ready', selectionToken: 1, revision, plane,
          comparison: { status: 'idle' }, measurements: { status: 'ready', result } })
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return { angleDeg, remainingMl: result.remainingMl, flrPercent: result.flrPercent }
      }
      return { caseId, releaseId: index.index.releaseId }
    })
    await mkdir(output, { recursive: true })
    const studies = []
    for (const [key, angle] of [['centre', 0], ['tilted', 35]]) {
      studies.push({ key, ...await page.evaluate(
        ({ angle, revision }) => window.captureStudy(angle, revision), { angle, revision: studies.length + 1 },
      ) })
      await page.locator('#study').screenshot({ path: fileURLToPath(new URL(key + '.png', output)) })
    }
    await writeFile(new URL('readings.json', output), JSON.stringify({ ...release, studies }, null, 2) + '\n')
  } finally {
    await browser.close()
  }
} finally {
  await server.close()
}
