import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const caseIds = ['case-001', 'case-002', 'case-003']
const release = '/demo/cases/releases/research-2/'
const indexPattern = '**/cases/index.json'

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

function choose(page: Page) {
  return page.getByRole('button', { name: 'Choose case', exact: true })
}

async function openCase(page: Page, id: string) {
  await choose(page).click()
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(id) }).click()
}

async function expectReady(page: Page, id: string) {
  await expect(page.locator('#active-case')).toHaveText(id)
  await expect(page.locator('#case-status')).toHaveText('Liver and tumour meshes loaded.', { timeout: 15_000 })
  await expect(page.locator('#case-extent')).toContainText('mm')
  await expect(page.locator('#remaining')).toHaveText(/[\d,.]+ mL/)
  await expect(page.locator('#flr')).toHaveText(/[\d,.]+%/)
}

test('the built landing and workspace reuse the demo and load all packaged cases', async ({ page, request }) => {
  const catalogue = await request.get('cases/index.json')
  expect(catalogue.ok()).toBeTruthy()
  expect(await catalogue.json()).toEqual({
    schemaVersion: 1, releaseId: 'research-2', cases: caseIds.map(caseId => ({ caseId })),
  })
  const attribution = await request.get('cases/releases/research-2/ATTRIBUTION.txt')
  expect(attribution.ok()).toBeTruthy()
  expect((await attribution.text()).trim()).not.toBe('')

  const requests: string[] = []
  const assetResponses: string[] = []
  let workerStarts = 0
  page.on('worker', () => { workerStarts++ })
  page.on('request', req => requests.push(new URL(req.url()).pathname))
  page.on('response', res => {
    if (res.ok()) assetResponses.push(new URL(res.url()).pathname)
  })
  const demoMetadata = '**/case-002/metadata.json'
  const releaseDemo = gate()
  await page.route(demoMetadata, async route => {
    await releaseDemo.promise
    await route.continue()
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  const metadataRequest = page.waitForRequest(demoMetadata)
  const worker = page.waitForEvent('worker')
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/See Beyond 2D\.\s*Plan in 3D/)
  const [copy, viewport] = await page.locator('.hero').evaluate(node => (
    getComputedStyle(node).gridTemplateColumns.split(' ').map(parseFloat)
  ))
  expect(viewport).toBeCloseTo(copy * 7 / 5)
  await metadataRequest
  await page.locator('#explore').click()
  await expect(page.locator('#case-status')).toHaveText('Loading case-002…')
  releaseDemo.release()
  expect(new URL((await worker).url()).pathname).toMatch(/^\/demo\/assets\/volumetry\.worker-.*\.js$/)
  await expectReady(page, 'case-002')
  await expect(page.getByRole('link', { name: 'Compare' })).toBeDisabled()
  await expect(page.locator('#compare-status')).toHaveText('Save two plans to compare.')
  const widths = await page.locator('.plan-layout').evaluate(node => (
    getComputedStyle(node).gridTemplateColumns.split(' ').map(parseFloat)
  ))
  expect(widths).toHaveLength(3)
  expect(widths[1]).toBeCloseTo(widths[0] * 2)
  expect(widths[2]).toBeCloseTo(widths[0])

  await page.goBack()
  await expect(page.locator('#demo-status')).toHaveText('Liver and tumour meshes loaded.')
  await page.locator('#explore').click()
  await expectReady(page, 'case-002')
  await openCase(page, 'case-002')
  await expect(choose(page)).toBeFocused()
  expect(requests.filter(path => path === release + 'case-002/metadata.json')).toHaveLength(1)
  expect(requests.filter(path => path.endsWith('/cases/index.json'))).toHaveLength(1)
  expect(workerStarts).toBe(1)

  for (const id of ['case-001', 'case-003']) {
    await openCase(page, id)
    await expectReady(page, id)
  }
  for (const id of caseIds) {
    for (const filename of ['metadata.json', 'labels.bin', 'liver.stl', 'tumour.stl']) {
      expect(assetResponses).toContain(`${release}${id}/${filename}`)
    }
  }
})

test('the chooser contains keyboard focus and restores its opener on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#plan')
  await expectReady(page, 'case-002')
  await page.keyboard.press('Tab')
  await choose(page).focus()
  await expect(choose(page)).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'case-002 Active' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel' }).focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'case-001' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(choose(page)).toBeFocused()
  expect(await page.locator('body').evaluate(body => body.scrollWidth)).toBe(390)
})

test('real anatomy renders in both views and the cameras leave measurements alone', async ({ page }) => {
  await page.addInitScript(() => {
    const draw = WebGL2RenderingContext.prototype.drawArrays
    WebGL2RenderingContext.prototype.drawArrays = function (mode, first, count) {
      if (count > 10_000) {
        const canvas = this.canvas as HTMLCanvasElement
        const sizes = new Set((canvas.dataset.meshVertexCounts ?? '').split(' ').filter(Boolean))
        sizes.add(String(count))
        canvas.dataset.meshVertexCounts = [...sizes].join(' ')
      }
      draw.call(this, mode, first, count)
    }
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('./')
  const host = page.getByRole('group', { name: '3D liver model' })
  const canvas = host.locator('canvas')
  // The two prepared STL files have different vertex counts and issue separate draw calls.
  await expect(canvas).toHaveAttribute('data-mesh-vertex-counts', /^\d+ \d+$/)
  const hero = await canvas.elementHandle()
  const heroView = await canvas.screenshot()
  await host.press('Shift+ArrowRight')
  await host.press('Equal')
  expect((await canvas.screenshot()).equals(heroView)).toBe(true)
  await host.press('ArrowRight')
  expect((await canvas.screenshot()).equals(heroView)).toBe(false)

  await page.locator('#explore').click()
  await expectReady(page, 'case-002')
  await expect(canvas).toHaveAttribute('data-mesh-vertex-counts', /^\d+ \d+$/)
  expect(await hero!.evaluate(node => !node.isConnected
    && (node as HTMLCanvasElement).getContext('webgl2')?.isContextLost())).toBe(true)
  const remaining = await page.locator('#remaining').textContent()
  const flr = await page.locator('#flr').textContent()
  for (const key of ['ArrowLeft', 'Shift+ArrowRight', 'Equal', 'Minus']) {
    const before = await canvas.screenshot()
    await host.press(key)
    expect((await canvas.screenshot()).equals(before)).toBe(false)
  }
  await expect(page.locator('#remaining')).toHaveText(remaining!)
  await expect(page.locator('#flr')).toHaveText(flr!)
  const desktopWidth = await canvas.evaluate(node => (node as HTMLCanvasElement).width)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => canvas.evaluate(node => (node as HTMLCanvasElement).width)).toBeLessThan(desktopWidth)
  await expect(page.getByRole('list', { name: 'Anatomy legend' })).toBeVisible()

  await openCase(page, 'case-001')
  await expectReady(page, 'case-001')
  await page.getByRole('link', { name: 'HepatoPlan home' }).click()
  await expect(canvas).toHaveAttribute('data-mesh-vertex-counts', /^\d+ \d+$/)
  await expect(page.locator('#demo-id')).toHaveText('case-002')
})

test('WebGL startup and context loss can retry independently of measurements', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        if (type === 'webgl2' && !document.documentElement.hasAttribute('data-allow-webgl')) return null
        return Reflect.apply(getContext, this, [type, ...args])
      },
    })
  })
  let workers = 0
  page.on('worker', () => { workers++ })
  await page.goto('./#plan')
  await expectReady(page, 'case-002')
  const retry = page.getByRole('button', { name: 'Retry 3D view' })
  const host = page.getByRole('group', { name: '3D liver model' })
  await expect(retry).toBeVisible()
  await page.evaluate(() => document.documentElement.setAttribute('data-allow-webgl', ''))
  await retry.press('Enter')
  await expect(host.locator('canvas')).toBeVisible()
  await expect(host).toBeFocused()
  await host.locator('canvas').evaluate(node => {
    const extension = (node as HTMLCanvasElement).getContext('webgl2')?.getExtension('WEBGL_lose_context')
    if (!extension) throw new Error('Chrome does not expose WEBGL_lose_context')
    extension.loseContext()
  })
  await expect(retry).toBeVisible()
  await expectReady(page, 'case-002')
  await retry.click()
  await expect(host.locator('canvas')).toBeVisible()
  await expectReady(page, 'case-002')
  expect(workers).toBe(1)
})

test('an empty or invalid catalogue can be retried from the chooser', async ({ page }) => {
  let attempt = 0
  await page.route(indexPattern, route => {
    attempt++
    if (attempt === 1) return route.fulfill({ json: { schemaVersion: 1, releaseId: 'research-2', cases: [] } })
    if (attempt === 2) return route.fulfill({ json: { schemaVersion: 2 } })
    return route.continue()
  })
  await page.goto('./#plan')
  await expect(page.locator('#case-status')).toHaveText('No prepared cases available.')
  await choose(page).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('No prepared cases available.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Retry' }).click()
  await expect(dialog.getByRole('status')).toContainText('Cannot load case index')
  await dialog.getByRole('button', { name: 'Retry' }).click()
  await expect(dialog.getByRole('button', { name: /case-002/ })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await dialog.getByRole('button', { name: 'case-001' }).click()
  await expectReady(page, 'case-001')
})

test('a missing demo offers the other prepared cases when entering from Landing', async ({ page }) => {
  await page.route(indexPattern, route => route.fulfill({
    json: { schemaVersion: 1, releaseId: 'research-2', cases: [{ caseId: 'case-001' }, { caseId: 'case-003' }] },
  }))
  await page.goto('./')
  await expect(page.locator('#demo-status')).toHaveText('Demo case case-002 is unavailable.')
  await page.getByRole('button', { name: 'Choose another case' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: /case-002/ })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'case-003' }).click()
  await expectReady(page, 'case-003')
})

test('case failures offer retry and earlier selections cannot replace the current case', async ({ page }) => {
  await page.goto('./#plan')
  await expectReady(page, 'case-002')
  let attempt = 0
  await page.route('**/case-001/metadata.json', route => {
    attempt++
    if (attempt === 1) return route.fulfill({ status: 404 })
    if (attempt === 2) return route.fulfill({ json: {} })
    return route.continue()
  })
  await openCase(page, 'case-001')
  await expect(page.locator('#case-status')).toContainText('HTTP 404')
  await expect(page.locator('#case-extent')).toBeHidden()
  await expect(page.locator('#remaining')).toHaveText('—')
  await expect(page.getByRole('button', { name: 'Choose another case' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('#case-status')).toContainText('Invalid metadata')
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expectReady(page, 'case-001')

  const response = gate()
  const heldRequest = gate()
  await page.route('**/case-002/metadata.json', async route => {
    heldRequest.release()
    await response.promise
    await route.continue()
  })
  await openCase(page, 'case-002')
  await heldRequest.promise
  await expect(page.locator('#case-status')).toHaveText('Loading case-002…')
  await expect(page.locator('#case-extent')).toBeHidden()
  await expect(page.locator('#remaining')).toHaveText('—')
  await expect(page.locator('#flr')).toHaveText('—')
  await openCase(page, 'case-003')
  await expectReady(page, 'case-003')
  response.release()
  await page.unrouteAll({ behavior: 'wait' })
  await expectReady(page, 'case-003')
})

test('landing navigation and fixed study readings agree with the live demo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./')
  const headings = await page.locator('#landing-title, #challenge h2, #solution h2, #comparison h2, .closing-cta h2').allTextContents()
  expect(headings).toEqual(['See Beyond 2D.Plan in 3D', 'The Challenge', 'Our Solution',
    'Same liver, two cuts', 'Making complex anatomy easier to explore'])
  await page.locator('.landing-menu summary').press('Enter')
  await page.getByRole('navigation', { name: 'Landing' }).getByRole('link', { name: 'Comparison' }).click()
  await expect(page).toHaveURL(/#comparison$/)
  await expect(page.locator('.landing-menu')).not.toHaveAttribute('open', '')
  const methods = page.getByText('How measurements work', { exact: true })
  await expect(page.locator('#methods')).not.toHaveAttribute('open', '')
  await methods.press('Enter')
  await expect(page.getByText('Counts labelled liver tissue', { exact: false })).toBeVisible()
  const values = []
  for (const cut of ['centre', 'tilted']) {
    const study = page.locator(`[data-study="${cut}"]`)
    await study.scrollIntoViewIfNeeded()
    await expect.poll(() => study.locator('img').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(560)
    values.push(await study.locator('dd').allTextContents())
  }
  await page.locator('.closing-cta').getByRole('link', { name: 'Explore HepatoPlan' }).click()
  await expectReady(page, 'case-002')
  await expect(page.locator('#remaining')).toHaveText(values[0][0])
  await expect(page.locator('#flr')).toHaveText(values[0][1])
  await page.getByRole('slider', { name: 'Plane angle' }).fill('35')
  await expect(page.locator('#remaining')).toHaveText(values[1][0])
  await expect(page.locator('#flr')).toHaveText(values[1][1])
})

test('local CT preview keeps filename only, restores focus, and enters the demo', async ({ page }) => {
  const sent: string[] = []
  page.on('request', request => {
    if (request.method() !== 'GET' || /fake-scan/.test(request.url())) sent.push(request.url())
  })
  const file = { name: 'fake-scan.nii.gz', mimeType: 'application/octet-stream', buffer: Buffer.from('test-only') }
  await page.goto('./')
  const landingUpload = page.getByRole('button', { name: 'Try a CT upload', exact: true })
  await landingUpload.click()
  const upload = page.getByRole('dialog', { name: 'Try a CT upload' })
  const proceed = upload.getByRole('button', { name: 'Continue with demo case' })
  await expect(upload.getByText('Your scan stays on this device.', { exact: false })).toBeVisible()
  await expect(proceed).toBeDisabled()
  await page.locator('#ct-file').setInputFiles(file)
  await expect(upload.getByText(file.name, { exact: true })).toBeVisible()
  await expect(proceed).toBeEnabled()
  await page.locator('#ct-file').dispatchEvent('cancel')
  await expect(upload.getByText(file.name, { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(landingUpload).toBeFocused()
  await landingUpload.click()
  await expect(proceed).toBeDisabled()
  await page.locator('#ct-file').setInputFiles(file)
  await proceed.click()
  await expectReady(page, 'case-002')
  await openCase(page, 'case-001')
  await expectReady(page, 'case-001')
  await choose(page).click()
  const chooser = page.getByRole('dialog', { name: 'Choose a prepared case' })
  const chooserUpload = chooser.getByRole('button', { name: 'Try a CT upload' })
  await chooserUpload.click()
  await page.keyboard.press('Escape')
  await expect(chooser).toBeVisible()
  await expect(chooserUpload).toBeFocused()
  await chooserUpload.click()
  await page.locator('#ct-file').setInputFiles(file)
  await proceed.click()
  await expectReady(page, 'case-002')
  await expect(chooser).toBeHidden()
  await expect(page.getByText(file.name, { exact: true })).toHaveCount(0)
  expect(sent).toEqual([])
})

test('plane edits clear old readings until the latest worker result and recover from a calculation error', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', event => {
          if (event.data.type !== 'result' || !document.documentElement.hasAttribute('data-hold-result')) return
          event.stopImmediatePropagation()
          document.documentElement.setAttribute('data-result-held', '')
          window.addEventListener('release-result', release => {
            document.documentElement.removeAttribute('data-hold-result')
            document.documentElement.removeAttribute('data-result-held')
            const error = (release as CustomEvent).detail
            this.dispatchEvent(new MessageEvent('message', {
              data: error ? { ...event.data, type: 'calculationError', message: 'Test calculation failure' } : event.data,
            }))
          }, { once: true })
        })
      }
    }
  })
  await page.goto('./#plan')
  await expectReady(page, 'case-002')
  const angle = page.getByRole('slider', { name: 'Plane angle' })
  const offset = page.getByRole('slider', { name: 'Plane offset' })
  const save = page.getByRole('button', { name: 'Save plan' })
  await expect(save).toBeEnabled()
  await expect(page.locator('#flr-bar')).toBeVisible()
  await page.getByRole('button', { name: 'Flip removal side' }).click()
  await page.getByRole('button', { name: 'Positive offset' }).click()
  await expect(offset).toHaveAttribute('aria-valuetext', /^\+\d+ mm$/)
  await expect(angle).toHaveAttribute('aria-valuetext', '+14°')
  await expect(page.locator('.removal-side')).toContainText('negative')
  await page.getByRole('button', { name: 'Reset plane' }).click()
  await expect(offset).toHaveAttribute('aria-valuetext', '0 mm')
  await expect(angle).toHaveAttribute('aria-valuetext', '0°')
  await expect(page.locator('.removal-side')).toContainText('positive')
  await expectReady(page, 'case-002')
  const remaining = await page.locator('#remaining').textContent()
  await page.getByRole('checkbox', { name: 'Show plane' }).uncheck()
  await page.getByRole('slider', { name: 'Liver opacity' }).fill('25')
  await expect(page.locator('#remaining')).toHaveText(remaining!)
  await page.evaluate(() => document.documentElement.setAttribute('data-hold-result', ''))
  await offset.press('ArrowLeft')
  await expect(page.locator('html')).toHaveAttribute('data-result-held', '')
  await angle.fill('-23')
  await expect(angle).toHaveAttribute('aria-valuetext', '−23°')
  await expect(page.locator('#remaining')).toHaveText('—')
  await expect(page.locator('#flr-bar')).toHaveCount(0)
  await expect(save).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event('release-result')))
  await expectReady(page, 'case-002')
  await expect(page.locator('#remaining')).not.toHaveText(remaining!)
  await page.evaluate(() => document.documentElement.setAttribute('data-hold-result', ''))
  await angle.press('ArrowRight')
  await expect(page.locator('html')).toHaveAttribute('data-result-held', '')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('release-result', { detail: true })))
  await expect(page.locator('#measurement-status')).toHaveText('Test calculation failure')
  await expect(angle).toBeEnabled()
  await expect(save).toBeDisabled()
  await page.getByRole('button', { name: 'Retry measurements' }).click()
  await expectReady(page, 'case-002')
  await expect(save).toBeEnabled()
})
