import { expect, test } from '@playwright/test'

test('shows the minimal essential-storage notice without public legal links', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('region', { name: 'Essential browser storage only' })).toBeVisible()
  await expect(page.getByText(/Secure, HttpOnly sign-in cookie/)).toBeVisible()
  await expect(page.getByRole('link', { name: /legal|privacy|terms/i })).toHaveCount(0)
  await page.getByRole('button', { name: 'Got it' }).click()
  await expect(page.getByRole('region', { name: 'Essential browser storage only' })).toBeHidden()
})

test('does not expose advanced privacy endpoints or public legal content', async ({ page }) => {
  await page.goto('/legal/privacy')
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()

  const status = await page.evaluate(async () => {
    const response = await fetch('http://127.0.0.1:8001/api/privacy/legal-status/')
    return response.status
  })
  expect(status).toBe(404)
})

test('baseline UI contains no commercial, tracking, public-registration, or advanced privacy controls', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /subscribe|checkout|refund|advertis|analytics|marketing|privacy request|data protection officer/i })).toHaveCount(0)
  await expect(page.locator('a[href*="legal"], a[href*="privacy"], a[href*="register"], a[href*="signup"]')).toHaveCount(0)
  await expect(page.getByText(/privacy request|data protection officer/i)).toHaveCount(0)
})
