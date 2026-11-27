import { expect, test } from '@playwright/test'

test('both analysis fixtures show findings and retain their direct inspection actions', async ({ page }) => {
  await page.goto('./browser-tests/analysis-panel.html')
  const single = page.getByRole('region', { name: 'Single plan fixture' })
  const pair = page.getByRole('region', { name: 'Comparison fixture' })
  await expect(single.getByRole('heading', { name: 'AI recommendation' })).toBeVisible()
  await expect(single.getByText(/retained 24 mL more parenchyma/)).toBeVisible()
  await single.getByRole('button', { name: 'Preview alternative' }).click()
  await expect(single.getByText('Tested cut selected')).toBeFocused()
  await expect(pair.getByText(/B retains 10 mL more parenchyma/)).toBeVisible()
  await expect(pair.getByRole('button', { name: 'Open Plan B' })).toBeVisible()
  await pair.getByRole('button', { name: 'Open Plan B' }).focus()
  await page.keyboard.press('Enter')
  await expect(pair.getByText('Plan B tumour intersection')).toBeFocused()
  await expect(page.getByRole('button', { name: 'View supporting measurements' })).toHaveCount(0)
})
