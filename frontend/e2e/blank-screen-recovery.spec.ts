import { expect, test } from '@playwright/test'

test('shows a recovery screen when a lazy student page fails to load', async ({ page }) => {
  await page.goto('/e2e/error-boundary-probe.html')

  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'This page could not be opened' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
})

test('keeps a reload link visible when the app entry script fails', async ({ page }) => {
  await page.route('**/src/main.tsx', (route) => route.abort())
  await page.goto('/')

  await expect(page.getByText('AralForge is loading…')).toBeVisible()
  await expect(page.getByRole('link', { name: 'reload AralForge' })).toBeVisible()
})
