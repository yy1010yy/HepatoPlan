import { mkdir, writeFile } from 'node:fs/promises'
import { cpus, platform } from 'node:os'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import type { CaseIndex } from '../src/planning/case-contract.ts'

async function tabTo(page: Page, control: Locator) {
  for (let i = 0; i < 55; i++) {
    if (await control.evaluate(node => node === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  await expect(control).toBeFocused()
}

async function activate(page: Page, control: Locator) {
  await tabTo(page, control)
  await page.keyboard.press('Enter')
}

function saveButton(page: Page) {
  return page.locator('#save-plan')
}

async function saveWithKeyboard(page: Page, name: string) {
  await expect(saveButton(page)).toBeEnabled()
  await activate(page, saveButton(page))
  const dialog = page.getByRole('dialog', { name: 'Save plan' })
  await expect(dialog.getByLabel('Plan name')).toBeFocused()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(name)
  await activate(page, dialog.getByRole('button', { name: 'Save plan', exact: true }))
  await expect(dialog).toBeHidden()
  await expect(saveButton(page)).toBeFocused()
}

test('the production server revalidates the index and caches every versioned release file', async ({ request }) => {
  const catalogue = await request.get('cases/index.json')
  expect(catalogue.ok()).toBe(true)
  expect(catalogue.headers()['cache-control']).toBe('no-cache')
  const validator = catalogue.headers().etag
  expect(validator).toBeTruthy()
  const revalidated = await request.get('cases/index.json', { headers: { 'If-None-Match': validator } })
  expect(revalidated.status()).toBe(304)
  const index: CaseIndex = await catalogue.json()
  expect(index.releaseId).toBe('research-2')
  expect(index.cases.map(entry => entry.caseId)).toEqual(['case-001', 'case-002', 'case-003'])
  const expectedFiles = ['ATTRIBUTION.txt', ...index.cases.flatMap(({ caseId }) =>
    ['metadata.json', 'labels.bin', 'liver.stl', 'tumour.stl'].map(asset => `${caseId}/${asset}`))]
  const results = await Promise.all(expectedFiles.map(file => request.head(`cases/releases/${index.releaseId}/${file}`)))
  for (const result of results) {
    expect(result.status(), result.url()).toBe(200)
    expect(result.headers()['cache-control'], result.url()).toBe('public, max-age=31536000, immutable')
    expect(Number(result.headers()['content-length']), result.url()).toBeGreaterThan(0)
  }
})

test('Plan keeps the model and readings in view while editing across sizes', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#plan')
  await expect(saveButton(page)).toBeEnabled()
  const angle = page.getByRole('slider', { name: 'Plane angle' })
  for (const [width, height, key, signed] of [
    [390, 844, 'ArrowRight', '+1°'],
    [820, 900, 'ArrowLeft', '0°'],
    [1440, 900, 'ArrowLeft', '−1°'],
    [844, 390, 'ArrowRight', '0°'],
  ] as const) {
    await page.setViewportSize({ width, height })
    // Focus reaches the range from the editing sequence rather than relying on a pointer.
    await page.getByRole('slider', { name: 'Plane offset' }).focus()
    await page.keyboard.press('Tab')
    await expect(angle).toBeFocused()
    await expect(angle).toHaveCSS('outline-style', 'solid')
    const previous = await page.locator('#remaining').textContent()
    await page.keyboard.press(key)
    await expect(angle).toHaveAttribute('aria-valuetext', signed)
    await expect(saveButton(page)).toBeEnabled()
    await expect(page.locator('#remaining')).not.toHaveText(previous!)
    await expect.poll(() => page.evaluate(({ width, height }) => {
      const range = document.querySelector('#plane-angle')!.getBoundingClientRect()
      const canvas = document.querySelector('.plan-viewport canvas')!.getBoundingClientRect()
      const flr = document.querySelector('#flr')!.getBoundingClientRect()
      const primary = document.querySelector('.plan-preview')!.getBoundingClientRect()
      return {
        width: document.body.scrollWidth,
        modelVisible: canvas.top >= -1 && canvas.bottom <= height,
        readingsVisible: flr.top >= 0 && flr.bottom <= height,
        sliderVisible: range.top >= 0 && range.bottom <= height,
        sliderUncovered: width >= 1024 || range.top >= primary.bottom,
      }
    }, { width, height }), { message: `Edit visibility at ${width} × ${height}` }).toEqual({
      width, modelVisible: true, readingsVisible: true, sliderVisible: true, sliderUncovered: true,
    })
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => page.locator('.plan-preview').evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(0)
})

test('at 390 px a keyboard user can navigate Landing, save two plans, and compare or open either one', async ({ page }) => {
  test.setTimeout(110_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./')
  const menu = page.locator('.landing-menu')
  await activate(page, menu.locator('summary'))
  await activate(page, menu.getByRole('link', { name: 'Comparison', exact: true }))
  await expect(page).toHaveURL(/#comparison$/)
  await expect(menu).not.toHaveAttribute('open', '')
  const methods = page.locator('#methods')
  await activate(page, methods.locator('summary'))
  await expect(methods).toHaveAttribute('open', '')
  const studies = page.locator('.studies > *')
  const tops = await studies.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top))
  expect(tops).toEqual([...tops].sort((a, b) => a - b))
  for (const key of ['centre', 'tilted']) {
    const study = page.locator(`[data-study="${key}"]`)
    await expect(study.locator('img')).toBeVisible()
    await expect(study.locator('dd')).toHaveCount(2)
  }
  await activate(page, page.locator('.closing-cta').getByRole('link', { name: 'Explore HepatoPlan' }))
  await expect(page.locator('#active-case')).toHaveText('case-002')
  await expect(page.locator('#workspace-title')).toBeFocused()

  await saveWithKeyboard(page, 'Centre cut with a deliberately long saved plan name')
  const angle = page.getByRole('slider', { name: 'Plane angle' })
  await tabTo(page, angle)
  await page.keyboard.press('ArrowLeft')
  await expect(angle).toHaveAttribute('aria-valuetext', '−1°')
  await saveWithKeyboard(page, 'Tilted cut with a second long saved plan name')
  await saveWithKeyboard(page, 'Reference copy')
  await activate(page, page.getByRole('button', { name: 'Compare these plans' }))
  const table = page.getByRole('table', { name: 'Saved measurements' })
  const planA = page.getByRole('combobox', { name: 'Plan A' })
  const planB = page.getByRole('combobox', { name: 'Plan B' })
  await tabTo(page, planA)
  await page.keyboard.press('Home')
  await expect(table.getByRole('columnheader', { name: /^A Centre cut/ })).toBeVisible()
  await tabTo(page, planB)
  await page.keyboard.press('Home')
  await expect(table.getByRole('columnheader', { name: /^B Tilted cut/ })).toBeVisible()
  await activate(page, page.getByRole('button', { name: 'Swap A/B' }))
  await expect(table.getByRole('columnheader', { name: /^A Tilted cut/ })).toBeVisible()
  const toggle = page.getByRole('checkbox', { name: 'Show differences' })
  await tabTo(page, toggle)
  await page.keyboard.press('Space')
  await expect(page.getByRole('list', { name: 'Difference volumes' }).locator('strong').first()).toHaveText(/mL$/)
  const anatomy = page.getByRole('group', { name: '3D difference model' })
  await tabTo(page, anatomy)
  await page.keyboard.press('ArrowRight')
  expect(await page.evaluate(() => {
    const table = document.querySelector('.comparison-table')!
    const [, a, b] = [...table.querySelectorAll('thead th')].map(node => node.getBoundingClientRect())
    const model = document.querySelector('.differences')!.getBoundingClientRect()
    return document.body.scrollWidth === 390 && a.right === b.left && model.top >= table.getBoundingClientRect().bottom
  })).toBe(true)
  await activate(page, page.getByRole('button', { name: 'Back to planning' }))
  await expect(angle).toHaveValue('-1')
  await activate(page, page.getByRole('link', { name: 'Compare', exact: true }))
  await activate(page, page.getByRole('button', { name: 'Open Plan B' }))
  await expect(angle).toHaveValue('0')
  await activate(page, page.getByRole('link', { name: 'Compare', exact: true }))
  await activate(page, page.getByRole('button', { name: 'Open Plan A' }))
  await expect(angle).toHaveValue('-1')
  const saved = page.getByRole('button', { name: /^Saved plans/ })
  await activate(page, saved)
  await page.keyboard.press('Escape')
  await expect(saved).toBeFocused()
})

test('production demo input timing', async ({ page, browser, request }) => {
  test.skip(!process.env.HEPATOPLAN_APP_TIMING, 'Run separately to avoid contention during timing.')
  test.setTimeout(160_000)
  const index: CaseIndex = await (await request.get('cases/index.json')).json()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('./#plan')
  await expect(saveButton(page)).toBeEnabled()
  const canvas = page.locator('.plan-viewport canvas')
  await expect(canvas).toBeVisible()
  const renderer = await canvas.evaluate(node => {
    const gl = (node as HTMLCanvasElement).getContext('webgl2')!
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    return gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) as string
  })
  await page.evaluate(() => {
    let inputAt: number | undefined
    const samples: number[] = []
    const button = document.querySelector<HTMLButtonElement>('#save-plan')!
    const mark = () => { inputAt = performance.now() }
    document.querySelector('#plane-offset')!.addEventListener('input', mark)
    document.querySelector('.presets')!.addEventListener('click', mark, { capture: true })
    new MutationObserver(() => {
      if (inputAt === undefined || button.disabled) return
      const start = inputAt
      inputAt = undefined
      requestAnimationFrame(() => requestAnimationFrame(() => {
        samples.push(performance.now() - start)
        document.documentElement.dataset.inputTiming = JSON.stringify(samples)
      }))
    }).observe(button, { attributes: true, attributeFilter: ['disabled'] })
  })
  for (let i = 0; i < 30; i++) {
    if (i < 20) await page.getByRole('slider', { name: 'Plane offset' }).press(i % 2 ? 'ArrowLeft' : 'ArrowRight')
    else await page.getByRole('button', { name: i % 2 ? 'Positive offset' : 'Negative offset' }).click()
    await expect.poll(() => page.evaluate(() =>
      JSON.parse(document.documentElement.dataset.inputTiming ?? '[]').length)).toBe(i + 1)
  }
  const samples: number[] = JSON.parse((await page.locator('html').getAttribute('data-input-timing'))!)
  const ordered = [...samples].sort((a, b) => a - b)
  const report = {
    releaseId: index.releaseId, caseId: 'case-002', browser: `Chromium ${browser.version()}`,
    renderer, cpu: cpus()[0]?.model.trim(), platform: platform(), targetInputP95Ms: 150,
    inputP50Ms: ordered[14], inputP95Ms: ordered[28], sampleCount: samples.length, samples,
  }
  const output = new URL('../../backend/.local/', import.meta.url)
  await mkdir(output, { recursive: true })
  const filename = process.env.HEPATOPLAN_APP_DEFAULT_GL === '1'
    ? 'production-app-timing-default-gl.json' : 'production-app-timing.json'
  await writeFile(new URL(filename, output), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
})
