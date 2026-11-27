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
  await expect(page.locator('#case-status')).toHaveText('Liver and tumour meshes loaded.')
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
  await page.getByRole('link', { name: 'Explore HepatoPlan' }).click()
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
  await page.getByRole('link', { name: 'Explore HepatoPlan' }).click()
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
