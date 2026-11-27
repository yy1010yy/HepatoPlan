import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BoxGeometry } from 'three'
import type { SavedPlan } from '../src/planning/plan-session.ts'
import { colourPositions, comparisonVolumes } from './comparison-observations.ts'

const base = '/synthetic/cases'
const caseRoot = base + '/releases/test-1/'
const index = { schemaVersion: 1, releaseId: 'test-1', cases: [{ caseId: 'case-a' }, { caseId: 'case-b' }] }
const mask = Buffer.alloc(64, 1)
mask[(3 * 4 + 1) * 4 + 1] = 2
const comparisonMask = Buffer.alloc(80)
comparisonMask.fill(1, 0, 64)
comparisonMask[64] = 2

function stl(size: number, centre: [number, number, number]): Buffer {
  const box = new BoxGeometry(size, size, size)
  box.translate(...centre)
  const triangles = box.toNonIndexed()
  const positions = triangles.getAttribute('position')
  const faces = positions.count / 3
  const bytes = Buffer.alloc(84 + faces * 50)
  bytes.writeUInt32LE(faces, 80)
  for (let face = 0; face < faces; face++) {
    for (let vertex = 0; vertex < 3; vertex++) {
      const index = face * 3 + vertex
      const offset = 96 + face * 50 + vertex * 12
      bytes.writeFloatLE(positions.getX(index), offset)
      bytes.writeFloatLE(positions.getY(index), offset + 4)
      bytes.writeFloatLE(positions.getZ(index), offset + 8)
    }
  }
  triangles.dispose()
  box.dispose()
  return bytes
}

const liverStl = stl(4, [1.5, 1.5, 1.5])
const tumourStl = stl(1, [3, 1, 1])

type Fault = 'bad-index' | 'wrong-case' | 'missing-mesh' | 'short-mask' | 'short-stl' | 'bad-label'
async function provideCases(page: Page, fault: () => Fault | undefined = () => undefined, comparisonCube = false) {
  const labels = comparisonCube ? comparisonMask : mask
  await page.route('**/synthetic/cases/**', async route => {
    const path = new URL(route.request().url()).pathname
    const failure = fault()
    if (path === base + '/index.json') {
      await route.fulfill({ json: failure === 'bad-index' ? { ...index, schemaVersion: 2 } : index })
      return
    }
    const [caseId, filename] = path.slice(caseRoot.length).split('/')
    switch (filename) {
      case 'metadata.json':
        await route.fulfill({ json: {
          schemaVersion: 1, releaseId: 'test-1', caseId: failure === 'wrong-case' ? 'case-other' : caseId,
          dimensions: [comparisonCube ? 5 : 4, 4, 4], voxelSpacingMm: [1, 1, 1],
          voxelToWorldMm: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
          labelCounts: { parenchyma: comparisonCube ? 64 : 63, tumour: 1 },
        } })
        return
      case 'labels.bin': {
        const body = failure === 'short-mask' ? labels.subarray(1) : Buffer.from(labels)
        if (failure === 'bad-label') body[0] = 3
        await route.fulfill({ body })
        return
      }
      case 'liver.stl':
        if (failure === 'missing-mesh') await route.fulfill({ status: 404 })
        else await route.fulfill({ body: failure === 'short-stl' ? liverStl.subarray(0, 100) : liverStl })
        return
      case 'tumour.stl':
        await route.fulfill({ body: comparisonCube ? stl(1, [4, 0, 0]) : tumourStl })
        return
      default:
        await route.fulfill({ status: 404 })
    }
  })
}

async function viewerColours(page: Page, mode: 'single' | 'comparison' = 'single') {
  const png = await page.locator('#viewer canvas').screenshot()
  return colourPositions(page, png, mode)
}

test('comparison surface follows ordered saved planes while view controls reuse the result', async ({ page }) => {
  const shaderErrors: string[] = []
  page.on('console', message => { if (message.type() === 'error') shaderErrors.push(message.text()) })
  await provideCases(page, undefined, true)
  await page.goto('/browser-tests/fixture.html')
  await page.getByRole('combobox', { name: 'Case', exact: true }).selectOption('case-a')
  const status = page.locator('#status')
  const toggle = page.getByLabel('Show Differences')
  const legend = page.getByRole('region', { name: 'Geometric comparison' })
  const planA = page.getByRole('combobox', { name: 'Plan A' })
  const planB = page.getByRole('combobox', { name: 'Plan B' })
  const comparisonDispatches = page.locator('#comparison-dispatches')
  const flip = page.getByRole('button', { name: 'Flip removal side' })
  async function save(name: string): Promise<SavedPlan> {
    await expect(status).toHaveText('ready')
    await page.getByLabel('Plan name').fill(name)
    await page.getByRole('button', { name: 'Save plan' }).click()
    return JSON.parse((await page.locator('#saved-plan').textContent())!)
  }

  await expect(toggle).toBeDisabled()
  const positive = await save('Positive')
  await flip.click()
  const negative = await save('Negative')
  await flip.click()
  const copy = await save('Positive copy')
  expect(positive.plane.pointMm[0]).toBe(1.5)
  expect(negative.plane.pointMm).toEqual(positive.plane.pointMm)
  expect(negative.plane.unitNormal).toEqual(positive.plane.unitNormal)
  expect(positive.result.flrPercent).toBe(50)
  expect(negative.result.flrPercent).toBe(50)
  await expect(toggle).toBeEnabled()
  await expect(toggle).not.toBeChecked()
  await expect(legend).toBeHidden()
  await page.getByRole('button', { name: 'Compare plans' }).click()
  await page.getByLabel('Show Plane').uncheck()
  await page.getByLabel('Liver Opacity').fill('1')
  await toggle.check()
  const onlyA = legend.getByRole('listitem').filter({ hasText: 'Removed only by A 0.032 mL' })
  const onlyB = legend.getByRole('listitem').filter({ hasText: 'Removed only by B 0.032 mL' })
  await expect(onlyA.locator('[aria-hidden=true]')).toHaveCSS('background-color', 'rgb(0, 114, 178)')
  await expect(onlyB.locator('[aria-hidden=true]')).toHaveCSS('background-color', 'rgb(213, 94, 0)')
  await expect(legend.getByText('Removed by both 0 mL')).toBeVisible()
  await expect(legend.getByText('Retained by both 0 mL')).toBeVisible()
  const volumes = await comparisonVolumes(page, [positive.id, negative.id])
  expect(Math.abs(volumes.removedOnlyByAMl - 0.032)).toBeLessThanOrEqual(1e-12)
  expect(Math.abs(volumes.removedOnlyByBMl - 0.032)).toBeLessThanOrEqual(1e-12)
  expect(volumes.removedByBothMl).toBe(0)
  expect(volumes.retainedByBothMl).toBe(0)
  const initial = await viewerColours(page, 'comparison')
  expect(initial.orange).toBeGreaterThan(100)
  expect(initial.teal).toBeGreaterThan(100)
  expect(initial.horizontalDifference).toBeLessThan(-10)

  const beforeViewChanges = await comparisonDispatches.textContent()
  await toggle.uncheck()
  await expect(legend).toBeHidden()
  await expect(page.locator('#comparison')).toContainText('Future Liver Remnant (FLR): 50% | 50%')
  await toggle.check()
  await page.getByLabel('Liver Opacity').fill('0.85')
  await page.getByLabel('Liver Opacity').fill('1')
  const canvas = page.locator('#viewer canvas')
  const bounds = (await canvas.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 30, bounds.y + bounds.height / 2 + 10, { steps: 5 })
  await page.mouse.up()
  const rotated = await viewerColours(page, 'comparison')
  expect(rotated.orange).toBeGreaterThan(100)
  expect(rotated.teal).toBeGreaterThan(100)
  expect(await comparisonDispatches.textContent()).toBe(beforeViewChanges)

  await planA.selectOption({ label: 'Negative' })
  await expect(legend).toBeHidden()
  await planB.selectOption({ label: 'Positive' })
  await expect(legend.getByText('Removed only by A 0.032 mL')).toBeVisible()
  expect(await comparisonVolumes(page, [negative.id, positive.id])).toEqual(volumes)
  const swapped = await viewerColours(page, 'comparison')
  expect(swapped.horizontalDifference * rotated.horizontalDifference).toBeLessThan(-100)
  await planA.selectOption({ label: 'Positive copy' })
  await expect(legend.getByText('Removed by both 0.032 mL')).toBeVisible()
  await expect(legend.getByText('Retained by both 0.032 mL')).toBeVisible()
  expect(await comparisonVolumes(page, [copy.id, positive.id])).toEqual({
    removedOnlyByAMl: 0, removedOnlyByBMl: 0, removedByBothMl: 0.032, retainedByBothMl: 0.032,
  })
  const identical = await viewerColours(page, 'comparison')
  expect(identical.orange).toBeLessThan(10)
  expect(identical.teal).toBeLessThan(10)
  expect(shaderErrors).toEqual([])
})

test('viewer controls, quantitative results and saved plans agree in the browser', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await provideCases(page)
  await page.goto('/browser-tests/fixture.html')
  const picker = page.getByRole('combobox', { name: 'Case', exact: true })
  const status = page.locator('#status')
  const results = page.locator('#results')
  const revision = page.locator('#revision')
  const dispatches = page.locator('#dispatches')
  const save = page.getByRole('button', { name: 'Save plan' })
  await expect(status).toHaveText('Select a case')
  await expect(save).toBeDisabled()
  await picker.selectOption('case-a')
  await expect(status).toHaveText('ready')
  await expect(page.getByText('Experimental geometry and volumes for research and education.')).toBeVisible()
  await expect(results).toContainText('Removed volume: 0.031 mL')
  await expect(results).toContainText('Remaining volume: 0.032 mL')
  await expect(page.locator('#viewer canvas')).toBeVisible()

  const baseline = await dispatches.textContent()
  await page.getByLabel('Show Plane').uncheck()
  await page.getByLabel('Liver Opacity').press('End')
  await expect(dispatches).toHaveText(baseline!)
  const beforeFlip = await viewerColours(page)
  expect(beforeFlip.orange).toBeGreaterThan(500)
  expect(beforeFlip.teal).toBeGreaterThan(500)
  await page.getByRole('button', { name: 'Flip removal side' }).click()
  await expect(status).toHaveText('ready')
  await expect(results).toContainText('Removed volume: 0.032 mL')
  const afterFlip = await viewerColours(page)
  expect(afterFlip.orange).toBeGreaterThan(500)
  expect(afterFlip.teal).toBeGreaterThan(500)
  expect(beforeFlip.horizontalDifference * afterFlip.horizontalDifference).toBeLessThan(-100)

  for (const [name, offset, angle] of [
    ['Negative offset', '−1 mm', '−10°'], ['Centre tilt', '0 mm', '+8°'], ['Positive offset', '+1 mm', '+14°'],
  ]) {
    const previousRevision = Number(await revision.textContent())
    const previousDispatches = Number(await dispatches.textContent())
    await page.getByRole('button', { name }).click()
    await expect(page.locator('#offset-value')).toHaveText(offset)
    await expect(page.locator('#angle-value')).toHaveText(angle)
    await expect(status).toHaveText('ready')
    await expect(revision).toHaveText(String(previousRevision + 1))
    await expect(dispatches).toHaveText(String(previousDispatches + 1))
  }

  await page.getByRole('button', { name: 'Reset plane' }).click()
  await expect(status).toHaveText('ready')
  await expect(results).toContainText('Removed volume: 0.031 mL')
  await page.getByLabel('Plan name').fill('Midpoint')
  expect(await page.locator('#offset').evaluate(slider => {
    const input = slider as HTMLInputElement
    input.value = '1'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return (document.getElementById('save') as HTMLButtonElement).disabled
  })).toBe(true)
  await expect(status).toHaveText('ready')
  await page.getByLabel('Plane Offset').press('ArrowLeft')
  await expect(status).toHaveText('ready')
  await expect(page.locator('#offset-value')).toHaveText('0 mm')
  await save.click()
  const first = JSON.parse((await page.locator('#saved-plan').textContent())!)
  expect(first.result.flrPercent).toBeCloseTo(32 / 63 * 100, 12)
  expect(first.result.flrPercent).not.toBe(50.79)

  await page.getByLabel('Plane Offset').press('ArrowRight')
  await page.getByLabel('Plane Angle').press('ArrowUp')
  await expect(status).toHaveText('ready')
  await expect(page.locator('#offset-value')).toHaveText('+1 mm')
  await expect(page.locator('#angle-value')).toHaveText('+1°')
  await page.getByLabel('Plan name').fill('Oblique')
  await save.click()
  const second = JSON.parse((await page.locator('#saved-plan').textContent())!)
  expect(second.id).not.toBe(first.id)
  await page.getByRole('combobox', { name: 'Plan A' }).selectOption(first.id)
  await page.getByRole('combobox', { name: 'Plan B' }).selectOption(second.id)
  await page.getByRole('button', { name: 'Compare plans' }).click()
  await expect(page.locator('#comparison')).toContainText('Removed volume: 0.031 mL |')
  await page.getByRole('button', { name: 'Open Plan A' }).click()
  await expect(status).toHaveText('ready')
  await expect(page.locator('#offset-value')).toHaveText('0 mm')
  await expect(page.locator('#angle-value')).toHaveText('0°')
  await picker.selectOption('case-b')
  await expect(status).toHaveText('ready')
  await expect(page.locator('#plan-a option')).toHaveCount(0)
  await expect(page.locator('#comparison')).toBeEmpty()
  await picker.selectOption('case-a')
  await expect(status).toHaveText('ready')
  await expect(page.locator('#plan-a option')).toHaveCount(2)
  expect(pageErrors).toEqual([])
})

test('invalid static assets and worker initialization errors can be retried', async ({ page }) => {
  let fault: Fault | undefined = 'bad-index'
  await provideCases(page, () => fault)
  await page.goto('/browser-tests/fixture.html')
  const status = page.locator('#status')
  await expect(status).toContainText('Cannot load case index')
  fault = 'wrong-case'
  await page.getByRole('button', { name: 'Retry index' }).click()
  await expect(status).toHaveText('Select a case')
  await page.getByRole('combobox', { name: 'Case', exact: true }).selectOption('case-a')
  await expect(status).toContainText('Metadata case or release ID differs')

  const retry = page.getByRole('button', { name: 'Retry case or calculation' })
  for (const [mode, message] of [
    ['missing-mesh', 'HTTP 404'], ['short-mask', 'expected 64'],
    ['short-stl', 'Binary STL length'], ['bad-label', 'Invalid mask label 3'],
  ] as const) {
    fault = mode
    await retry.click()
    await expect(status).toContainText(message)
    await expect(page.getByRole('button', { name: 'Save plan' })).toBeDisabled()
  }

  fault = undefined
  await retry.click()
  await expect(status).toHaveText('ready')
  await page.getByLabel('Plane Offset').press('ArrowRight')
  await expect(status).toHaveText('ready')
  const previous = Number(await page.locator('#dispatches').textContent())
  await page.getByRole('button', { name: 'Simulate worker crash' }).click()
  await expect(page.locator('#dispatches')).toHaveText(String(previous + 1))
  await expect(status).toHaveText('ready')
  await expect(page.locator('#offset-value')).toHaveText('+1 mm')
})
