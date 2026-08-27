import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/admin')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back, E2E Teacher.' })).toBeVisible()
}

test('teacher Overview drives attendance and focused submission review', async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await signIn(page)

  const scheduleId = await page.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem('aralforge.session') ?? '{}') as { access?: string }
    const headers = {
      Authorization: `Bearer ${session.access}`,
      'Content-Type': 'application/json',
    }
    const response = await fetch('http://127.0.0.1:8001/api/subjects/subject-schedules/?limit=100&status=all', { headers })
    const payload = await response.json()
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`)
    const schedules = Array.isArray(payload) ? payload : payload.results
    if (!Array.isArray(schedules)) throw new Error(`Unexpected schedules payload: ${JSON.stringify(payload)}`)
    const schedule = schedules.find((item: { subject_code: string }) => item.subject_code === 'E2E101')
    await fetch(`http://127.0.0.1:8001/api/subjects/subject-schedules/${schedule.id}/`, {
      body: JSON.stringify({ days: 'MO,TU,WE,TH,FR,SA,SU' }),
      headers,
      method: 'PATCH',
    })
    return schedule.id as number
  })

  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back, E2E Teacher.' })).toBeVisible()
  await expect(page.getByText('Needs review', { exact: true })).toBeVisible()
  await expect(page.getByText('Classes today', { exact: true })).toBeVisible()
  await expect(page.getByText('Attendance complete', { exact: true })).toBeVisible()
  await expect(page.getByText('Active students', { exact: true })).toBeVisible()
  await expect(page.locator('.admin-quick-grid')).toHaveCount(0)
  await expect(page.getByText(/Student #/)).toHaveCount(0)
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('teacher-overview-desktop.png') })

  const classRow = page.locator('.teacher-class-row').filter({ hasText: 'E2E101' })
  await expect(classRow).toContainText('Programming Fundamentals')
  await expect(classRow).toContainText('Lab 1')
  await expect(classRow).toContainText('2 students')
  await classRow.getByRole('link', { name: 'Take attendance' }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/classes\\?schedule=${scheduleId}&action=attendance`))
  const attendanceDialog = page.getByRole('dialog', { name: 'Class attendance' })
  await expect(attendanceDialog).toBeVisible()
  await expect(attendanceDialog).toContainText('E2E101')
  await attendanceDialog.getByRole('button', { name: 'Close', exact: true }).click()

  await page.goto('/admin')
  const reviewRow = page.locator('.teacher-overview-row').filter({ hasText: 'Database Reflection' })
  await expect(reviewRow).toContainText('Alex Rivera')
  await expect(reviewRow).toContainText('E2E Main Activity Workflow')
  await reviewRow.getByRole('link', { name: 'Review' }).click()

  await expect(page.getByRole('heading', { name: 'Database Reflection' })).toBeVisible()
  await expect(page.getByText('Alex Rivera', { exact: true })).toBeVisible()
  await expect(page.getByText('I separated the records to reduce duplication and make updates safer.')).toBeVisible()
  await expect(page.getByText('Not linked to a gradebook item')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Main Activity settings' })).toBeVisible()
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('submission-review-desktop.png') })
  await page.getByLabel('Score').fill('8')
  await page.getByLabel('Feedback').fill('Clear explanation and a practical reason.')
  await page.getByRole('button', { name: 'Save grade' }).click()

  await expect(page).toHaveURL(/\/admin\/?$/)
  await expect(page.getByText("You're all caught up", { exact: true })).toBeVisible()
  await expect(page.locator('.stat-card').filter({ hasText: 'Needs review' })).toContainText('0')
  await expect(page.getByText('Alex Rivera received feedback for Database Reflection')).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.mobile-tabbar a')).toHaveCount(4)
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('teacher-overview-mobile.png') })
  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})
