import { expect, test, type Page } from '@playwright/test'


async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Student number').fill('E2E-001')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeHidden()
  await expect(page.locator('.dashboard-hero')).toBeVisible()
}


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
  await page.getByLabel('Subject').selectOption({ label: 'E2EQ1 - Quiz Workflow' })

  await expect(page.getByRole('heading', { name: 'E2E Main Activity Workflow' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Topics available for download' })).toBeVisible()
  await expect(page.getByText('Quiz Workflow Topic', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download Topic PDF' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download Module PDF' })).toHaveCount(0)
  await expect(page.locator('a[href*="lesson="]')).toHaveCount(0)

  await page.getByRole('link', { name: 'Module Contents' }).click()
  await expect(page.getByRole('heading', { name: 'Download a topic' })).toBeVisible()
  await expect(page.getByText('Quiz Workflow Topic', { exact: true })).toBeVisible()
  await expect(page.locator('.student-lesson-reader')).toHaveCount(0)
  await expect(page.getByText('Paper Queue Quiz', { exact: true })).toHaveCount(0)
})
