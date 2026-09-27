import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

async function openStudents(page: Page, username = 'e2e-teacher') {
  await page.goto('/admin/students')
  await page.getByLabel('Student number').fill(username)
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/admin(?:\/)?$/)
  await page.goto('/admin/students')
  await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
}

test('student list keeps its row action without the Advanced tools view', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.setViewportSize({ width: 1440, height: 900 })
  await openStudents(page)
  await expect(page.locator('.students-page .page-header')).not.toContainText('People and access')
  await expect(page.locator('.students-page .page-header')).not.toContainText('Find students by name')
  expect((await page.locator('.students-page .page-header').boundingBox())!.height).toBeLessThanOrEqual(80)
  await expect(page.getByRole('region', { name: 'Student list' })).toBeVisible()
  await expect(page.locator('.students-table tbody tr').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add student', exact: true })).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'View E2E-001', exact: true })).toBeVisible()
  await expect(page.getByText('Advanced tools', { exact: true })).toHaveCount(0)
  expect(requests.some((url) => /\/api\/accounts\/users\/\?/.test(url))).toBe(false)
  await page.getByRole('button', { name: 'View E2E-001', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Student details' })
  await expect(dialog).toContainText('E2E-001')
  await expect(dialog.getByRole('tab', { name: 'Details', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('form', { name: 'Account details' })).toBeVisible()
  await expect(dialog.getByRole('form', { name: 'Student profile' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Reset password' })).toHaveCount(0)
  await expect(dialog.getByRole('tab', { name: 'Enrollments', exact: true })).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'Modules', exact: true })).toBeVisible()
  await dialog.getByRole('tab', { name: 'Enrollments', exact: true }).click()
  await expect(dialog.getByRole('form', { name: 'Enrollment details' })).toBeVisible()
  await dialog.getByRole('tab', { name: 'Modules', exact: true }).click()
  await expect(dialog.locator('.student-module-grant-form')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close student panel' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'View E2E-001', exact: true })).toBeFocused()
})

test('admin can confirm a password reset in Student details', async ({ page, browser }) => {
  await openStudents(page, 'e2e-admin')
  await page.getByRole('button', { name: 'View E2E-001', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Student details' })
  await dialog.getByRole('button', { name: 'Reset password' }).click()
  await expect(dialog).toContainText('current sessions will end')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog.getByRole('button', { name: 'Confirm reset' })).toHaveCount(0)

  let fail = true
  await page.route('**/api/accounts/students/*/reset-password/', async (route) => {
    if (fail) {
      fail = false
      await route.fulfill({ status: 500, json: { detail: 'Reset failed. Try again.' } })
    } else await route.continue()
  })
  await dialog.getByRole('button', { name: 'Reset password' }).click()
  await dialog.getByRole('button', { name: 'Confirm reset' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Reset failed. Try again.')
  await dialog.getByRole('button', { name: 'Confirm reset' }).click()
  await expect(dialog.getByRole('status')).toContainText('E2E-001')
  await expect(dialog.getByRole('status')).toContainText('must create a new password')
  await expect(dialog.getByRole('form', { name: 'Student profile' })).toContainText('temporary password')
  await dialog.getByRole('button', { name: 'Close student panel' }).click()

  const studentPage = await browser.newPage()
  await studentPage.goto('/admin/students')
  await studentPage.getByLabel('Student number').fill('E2E-001')
  await studentPage.getByLabel('Password', { exact: true }).fill('E2E-001')
  await studentPage.getByRole('button', { name: 'Sign in' }).click()
  await expect(studentPage.getByText('Create your password')).toBeVisible()
  await studentPage.getByLabel('New password', { exact: true }).fill('e2e-password')
  await studentPage.getByLabel('Confirm new password', { exact: true }).fill('e2e-password')
  await studentPage.getByRole('button', { name: 'Set password and continue' }).click()
  await expect(studentPage.locator('.sidebar')).toBeVisible()
  await studentPage.close()
})

test('add student preserves validation inputs and shows credentials', async ({ page }) => {
  await openStudents(page)
  const studentNumber = `E2E-NEW-${randomUUID().slice(0, 8)}`
  await page.getByLabel('Search students', { exact: true }).fill(studentNumber)
  await expect(page.getByRole('heading', { name: 'No matching students' })).toBeVisible()
  await page.getByRole('button', { name: 'Add student', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add student' })
  await dialog.getByLabel('Student number', { exact: true }).fill('E2E-001')
  await dialog.getByLabel('First name', { exact: true }).fill('New')
  await dialog.getByLabel('Middle name (optional)').fill('Middle')
  await dialog.getByLabel('Last name', { exact: true }).fill('Student')
  await dialog.getByRole('button', { name: 'Create student' }).click()
  await expect(dialog.getByLabel('Student number', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog.getByLabel('First name', { exact: true })).toHaveValue('New')

  await dialog.getByLabel('Student number', { exact: true }).fill(studentNumber)
  await dialog.getByRole('button', { name: 'Create student' }).click()
  await expect(dialog.getByRole('heading', { name: 'Student account created' })).toBeVisible()
  await expect(dialog.locator('dd')).toHaveText(studentNumber)
  await dialog.getByRole('button', { name: 'Close student panel' }).click()
  await expect(page.locator('.students-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.students-table')).toContainText(studentNumber)
  await expect(page.getByRole('button', { name: `View ${studentNumber}`, exact: true })).toBeVisible()
  await page.getByRole('button', { name: `View ${studentNumber}`, exact: true }).click()
  const details = page.getByRole('dialog', { name: 'Student details' })
  const email = `updated-${randomUUID().slice(0, 8)}@example.test`
  await details.getByRole('form', { name: 'Account details' }).getByLabel('Email').fill(email)
  await details.getByRole('form', { name: 'Account details' }).getByRole('button', { name: 'Save changes' }).click()
  await expect(details.getByRole('status')).toContainText('Account details saved.')
  await details.getByRole('button', { name: 'Close student panel' }).click()
  await expect(page.locator('.students-table')).toContainText(email)
})

test('repeat searches reuse fresh results and profile filters get separate cache entries', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/accounts/students/?')) requests.push(request.url())
  })
  await openStudents(page)
  const search = page.getByLabel('Search students', { exact: true })
  const count = (term: string, status = 'all') => requests.filter((request) => {
    const params = new URL(request).searchParams
    return params.get('search') === term && params.get('status') === status
  }).length
  await search.fill('E2E-001')
  await expect.poll(() => count('E2E-001')).toBe(1)
  await expect(page.getByRole('button', { name: 'View E2E-001' })).toBeVisible()
  expect(count('E2E-001')).toBe(1)
  await search.fill('E2E-002')
  await expect.poll(() => count('E2E-002')).toBe(1)
  await expect(page.getByRole('button', { name: 'View E2E-002' })).toBeVisible()
  await search.fill('E2E-001')
  await expect(page.getByRole('button', { name: 'View E2E-001' })).toBeVisible()
  expect(count('E2E-001')).toBe(1)
  await page.getByLabel('Profile status').selectOption('inactive')
  await expect.poll(() => count('E2E-001', 'inactive')).toBe(1)
  await expect(page.getByRole('heading', { name: 'No matching students' })).toBeVisible()
  expect(count('E2E-001', 'inactive')).toBe(1)
  await page.getByLabel('Profile status').selectOption('all')
  await expect(page.getByRole('button', { name: 'View E2E-001' })).toBeVisible()
  expect(count('E2E-001')).toBe(1)
})

test('a search older than two minutes refreshes when revisited', async ({ page }) => {
  await openStudents(page)
  await page.clock.install()
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/accounts/students/?')) requests.push(request.url())
  })
  const count = (term: string) => requests.filter((request) => new URL(request).searchParams.get('search') === term).length
  const search = page.getByLabel('Search students', { exact: true })
  await search.fill('E2E-001')
  await expect.poll(() => count('E2E-001')).toBe(1)
  await expect(page.getByRole('button', { name: 'View E2E-001' })).toBeVisible()
  expect(count('E2E-001')).toBe(1)
  await search.fill('E2E-002')
  await expect.poll(() => count('E2E-002')).toBe(1)
  await expect(page.getByRole('button', { name: 'View E2E-002' })).toBeVisible()
  await page.clock.fastForward(120_001)
  await search.fill('E2E-001')
  await expect.poll(() => count('E2E-001')).toBe(2)
})

test('server pagination and profile filtering preserve distinct account status', async ({ page }) => {
  let pageTwo = false
  const profile = (id: number, active: boolean) => ({ id, user: id, student_number: `TEST-${id}`, is_active: active, joined_at: '',
    user_detail: { id, username: `TEST-${id}`, first_name: 'Test', middle_name: 'Middle', last_name: String(id), full_name: `Test Middle ${id}`, email: '', role: 'STUDENT', is_active: false } })
  await page.route('**/api/accounts/students/?*', async (route) => {
    const url = new URL(route.request().url())
    const search = url.searchParams.get('search')
    const inactive = url.searchParams.get('status') === 'inactive'
    const cursor = url.searchParams.get('cursor')
    if (cursor === 'page-two') pageTwo = true
    const results = search === 'missing' ? [] : search ? [profile(31, true)] : inactive ? [profile(32, false)] : cursor ? [profile(31, true)] : Array.from({ length: 30 }, (_, index) => profile(index + 1, true))
    await route.fulfill({ json: { count: 31, previous: null, next: !search && !inactive && !cursor ? 'http://127.0.0.1:8001/api/accounts/students/?pagination=cursor&cursor=page-two' : null, results } })
  })
  await openStudents(page)
  await expect(page.locator('.students-table')).toContainText('TEST-30')
  await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(page.locator('.students-table')).toContainText('TEST-31')
  expect(pageTwo).toBe(true)
  await page.getByLabel('Search students', { exact: true }).fill('Middle 31')
  await expect(page.locator('.students-table tbody tr')).toHaveCount(1)
  await expect(page.locator('td[data-label="Profile"]')).toHaveText('Active')
  await expect(page.locator('td[data-label="Account"]')).toHaveText('Inactive')
  await page.getByLabel('Search students', { exact: true }).fill('missing')
  await expect(page.getByRole('heading', { name: 'No matching students' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.getByLabel('Profile status').selectOption('inactive')
  await expect(page.locator('.students-table')).toContainText('TEST-32')
})

test('mobile list and add dialog keep focus and protect unsaved input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openStudents(page)
  const heading = (await page.getByRole('heading', { name: 'Students' }).boundingBox())!
  const addButton = (await page.getByRole('button', { name: 'Add student', exact: true }).boundingBox())!
  expect(addButton.y).toBeGreaterThanOrEqual(heading.y + heading.height)
  expect((await page.locator('.students-page .page-header').boundingBox())!.height).toBeLessThanOrEqual(120)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'View E2E-001', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add student' })
  await dialog.getByLabel('First name', { exact: true }).fill('Unsaved')
  page.once('dialog', (prompt) => prompt.dismiss())
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('First name', { exact: true })).toHaveValue('Unsaved')
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  page.once('dialog', (prompt) => prompt.accept())
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Add student', exact: true })).toBeFocused()
})

test('damaged names remain visible in the list and cannot be submitted', async ({ page }) => {
  await page.route('**/api/accounts/students/**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const payload = await response.json()
    const profiles = payload.results ?? [payload]
    for (const profile of profiles) {
      if (profile.student_number === 'E2E-001') {
        profile.user_detail.first_name = 'Espa\ufffdol'
        profile.user_detail.full_name = 'Espa\ufffdol Rivera'
      }
    }
    await route.fulfill({ response, json: payload })
  })
  await openStudents(page)
  await expect(page.locator('.students-table').getByText('Name needs correction.')).toBeVisible()
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  const form = page.getByRole('form', { name: 'New student' })
  await form.getByLabel('First name', { exact: true }).fill('Espa\ufffdol')
  await expect(form.getByLabel('First name', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(form.getByRole('button', { name: 'Create student' })).toBeDisabled()
})

test('list exposes retry and an empty state without hiding creation', async ({ page }) => {
  let fail = true
  await page.route('**/api/accounts/students/?*', async (route) => {
    await route.fulfill(fail ? { status: 400, json: { detail: 'Students could not load.' } }
      : { json: { count: 0, next: null, previous: null, results: [] } })
  })
  await openStudents(page)
  await expect(page.getByRole('alert')).toContainText('Students could not load.')
  fail = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'No students yet' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add student', exact: true }).first()).toBeEnabled()
})
