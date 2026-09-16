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


test('student module search icon remains inside the full-width mobile field', async ({ page }) => {
  await signIn(page)
  await page.goto('/modules')
  const search = page.locator('.student-module-library__toolbar .search-box')

  for (const viewport of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport)
    const bounds = await search.evaluate((element) => {
      const input = element.querySelector<HTMLElement>('input[type="search"]')
      const icon = element.querySelector<HTMLElement>('.icon')
      const field = input?.getBoundingClientRect()
      const mark = icon?.getBoundingClientRect()
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        fieldBottom: field?.bottom ?? 0,
        fieldLeft: field?.left ?? 0,
        fieldRight: field?.right ?? 0,
        fieldTop: field?.top ?? 0,
        iconBottom: mark?.bottom ?? 0,
        iconLeft: mark?.left ?? 0,
        iconRight: mark?.right ?? 0,
        iconTop: mark?.top ?? 0,
      }
    })

    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1)
    expect(bounds.iconLeft).toBeGreaterThanOrEqual(bounds.fieldLeft)
    expect(bounds.iconRight).toBeLessThanOrEqual(bounds.fieldRight)
    expect(Math.abs(
      (bounds.iconTop + bounds.iconBottom) / 2 - (bounds.fieldTop + bounds.fieldBottom) / 2,
    )).toBeLessThanOrEqual(1)
  }
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
