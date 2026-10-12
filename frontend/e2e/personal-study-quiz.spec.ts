import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Student number').fill('E2E-001')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.app-shell')).toBeVisible()
}

test('dashboard links to an eligible quiz in its Personal Study lesson', async ({ page }) => {
  await signIn(page)

  await expect(page.getByRole('heading', { name: 'Personal Study Quizzes' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Upcoming Work' })).toHaveCount(0)
  await expect(page.getByText('Activities to submit', { exact: true })).toBeVisible()

  const quizLink = page.getByRole('link', { name: /Saved Attempt Hydration.*E2E Attempt Hydration Module/ })
  await expect(quizLink).toBeVisible()
  await expect(quizLink).toHaveAttribute('href', /\/modules\/\d+\?topic=\d+&lesson=\d+&context=PERSONAL#main-activity$/)
  await quizLink.click()

  await expect(page).toHaveURL(/\/modules\/\d+\?topic=\d+&lesson=\d+&context=PERSONAL#main-activity$/)
  await expect(page.locator('#main-activity')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Saved Attempt Hydration' })).toBeVisible()
})
