import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { CaseIndex, CaseMetadata } from '../src/case-contract.ts'
import type { SavedPlan } from '../src/plan-session.ts'

const root = resolve('.local/research-public/cases')
const targetMs = 150
const demoCase = 'case-002'

type Timing = {
  caseId: string
  revision: number
  workerMs: number
  inputToResultMs: number
  loadMs?: number
}

test.skip(!process.env.HEPATOPLAN_RESEARCH_TEST, 'Requires a locally prepared research release.')

async function timing(page: Page, caseId: string, previousRevision = 0): Promise<Timing> {
  await page.waitForFunction(({ caseId, previousRevision }) => {
    const value = document.getElementById('last-timing')?.textContent
    if (!value) return false
    const result = JSON.parse(value)
    return result.caseId === caseId && result.revision > previousRevision
      && String(result.revision) === document.getElementById('revision')?.textContent
  }, { caseId, previousRevision }, { timeout: 30_000 })
  return JSON.parse((await page.locator('#last-timing').textContent())!)
}

async function openCase(page: Page, caseId: string): Promise<Timing> {
  const previous = Number(await page.locator('#revision').textContent())
  await page.getByRole('combobox', { name: 'Case', exact: true }).selectOption(caseId)
  await expect(page.locator('#status')).toHaveText('ready', { timeout: 30_000 })
  const loaded = await timing(page, caseId, previous)
  expect(loaded.loadMs).toBeGreaterThan(0)
  return loaded
}

async function savePlan(page: Page, name: string): Promise<SavedPlan> {
  await expect(page.locator('#status')).toHaveText('ready', { timeout: 30_000 })
  await page.getByLabel('Plan name').fill(name)
  await page.getByRole('button', { name: 'Save plan' }).click()
  return JSON.parse((await page.locator('#saved-plan').textContent())!)
}

function expectedVolume(meta: CaseMetadata): number {
  const [[a, b, c], [d, e, f], [g, h, i]] = meta.voxelToWorldMm
  return Math.abs(a * (e * i - f * h) + b * (f * g - d * i) + c * (d * h - e * g))
    * meta.labelCounts.parenchyma / 1000
}

async function exerciseInputs(page: Page, caseId: string) {
  const samples: { interaction: 'slider' | 'preset'; workerMs: number; inputToResultMs: number }[] = []
  let current = await timing(page, caseId)
  await page.getByRole('button', { name: 'Reset plane' }).click()
  for (let i = 0; i < 30; i++) {
    const interaction = i < 20 ? 'slider' : 'preset'
    if (interaction === 'slider') {
      await page.getByRole('slider', { name: 'Plane Offset' }).press(i % 2 === 0 ? 'ArrowRight' : 'ArrowLeft')
    } else {
      await page.getByRole('button', { name: i % 2 === 0 ? 'Negative offset' : 'Positive offset' }).click()
    }
    current = await timing(page, caseId, current.revision)
    samples.push({ interaction, workerMs: current.workerMs, inputToResultMs: current.inputToResultMs })
  }
  return samples
}

function percentile(samples: number[], fraction: number) {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * fraction) - 1]
}

function summarise(samples: Awaited<ReturnType<typeof exerciseInputs>>) {
  return {
    sampleCount: samples.length,
    inputP50Ms: percentile(samples.map(sample => sample.inputToResultMs), 0.5),
    inputP95Ms: percentile(samples.map(sample => sample.inputToResultMs), 0.95),
    workerP50Ms: percentile(samples.map(sample => sample.workerMs), 0.5),
    workerP95Ms: percentile(samples.map(sample => sample.workerMs), 0.95),
  }
}

test('prepared research release, demo workflow, and responsiveness', async ({ page, browser }) => {
  test.setTimeout(220_000)
  const index: CaseIndex = JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8'))
  expect(index.cases.length).toBeGreaterThanOrEqual(3)
  expect(index.cases.length).toBeLessThanOrEqual(5)
  const pageErrors: string[] = []
  const responses = new Map<string, number>()
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('response', response => responses.set(new URL(response.url()).pathname, response.status()))

  await page.goto('/browser-tests/fixture.html?research=1')
  await expect(page.locator('#status')).toHaveText('Select a case')
  await expect(page.getByText('Experimental geometry and volumes for research and education.')).toBeVisible()
  const verified = []
  for (const { caseId } of index.cases) {
    const loaded = await openCase(page, caseId)
    const meshPath = `releases/${index.releaseId}/${caseId}`
    for (const name of ['liver.stl', 'tumour.stl', 'metadata.json', 'labels.bin']) {
      expect(responses.get(`/cases/${meshPath}/${name}`)).toBe(200)
    }
    const metadata: CaseMetadata = JSON.parse(await readFile(resolve(root, meshPath, 'metadata.json'), 'utf8'))
    const { result } = await savePlan(page, 'Initial verification')
    const total = expectedVolume(metadata)
    expect(result.totalParenchymaMl).toBeCloseTo(total, 6)
    expect(result.resectedMl + result.remainingMl).toBeCloseTo(total, 6)
    const image = await page.locator('#viewer canvas').screenshot()
    expect(image.byteLength).toBeGreaterThan(4000)
    verified.push({ caseId, initialLoadMs: loaded.loadMs, initialWorkerMs: loaded.workerMs, totalParenchymaMl: total })
  }

  const demoLoad = await openCase(page, demoCase)
  await page.getByRole('slider', { name: 'Plane Offset' }).press('ArrowRight')
  await expect(page.locator('#offset-value')).toHaveText('+1 mm')
  await page.getByRole('slider', { name: 'Plane Angle' }).press('ArrowUp')
  await expect(page.locator('#angle-value')).toHaveText('+1°')
  const first = await savePlan(page, 'Offset and angle')
  await page.getByRole('button', { name: 'Negative offset' }).click()
  await expect(page.locator('#angle-value')).toHaveText('−10°')
  await page.getByLabel('Show Plane').uncheck()
  await page.getByRole('button', { name: 'Flip removal side' }).click()
  const second = await savePlan(page, 'Preset with flipped side')
  expect(first.plane).not.toEqual(second.plane)
  expect(second.plane.resectSide).toBe('negative')
  expect(second.result.resectedMl + second.result.remainingMl).toBeCloseTo(first.result.totalParenchymaMl, 6)

  const chooser = page.getByRole('combobox', { name: 'Plan A' })
  const opener = page.getByRole('button', { name: 'Open Plan A' })
  for (const [plan, angle] of [[first, '+1°'], [second, '−10°']] as const) {
    await chooser.selectOption(plan.id)
    const before = Number(await page.locator('#revision').textContent())
    await opener.click()
    await timing(page, demoCase, before)
    await expect(page.locator('#angle-value')).toHaveText(angle)
    expect((await savePlan(page, 'Reopened verification')).result).toEqual(plan.result)
  }
  await chooser.selectOption(first.id)
  await page.getByRole('combobox', { name: 'Plan B' }).selectOption(second.id)
  await page.getByRole('button', { name: 'Compare plans' }).click()
  const comparison = (await page.locator('#comparison').textContent())!
  expect(comparison.split('\n')).toHaveLength(6)
  for (const label of ['Removed volume', 'Remaining volume', 'Future Liver Remnant',
    'Resected percentage', 'Tumour intersection', 'Tumour-to-plane distance']) {
    expect(comparison).toContain(label)
  }
  await page.getByRole('button', { name: 'Reset plane' }).click()
  await expect(page.locator('#offset-value')).toHaveText('0 mm')
  await expect(page.locator('#angle-value')).toHaveText('0°')
  await timing(page, demoCase)

  const samples = await exerciseInputs(page, demoCase)
  const withViewer = summarise(samples)
  let withoutViewer: ReturnType<typeof summarise> | undefined
  if (withViewer.inputP95Ms > targetMs) {
    const profile = await browser.newPage()
    try {
      await profile.goto(page.url().replace('?research=1', '?research=1&no-render=1'))
      await expect(profile.locator('#status')).toHaveText('Select a case')
      await openCase(profile, demoCase)
      withoutViewer = summarise(await exerciseInputs(profile, demoCase))
    } finally {
      await profile.close()
    }
  }
  expect(pageErrors).toEqual([])
  const report = {
    releaseId: index.releaseId, demoCase, verified, demoLoadMs: demoLoad.loadMs,
    device: { cpu: os.cpus()[0]?.model, platform: os.platform(), arch: os.arch() },
    browser: `Chrome ${browser.version()}, headless software WebGL`,
    targetInputP95Ms: targetMs, withViewer, withoutViewer, samples,
    demo: { planIds: [first.id, second.id], result: 'passed' },
  }
  await writeFile(resolve('.local/task-6-verification.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ ...report, samples: undefined }, null, 2))
})
