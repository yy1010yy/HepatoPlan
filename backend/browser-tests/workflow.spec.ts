import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BoxGeometry } from 'three'

const base = '/synthetic/cases'
const caseRoot = base + '/releases/test-1/'
const index = { schemaVersion: 1, releaseId: 'test-1', cases: [{ caseId: 'case-a' }, { caseId: 'case-b' }] }
const mask = Buffer.alloc(64, 1)
mask[(3 * 4 + 1) * 4 + 1] = 2

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
async function provideCases(page: Page, fault: () => Fault | undefined = () => undefined) {
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
          dimensions: [4, 4, 4], voxelSpacingMm: [1, 1, 1],
          voxelToWorldMm: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
          labelCounts: { parenchyma: 63, tumour: 1 },
        } })
        return
      case 'labels.bin': {
        const body = failure === 'short-mask' ? mask.subarray(1) : Buffer.from(mask)
        if (failure === 'bad-label') body[0] = 3
        await route.fulfill({ body })
        return
      }
      case 'liver.stl':
        if (failure === 'missing-mesh') await route.fulfill({ status: 404 })
        else await route.fulfill({ body: failure === 'short-stl' ? liverStl.subarray(0, 100) : liverStl })
        return
      case 'tumour.stl':
        await route.fulfill({ body: tumourStl })
        return
      default:
        await route.fulfill({ status: 404 })
    }
  })
}

async function colourPositions(page: Page) {
  const png = await page.locator('#viewer canvas').screenshot()
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    image.close()
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let orange = 0
    let teal = 0
    let orangeX = 0
    let tealX = 0
    for (let pixel = 0; pixel < pixels.length; pixel += 4) {
      const [r, g, b] = [pixels[pixel], pixels[pixel + 1], pixels[pixel + 2]]
      const x = (pixel / 4) % canvas.width
      if (r > g + 16 && g > b + 10) { orange++; orangeX += x }
      if (g > r + 16 && b > r + 12) { teal++; tealX += x }
    }
    return { orange, teal, horizontalDifference: orangeX / orange - tealX / teal }
  }, png.toString('base64'))
}

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
  const beforeFlip = await colourPositions(page)
  expect(beforeFlip.orange).toBeGreaterThan(500)
  expect(beforeFlip.teal).toBeGreaterThan(500)
  await page.getByRole('button', { name: 'Flip removal side' }).click()
  await expect(status).toHaveText('ready')
  await expect(results).toContainText('Removed volume: 0.032 mL')
  const afterFlip = await colourPositions(page)
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
