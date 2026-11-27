import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { prepareAnalysis } from '../../backend/plan-analysis.mts'
import { isComparisonAnalysisRequest, isSingleAnalysisRequest } from '../src/planning/analysis-contract.ts'
import type { AnalysisAction, ComparisonAnalysisRequest, SingleAnalysisRequest } from '../src/planning/analysis-contract.ts'
import metadata from '../../public/cases/releases/research-2/case-003/metadata.json' with { type: 'json' }

function selectAnalysis(body: SingleAnalysisRequest | ComparisonAnalysisRequest, prefer?: AnalysisAction) {
  const prepared = prepareAnalysis('revision' in body ? 'single' : 'comparison', body, (release, id) =>
    release === metadata.releaseId && id === metadata.caseId ? metadata.labelCounts.tumour : undefined)
  expect(prepared).toBeDefined()
  const evidence = prepared!.providerInput
  const action = evidence.actions.find(action => action.id === prefer)
    ?? (prefer?.startsWith('open_plan_') ? evidence.actions.find(action => action.id.startsWith('open_plan_')) : undefined)
    ?? evidence.actions[0]
  const selection = prepared!.resolve({
    findingId: evidence.findings[0].id, observationIds: evidence.requiredObservationIds,
    actionId: action.id, rationaleFactIds: action.rationaleFactIds,
  })
  expect(selection).toBeDefined()
  return selection
}

async function saveCut(page: Page, name: string, alternative = false) {
  const label = alternative ? 'Save alternative' : 'Save plan'
  await page.getByRole('button', { name: label, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: label })
  await dialog.getByLabel('Plan name').fill(name)
  await dialog.getByRole('button', { name: label }).click()
  await expect(dialog).toBeHidden()
}

async function openPreparedCut(page: Page) {
  await page.goto('./')
  await page.locator('#explore').click()
  await page.getByRole('button', { name: 'Choose case', exact: true }).click()
  await page.getByRole('dialog', { name: 'Choose a prepared case' }).getByRole('button', { name: metadata.caseId }).click()
  await expect(page.locator('#active-case')).toHaveText(metadata.caseId)
  await expect(page.getByRole('button', { name: 'Analyse this plan' })).toBeEnabled({ timeout: 15_000 })
  await page.getByRole('slider', { name: 'Plane angle' }).fill('8')
  await expect(page.getByRole('button', { name: 'Analyse this plan' })).toBeEnabled()
}

test('an unsaved cut retains its measured alternative after a failed AI call and retries with fresh evidence identity', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const requests: SingleAnalysisRequest[] = []
  await page.route('**/api/plans/explain', async route => {
    const body: unknown = route.request().postDataJSON()
    expect(isSingleAnalysisRequest(body)).toBe(true)
    if (!isSingleAnalysisRequest(body)) return route.abort()
    requests.push(body)
    expect(body.search.outcome).toBe('improvement')
    expect(new URL(route.request().url()).pathname).toBe('/api/plans/explain')
    if (requests.length === 1) return route.fulfill({ status: 502, json: { error: 'provider_unavailable' } })
    await route.fulfill({ json: selectAnalysis(body) })
  })
  await openPreparedCut(page)
  const reason = page.getByRole('group', { name: 'Plan context' }).getByLabel('Reason (optional)')
  await reason.selectOption({ label: 'Compare remnant volume' })
  const panel = page.getByRole('region', { name: 'Plan analysis' })
  const controls = page.getByRole('region', { name: 'Resection plane' })
  const trigger = controls.getByRole('button', { name: 'Analyse this plan' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(panel.getByRole('status')).toHaveText('AI analysis unavailable.')
  await expect(panel.getByRole('heading', { name: 'AI recommendation' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save alternative', exact: true })).toHaveCount(0)
  const measurements = panel.getByRole('table', { name: 'Measured alternative' })
  await expect(measurements.getByRole('columnheader', { name: 'Current cut' })).toBeVisible()
  await expect(measurements.getByRole('row', { name: /Estimated tumour-to-plane gap/ })).toBeVisible()
  const retry = controls.getByRole('button', { name: 'Retry analysis' })
  await expect(retry).toBeFocused()
  const model = page.getByRole('group', { name: '3D liver model' })
  const canvas = model.locator('canvas')
  const originalElement = await canvas.elementHandle()
  await model.focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('+')
  const rotated = await canvas.screenshot()
  const initialVolume = await page.locator('#remaining').textContent()
  await panel.getByRole('button', { name: 'Preview measured alternative' }).focus()
  await page.keyboard.press('Enter')
  const preview = page.getByRole('group', { name: 'Cut in the viewer' })
  await expect(preview.getByRole('button', { name: 'Tested alternative' })).toBeFocused()
  await expect(page.getByRole('slider', { name: 'Plane offset' })).toBeDisabled()
  await expect(page.getByRole('slider', { name: 'Liver opacity' })).toBeEnabled()
  await expect(page.locator('#remaining')).not.toHaveText(initialVolume ?? '')
  await expect.poll(async () => (await canvas.screenshot()).equals(rotated)).toBe(false)
  await preview.getByRole('button', { name: 'Current cut' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#remaining')).toHaveText(initialVolume ?? '')
  expect(await originalElement?.evaluate(element => element.isConnected)).toBe(true)
  await page.getByRole('button', { name: 'Keep current cut' }).click()
  await retry.focus()
  await page.keyboard.press('Enter')
  await expect(panel.getByRole('heading', { name: 'AI recommendation' })).toBeVisible()
  expect(requests).toHaveLength(2)
  expect(requests[1].requestId).not.toBe(requests[0].requestId)
  expect(requests[1].search).toEqual(requests[0].search)
  expect(requests[1].current.context?.reason).toBe('Compare remnant volume')
  await page.getByRole('slider', { name: 'Liver opacity' }).fill('70')
  await expect(panel.getByRole('heading', { name: 'AI recommendation' })).toBeVisible()
  expect(requests).toHaveLength(2)
  await expect(page.getByRole('button', { name: /Saved plans · 0/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'View supporting measurements' })).toHaveCount(0)
  const saveAlternative = page.getByRole('button', { name: 'Save alternative', exact: true })
  await expect(saveAlternative).toHaveCount(0)
  const previewAlternative = panel.getByRole('button', { name: 'Preview alternative', exact: true })
  expect(await previewAlternative.evaluate(button => {
    const result = button.closest('.plan-analysis-result')!
    const tested = result.querySelector('table')!
    const save = document.getElementById('save-plan')!
    return Boolean(tested.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING)
      && result.nextElementSibling === save
  })).toBe(true)
  await previewAlternative.click()
  await expect(panel.getByRole('button', { name: 'Save alternative', exact: true })).toHaveCount(0)
  await expect(saveAlternative).toBeVisible()
  await preview.getByRole('button', { name: 'Current cut' }).click()
  await expect(saveAlternative).toHaveCount(0)
  await preview.getByRole('button', { name: 'Tested alternative' }).click()
  await saveAlternative.click()
  const dialog = page.getByRole('dialog', { name: 'Save alternative' })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(saveAlternative).toBeFocused()
  await saveCut(page, 'Tested cut', true)
  await expect(preview).toHaveCount(0)
  await expect(page.locator('#remaining')).toHaveText(initialVolume ?? '')
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
  await expect(reason).toHaveValue('Compare remnant volume')
  await expect(page.getByRole('button', { name: /Saved plans · 1/ })).toBeVisible()
  await saveCut(page, 'Original cut')
  await page.getByRole('button', { name: 'Compare these plans' }).click()
  const table = page.getByRole('table', { name: 'Saved measurements' })
  await expect(table.getByRole('columnheader', { name: 'A Tested cut' })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'B Original cut' })).toBeVisible()
  const values = table.getByRole('row', { name: /^Remaining volume/ }).getByRole('cell')
  await expect(values.nth(1)).toHaveText(initialVolume ?? '')
  await expect(values.nth(0)).not.toHaveText(initialVolume ?? '')
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390)
})

test('a search error reaches no API and editing context clears a pending response', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1163, height: 678 })
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage
    let fail = true
    Worker.prototype.postMessage = function (message: unknown, ...rest: unknown[]) {
      if (fail && typeof message === 'object' && message && 'type' in message && message.type === 'searchOffsets') {
        fail = false
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
          data: { ...message, type: 'searchError', message: 'Controlled search error' },
        })))
      } else Reflect.apply(post, this, [message, ...rest])
    }
  })
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  let posted = 0
  await page.route('**/api/plans/explain', async route => {
    posted++
    const input: unknown = route.request().postDataJSON()
    if (!isSingleAnalysisRequest(input)) return route.abort()
    await hold
    await route.fulfill({ json: selectAnalysis(input) }).catch(() => {})
  })
  try {
    await openPreparedCut(page)
    const panel = page.getByRole('region', { name: 'Plan analysis' })
    const controls = page.getByRole('region', { name: 'Resection plane' })
    await controls.getByRole('button', { name: 'Analyse this plan' }).click()
    await expect(panel.getByRole('status')).toHaveText('Offset search unavailable.')
    expect(posted).toBe(0)
    await controls.getByRole('button', { name: 'Retry search' }).click()
    await expect(panel.getByRole('status')).toHaveText('Analysing…')
    await expect.poll(() => posted).toBe(1)
    const reason = page.getByRole('group', { name: 'Plan context' }).getByLabel('Reason (optional)')
    await reason.selectOption({ label: 'Compare remnant volume' })
    await reason.selectOption('')
    release()
    await expect(panel.getByRole('heading', { name: 'AI recommendation' })).toHaveCount(0)
    await expect(controls.getByRole('button', { name: 'Analyse this plan' })).toBeEnabled()
    await controls.getByRole('button', { name: 'Analyse this plan' }).click()
    await expect(panel.getByRole('heading', { name: 'AI recommendation' })).toBeVisible()
    expect(await page.locator('#plan-view').evaluate(node => {
      const left = node.querySelector('.controls')!
      const right = node.querySelector('.plan-readings')!
      const action = left.querySelector('.plan-analysis-trigger')!
      const context = left.querySelector('.plan-context')!
      const statistics = right.querySelector('.measurement-details')!
      const analysis = right.querySelector('.plan-analysis-result')!
      const save = right.querySelector('#save-plan')!
      const before = (first: Element, second: Element) => !!(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
      return before(context, action) && before(right.querySelector('.readings-primary')!, statistics)
        && before(statistics, analysis) && before(analysis, save)
        && [left, right].every(rail => getComputedStyle(rail).overflowY === 'auto' && rail.scrollHeight > rail.clientHeight)
    })).toBe(true)
  } finally {
    release()
  }
})

test('Compare scopes analysis to the ordered pair and follows an inspection through the unsaved-cut guard', async ({ page }) => {
  test.setTimeout(100_000)
  await page.setViewportSize({ width: 1163, height: 678 })
  const requests: ComparisonAnalysisRequest[] = []
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/plan-comparisons/explain', async route => {
    const input: unknown = route.request().postDataJSON()
    if (!isComparisonAnalysisRequest(input)) return route.abort()
    requests.push(input)
    const index = requests.length
    expect(input.spatialStatus).toBe('ready')
    if (index === 1) {
      await hold
      return route.fulfill({ json: selectAnalysis(input) }).catch(() => {})
    }
    if (index === 2) return route.fulfill({ status: 502, json: { error: 'provider_unavailable' } })
    await route.fulfill({ json: selectAnalysis(input, 'open_plan_b') })
  })
  try {
    await openPreparedCut(page)
    await saveCut(page, 'Offset A')
    await page.getByRole('slider', { name: 'Plane offset' }).fill('15')
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled()
    await saveCut(page, 'Offset B')
    await page.getByRole('slider', { name: 'Plane angle' }).fill('17')
    await page.getByRole('link', { name: 'Compare', exact: true }).click()
    const panel = page.getByRole('region', { name: 'Comparison analysis' })
    const readings = page.getByRole('region', { name: 'Saved measurements' })
    const controls = page.getByRole('region', { name: 'Selected plans' })
    const differences = controls.getByRole('checkbox', { name: 'Show differences' })
    await differences.check()
    const analyse = controls.getByRole('button', { name: 'Analyse comparison' })
    await analyse.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => requests.length).toBe(1)
    await expect(page.getByRole('region', { name: 'Spatial differences' })).toBeVisible()
    await page.getByRole('button', { name: 'Swap A/B' }).click()
    release()
    await expect(panel.getByRole('heading', { name: 'AI recommendation' })).toHaveCount(0)
    await analyse.focus()
    await page.keyboard.press('Enter')
    await expect(panel.getByRole('status')).toHaveText('AI analysis unavailable.')
    const retry = controls.getByRole('button', { name: 'Retry analysis' })
    await expect(retry).toBeFocused()
    const pageScroll = await page.evaluate(() => window.scrollY)
    await page.keyboard.press('Enter')
    await expect(panel.getByRole('heading', { name: 'AI recommendation' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'AI recommendation' })).toBeInViewport()
    expect(await readings.evaluate(rail => rail.scrollTop)).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll)
    await readings.focus()
    await expect(readings).toBeFocused()
    await readings.hover()
    await page.mouse.wheel(0, -1000)
    await expect.poll(() => readings.evaluate(rail => rail.scrollTop)).toBe(0)
    await page.mouse.wheel(0, 1000)
    await expect.poll(() => readings.evaluate(rail => rail.scrollTop)).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll)
    expect(requests[1].planAId).toBe(requests[0].planBId)
    expect(requests[2].requestId).not.toBe(requests[1].requestId)
    expect(requests[2].planBId).toBe(requests[0].planAId)
    await expect(panel.getByRole('button', { name: 'Show differences', exact: true })).toHaveCount(0)
    await differences.uncheck()
    await expect(panel.getByRole('heading', { name: 'AI recommendation' })).toBeVisible()
    await expect(panel.getByText(/exclusive regions account for the net difference/)).toBeVisible()
    expect(await panel.evaluate(result => {
      const savedMeasurements = document.querySelector('.compare-results table')
      return result.closest('.compare-results') != null
        && !!(savedMeasurements!.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING)
    })).toBe(true)
    expect(requests).toHaveLength(3)
    await expect(panel.getByRole('heading', { name: 'AI recommendation' })).toBeVisible()
    await page.getByRole('button', { name: 'Back to planning' }).click()
    await expect(page.getByRole('slider', { name: 'Plane angle' })).toHaveValue('17')
    await page.getByRole('link', { name: 'Compare', exact: true }).click()
    await expect(panel.getByRole('heading', { name: 'AI recommendation' })).toHaveCount(0)
    await analyse.click()
    const open = panel.getByRole('button', { name: /Open Plan [AB]/ })
    await open.focus()
    await page.keyboard.press('Enter')
    const guard = page.getByRole('dialog', { name: 'Unsaved changes' })
    await expect(guard).toBeVisible()
    await guard.getByRole('button', { name: 'Stay', exact: true }).click()
    await expect(open).toBeFocused()
  } finally {
    release()
  }
})

test('Compare can analyse saved measurements during a spatial failure and include the regions after retry', async ({ page }) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage
    let fail = true
    Worker.prototype.postMessage = function (message: unknown, ...rest: unknown[]) {
      if (fail && typeof message === 'object' && message && 'type' in message && message.type === 'comparePlans') {
        fail = false
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
          data: { ...message, type: 'comparePlansError', message: 'Controlled spatial error' },
        })))
      } else Reflect.apply(post, this, [message, ...rest])
    }
  })
  const requests: ComparisonAnalysisRequest[] = []
  await page.route('**/api/plan-comparisons/explain', async route => {
    const input: unknown = route.request().postDataJSON()
    if (!isComparisonAnalysisRequest(input)) return route.abort()
    requests.push(input)
    await route.fulfill({ json: selectAnalysis(input, 'view_measurements') })
  })
  await openPreparedCut(page)
  await saveCut(page, 'Same cut A')
  await saveCut(page, 'Same cut B')
  await page.getByRole('link', { name: 'Compare', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Comparison analysis' })
  const controls = page.getByRole('region', { name: 'Selected plans' })
  await controls.getByRole('button', { name: 'Analyse comparison' }).click()
  await expect(panel.getByText('Both plans retain the same measured volume.')).toBeVisible()
  await expect(panel.getByText('Spatial measurements are unavailable for this pair.')).toBeVisible()
  expect(requests[0].spatialStatus).toBe('unavailable')
  await controls.getByRole('button', { name: 'Analyse with region volumes' }).click()
  await expect(panel.getByText('Both plans retain the same measured volume.')).toBeVisible()
  await expect(panel.getByText('Spatial measurements are unavailable for this pair.')).toHaveCount(0)
  expect(requests[1].spatialStatus).toBe('ready')
  if (requests[1].spatialStatus === 'ready') {
    expect(requests[1].differenceVolumes.removedOnlyByAMl).toBe(0)
    expect(requests[1].differenceVolumes.removedOnlyByBMl).toBe(0)
  }
})
