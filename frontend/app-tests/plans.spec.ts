import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { colourPositions } from '../browser-tests/comparison-observations.ts'

function saveButton(page: Page) {
  return page.getByRole('button', { name: 'Save plan', exact: true })
}

function angle(page: Page) {
  return page.getByRole('slider', { name: 'Plane angle' })
}

function savedButton(page: Page) {
  return page.getByRole('button', { name: /^Saved plans/ })
}

function compareLink(page: Page) {
  return page.getByRole('link', { name: 'Compare', exact: true })
}

async function start(page: Page) {
  await page.goto('./')
  await page.locator('#explore').click()
  await expect(saveButton(page)).toBeEnabled()
}

async function save(page: Page, name: string, details?: string) {
  await saveButton(page).click()
  const dialog = page.getByRole('dialog', { name: 'Save plan' })
  await dialog.getByLabel('Plan name').fill(name)
  if (details) {
    await dialog.getByLabel('Procedure type (optional)').fill('Geometry study')
    await dialog.getByLabel('Reason (optional)').fill('Compare remnant volume')
    await dialog.getByLabel('Notes (optional)').fill(details)
  }
  await dialog.getByRole('button', { name: 'Save plan', exact: true }).click()
  await expect(dialog).toBeHidden()
}

async function pickCase(page: Page, id: string) {
  await page.getByRole('button', { name: 'Choose case', exact: true }).click()
  await page.getByRole('dialog', { name: 'Choose a prepared case' }).getByRole('button', { name: id }).click()
}

test('saves, compares and opens named cuts without replacing an unsaved working plane', async ({ page }) => {
  await start(page)
  await expect(compareLink(page)).toBeDisabled()
  await savedButton(page).click()
  await expect(page.getByRole('dialog', { name: 'Saved plans' })).toContainText('Save a cut to revisit it here.')
  await page.keyboard.press('Escape')
  const viewer = await page.locator('.plan-viewport canvas').elementHandle()
  await save(page, 'Study', 'Centre cut notes')
  await expect(savedButton(page)).toContainText('1')
  expect(await viewer!.evaluate(canvas => canvas.isConnected)).toBe(true)
  await expect(page.locator('#compare-status')).toHaveText('Save one more plan to compare.')
  await angle(page).fill('24')
  await save(page, 'Study', 'Tilted cut notes')
  await expect(savedButton(page)).toContainText('2')
  await angle(page).fill('-17')
  await page.getByRole('button', { name: 'Compare these plans' }).click()
  const table = page.getByRole('table', { name: 'Saved measurements' })
  await expect(table.getByRole('columnheader', { name: 'A Study (save 1)' })).toBeVisible()
  const row = table.getByRole('row', { name: /^Remaining volume/ })
  const values = await row.getByRole('cell').allTextContents()
  expect(values[0]).not.toBe(values[1])
  await page.getByRole('button', { name: 'Swap A/B' }).click()
  await expect(table.getByRole('columnheader', { name: 'A Study (save 2)' })).toBeVisible()
  await expect(row.getByRole('cell')).toHaveText([values[1], values[0]])
  await page.getByRole('button', { name: 'Back to planning' }).click()
  await expect(angle(page)).toHaveValue('-17')
  await compareLink(page).click()
  await expect(table.getByRole('columnheader', { name: 'A Study (save 2)' })).toBeVisible()
  await page.getByRole('button', { name: 'Open Plan B' }).click()
  const guard = page.getByRole('dialog', { name: 'Unsaved changes' })
  await guard.getByRole('button', { name: 'Stay', exact: true }).click()
  await expect(table).toBeVisible()
  await page.getByRole('button', { name: 'Open Plan B' }).click()
  await guard.getByRole('button', { name: 'Discard and open plan' }).click()
  await expect(angle(page)).toHaveValue('0')
  await expect(page.getByText('Centre cut notes', { exact: true })).toBeVisible()
  await expect(saveButton(page)).toBeEnabled()
  await expect(page.locator('#remaining')).toHaveText(values[0])
  await savedButton(page).click()
  await page.getByRole('button', { name: 'Open Study (save 2)' }).click()
  await expect(angle(page)).toHaveValue('24')
  await expect(page.getByText('Tilted cut notes', { exact: true })).toBeVisible()
  await expect(saveButton(page)).toBeEnabled()
  await page.reload()
  await expect(saveButton(page)).toBeEnabled()
  await expect(savedButton(page)).toContainText('0')
})

test('guards a case switch, upload entry and browser Back while keeping snapshots scoped', async ({ page }) => {
  test.setTimeout(60_000)
  await start(page)
  await angle(page).fill('12')
  await expect(saveButton(page)).toBeEnabled()
  await pickCase(page, 'case-001')
  const guard = page.getByRole('dialog', { name: 'Unsaved changes' })
  await guard.getByRole('button', { name: 'Save and switch cases' }).click()
  const saveDialog = page.getByRole('dialog', { name: 'Save plan' })
  await saveDialog.getByRole('button', { name: 'Cancel' }).click()
  await guard.getByRole('button', { name: 'Stay', exact: true }).click()
  await expect(angle(page)).toHaveValue('12')
  await expect(page.getByRole('dialog', { name: 'Choose a prepared case' })).toBeVisible()
  await page.getByRole('button', { name: 'case-001' }).click()
  await guard.getByRole('button', { name: 'Save and switch cases' }).click()
  await saveDialog.getByLabel('Plan name').fill('Before switch')
  await saveDialog.getByRole('button', { name: 'Save and switch cases' }).click()
  await expect(page.locator('#active-case')).toHaveText('case-001')
  await expect(saveButton(page)).toBeEnabled()
  await expect(savedButton(page)).toContainText('0')
  await angle(page).fill('21')
  await page.getByRole('button', { name: 'Choose case', exact: true }).click()
  await page.getByRole('dialog', { name: 'Choose a prepared case' }).getByRole('button', { name: 'Try a CT upload' }).click()
  await page.locator('#ct-file').setInputFiles({ name: 'sample.nii', mimeType: 'application/octet-stream', buffer: Buffer.from('fixture') })
  await page.getByRole('button', { name: 'Continue with demo case' }).click()
  await guard.getByRole('button', { name: 'Discard and switch cases' }).click()
  await expect(page.locator('#active-case')).toHaveText('case-002')
  await expect(saveButton(page)).toBeEnabled()
  await expect(savedButton(page)).toContainText('1')
  await angle(page).fill('18')
  await page.goBack()
  await guard.getByRole('button', { name: 'Stay', exact: true }).click()
  await expect(page).toHaveURL(/#plan$/)
  await expect(angle(page)).toHaveValue('18')
  await page.getByRole('link', { name: 'HepatoPlan home' }).click()
  await guard.getByRole('button', { name: 'Discard and leave planning' }).click()
  await expect(page.locator('#explore')).toBeVisible()
  await page.locator('#explore').click()
  await expect(angle(page)).toHaveValue('0')
  await page.getByRole('checkbox', { name: 'Show plane' }).uncheck()
  await page.getByRole('slider', { name: 'Liver opacity' }).fill('25')
  await page.getByRole('link', { name: 'HepatoPlan home' }).click()
  await expect(page.locator('#explore')).toBeVisible()
})

test('the difference model and four volumes track the selected ordered pair through loading and retry', async ({ page }) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', event => {
          if (event.data.type !== 'comparePlansResult' || !document.documentElement.hasAttribute('data-hold-difference')) return
          event.stopImmediatePropagation()
          document.documentElement.setAttribute('data-difference-held', '')
          window.addEventListener('release-difference', release => {
            document.documentElement.removeAttribute('data-hold-difference')
            document.documentElement.removeAttribute('data-difference-held')
            this.dispatchEvent(new MessageEvent('message', {
              data: (release as CustomEvent).detail
                ? { ...event.data, type: 'comparePlansError', message: 'Test difference failure' } : event.data,
            }))
          }, { once: true })
        })
      }
    }
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await start(page)
  const total = Number((await page.locator('#measure-total').textContent())!.replace(/[^\d.]/g, ''))
  const flip = page.getByRole('button', { name: 'Flip removal side' })
  await save(page, 'Positive')
  await flip.click()
  await save(page, 'Negative')
  await flip.click()
  await save(page, 'Positive copy')
  await page.getByRole('button', { name: 'Compare these plans' }).click()
  const table = page.getByRole('table', { name: 'Saved measurements' })
  const toggle = page.getByRole('checkbox', { name: 'Show differences' })
  const planA = page.getByRole('combobox', { name: 'Plan A' })
  const planB = page.getByRole('combobox', { name: 'Plan B' })
  const swap = page.getByRole('button', { name: 'Swap A/B' })
  const regions = page.getByRole('list', { name: 'Difference volumes' }).locator('strong')
  const canvas = page.getByRole('group', { name: '3D difference model' }).locator('canvas')
  const status = page.locator('#difference-status')
  await expect(toggle).not.toBeChecked()
  await expect(canvas).toHaveCount(0)
  await expect(table.getByRole('columnheader', { name: 'A Negative' })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'B Positive copy' })).toBeVisible()
  await expect(planA.locator('option', { hasText: 'Positive copy' })).toHaveCount(0)
  await toggle.check()
  // Voxels centred directly on the plane remain in both opposite-side cuts.
  await expect(regions).toHaveText([/mL$/, /mL$/, '0 mL', /mL$/])
  const values = await regions.allTextContents()
  const sum = values.reduce((acc, value) => acc + Number(value.replace(/[^\d.]/g, '')), 0)
  expect(Math.abs(sum - total)).toBeLessThanOrEqual(0.002)
  const before = await colourPositions(page, await canvas.screenshot(), 'comparison')
  expect(before.orange).toBeGreaterThan(100)
  expect(before.teal).toBeGreaterThan(100)
  await swap.click()
  await expect(regions).toHaveText([values[1], values[0], values[2], values[3]])
  const after = await colourPositions(page, await canvas.screenshot(), 'comparison')
  expect(after.horizontalDifference * before.horizontalDifference).toBeLessThan(-100)

  await page.evaluate(() => document.documentElement.setAttribute('data-hold-difference', ''))
  await swap.click()
  await expect(page.locator('html')).toHaveAttribute('data-difference-held', '')
  await planA.selectOption({ label: 'Positive' })
  await expect(status).toHaveText('Updating differences…')
  await expect(regions).toHaveText(['—', '—', '—', '—'])
  await expect(table.getByRole('columnheader', { name: 'A Positive', exact: true })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('release-difference')))
  await expect(regions).toHaveText(['0 mL', '0 mL', /mL$/, /mL$/])

  await page.evaluate(() => document.documentElement.setAttribute('data-hold-difference', ''))
  await planB.selectOption({ label: 'Negative' })
  await expect(page.locator('html')).toHaveAttribute('data-difference-held', '')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('release-difference', { detail: true })))
  await expect(status).toHaveText('Difference volumes are unavailable.')
  await expect(regions).toHaveText(['—', '—', '—', '—'])
  await expect(table).toBeVisible()
  await page.getByRole('button', { name: 'Retry differences' }).click()
  await expect(regions).toHaveText([values[1], values[0], values[2], values[3]])
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(table).toBeVisible()
  expect(await page.locator('body').evaluate(node => node.scrollWidth)).toBe(390)
  await toggle.uncheck()
  await expect(canvas).toHaveCount(0)
  await expect(table).toBeVisible()
})
