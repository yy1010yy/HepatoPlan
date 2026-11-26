import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { PlanDifferenceResult } from '../src/volumetry.ts'

export async function comparisonVolumes(page: Page, expectedIds: readonly [string, string]): Promise<PlanDifferenceResult> {
  const output = page.locator('#comparison-result')
  await expect(output).not.toBeEmpty()
  const { planIds, volumes } = JSON.parse((await output.textContent())!)
  expect(planIds).toEqual(expectedIds)
  return volumes
}

export async function colourPositions(page: Page, image: Buffer, mode: 'single' | 'comparison') {
  return page.evaluate(async ({ base64, mode }) => {
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
      const cool = mode === 'comparison' ? g > r + 25 && b > g + 20 : g > r + 16 && b > r + 12
      if (cool) { teal++; tealX += x }
    }
    return { orange, teal, horizontalDifference: orangeX / orange - tealX / teal }
  }, { base64: image.toString('base64'), mode })
}
