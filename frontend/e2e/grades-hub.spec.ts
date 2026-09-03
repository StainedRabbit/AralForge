import { expect, test, type Page } from '@playwright/test'

async function openTeacherGrades(page: Page) {
  await page.goto('/admin/grades')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/admin(?:\/)?$/)
  await page.goto('/admin/grades')
  await expect(page.getByRole('heading', { name: 'Grades', exact: true })).toBeVisible()
}

test('teacher Grades opens as a class-first grading hub', async ({ page }) => {
  await openTeacherGrades(page)

  const workspace = page.getByRole('navigation', { name: 'Grade workspace' })
  await expect(workspace.getByRole('button', { name: 'Class overview' })).toHaveAttribute('aria-current', 'page')
  await expect(workspace.getByRole('button')).toHaveCount(2)
  await expect(workspace.getByRole('button', { name: 'Computed records' })).toHaveCount(0)
  await expect(workspace.getByRole('button', { name: 'Rewards' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Classes', exact: true })).toBeVisible()
  await expect(page.locator('.grade-class-card')).not.toHaveCount(0)
  const openClass = page.locator('.grade-class-card').filter({ hasText: 'E2E101' }).getByRole('link', { name: 'Open class' })
  const classHref = await openClass.getAttribute('href')
  expect(classHref).toMatch(/^\/admin\/classes\?schedule=\d+$/)
  const scheduleId = new URL(classHref!, 'http://localhost').searchParams.get('schedule')

  await openClass.click()
  await expect(page).toHaveURL(new RegExp(`/admin/classes\\?schedule=${scheduleId}$`))
  await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible()
  await expect(page.locator('.class-list__item.active')).toContainText('E2E101')

  await page.goto('/admin/grades')

  await workspace.getByRole('button', { name: 'Grading setup' }).click()
  await expect(page).toHaveURL(/view=setup/)
  await expect(page.getByRole('heading', { name: 'Grading Templates' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to classes' })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(workspace).toBeVisible()
  await expect(workspace.getByRole('button')).toHaveCount(2)
})

test('Grades requests only the active dataset', async ({ page }) => {
  await openTeacherGrades(page)
  const requestedPaths: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) requestedPaths.push(url.pathname)
  })

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Classes', exact: true })).toBeVisible()
  expect(requestedPaths).toContain('/api/grades/teacher-overview/')
  expect(requestedPaths).not.toContain('/api/grades/templates/')
  expect(requestedPaths).not.toContain('/api/grades/student-categories/')
  expect(requestedPaths).not.toContain('/api/gamification/points/')

  requestedPaths.length = 0
  await page.getByRole('navigation', { name: 'Grade workspace' }).getByRole('button', { name: 'Grading setup' }).click()
  await expect(page.getByRole('heading', { name: 'Grading Templates' })).toBeVisible()
  expect(requestedPaths).toContain('/api/grades/templates/')
  expect(requestedPaths).not.toContain('/api/grades/categories/')
  expect(requestedPaths).not.toContain('/api/grades/student-categories/')
  expect(requestedPaths).not.toContain('/api/gamification/points/')
})

test('stale Records and Rewards URLs return to the class overview without loading removed data', async ({ page }) => {
  await openTeacherGrades(page)
  const requestedPaths: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) requestedPaths.push(url.pathname)
  })

  for (const removedView of ['records', 'rewards']) {
    requestedPaths.length = 0
    await page.goto(`/admin/grades?view=${removedView}&dataset=final_grades&schedule=1&period=FINAL&status=PENDING&student=2`)
    await expect(page.getByRole('navigation', { name: 'Grade workspace' }).getByRole('button', { name: 'Class overview' })).toHaveAttribute('aria-current', 'page')
    await expect(page).toHaveURL(/\/admin\/grades$/)
    expect(requestedPaths).not.toContain('/api/grades/student-categories/')
    expect(requestedPaths).not.toContain('/api/grades/period-grades/')
    expect(requestedPaths).not.toContain('/api/grades/final-grades/')
    expect(requestedPaths).not.toContain('/api/gamification/points/')
    expect(requestedPaths).not.toContain('/api/gamification/student-badges/')
  }
})
