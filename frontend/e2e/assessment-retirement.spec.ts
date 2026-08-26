import { expect, test, type Page } from '@playwright/test'


async function signIn(page: Page, username: string) {
  await page.getByLabel('Student number').fill(username)
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeHidden()
}


test('students have no Assessment or Test navigation and legacy URLs redirect to Modules', async ({ page }) => {
  await page.goto('/')
  await signIn(page, 'E2E-001')
  await expect(page.locator('.dashboard-hero h1')).toBeVisible()

  await expect(page.locator('a[href^="/assessments"]')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Assessments', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Tests', exact: true })).toHaveCount(0)

  await page.goto('/assessments/123')
  await expect(page).toHaveURL(/\/modules$/)
  await expect(page.getByRole('heading', { name: 'Modules' })).toBeVisible()
})


test('teachers have no Assessment navigation and the legacy authoring URL redirects to Gradebook', async ({ page }) => {
  await page.goto('/admin')
  await signIn(page, 'e2e-teacher')
  await page.waitForURL(/\/admin\/?$/)

  await expect(page.locator('a[href^="/admin/assessments"]')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Assessments', exact: true })).toHaveCount(0)

  await page.goto('/admin/assessments')
  await expect(page).toHaveURL(/\/admin\/gradebook(?:\?.*)?$/)
  await expect(page.getByRole('heading', { name: 'Gradebook' })).toBeVisible()
})
