import { expect, test, type Page } from '@playwright/test'


async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Student number').fill('E2E-001')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeHidden()
  await expect(page.locator('.dashboard-hero')).toBeVisible()
}


test('retired student coding route returns to the dashboard', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('link', { name: 'Coding', exact: true })).toHaveCount(0)
  await page.goto('/coding')

  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('.dashboard-hero')).toBeVisible()
})


test('student classes include active and past enrollments', async ({ page }) => {
  await signIn(page)
  await page.goto('/classes')

  await expect(page.getByRole('heading', { name: 'Class Schedule' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Programming Fundamentals' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Quiz Workflow' }).first()).toBeVisible()
  await page.getByText('Past Classes', { exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Archived Foundations' })).toBeVisible()
  await expect(page.getByText('Past class', { exact: true })).toBeVisible()
})


test('locked enrolled module exposes topic downloads but no online content', async ({ page }) => {
  await signIn(page)
  await page.goto('/modules')
  const moduleCard = page.locator('.student-module-card').filter({
    has: page.getByRole('heading', { name: 'E2E Quiz Workflow' }),
  })

  await expect(moduleCard).toBeVisible()
  await expect(moduleCard).toContainText('Download published topics for offline study.')
  await expect(moduleCard.getByText('Quiz Workflow Topic', { exact: true })).toBeVisible()
  await expect(moduleCard.getByRole('button', { name: 'Download Topic PDF' })).toBeVisible()
  await expect(moduleCard.locator('a[href*="lesson="]')).toHaveCount(0)

  await expect(moduleCard.getByRole('link')).toHaveCount(0)
  await expect(page.locator('.student-lesson-reader')).toHaveCount(0)
  await expect(page.getByText('Paper Queue Quiz', { exact: true })).toHaveCount(0)
})
