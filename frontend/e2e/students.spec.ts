import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

async function openStudents(page: Page) {
  await page.goto('/admin/students')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/admin(?:\/)?$/)
  await page.goto('/admin/students')
  await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
}

test('directory loads only students, then edits account and profile independently', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await openStudents(page)
  await expect(page.getByRole('button', { name: 'View E2E-001', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'User Accounts' })).toHaveCount(0)
  expect(requests.some((url) => /\/api\/accounts\/users\/\?/.test(url))).toBe(false)
  await page.getByLabel('Search students', { exact: true }).fill('E2E-001')
  await page.getByRole('button', { name: 'View E2E-001', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Student details' })
  const account = dialog.getByRole('form', { name: 'Account details' })
  await account.getByLabel('Middle name (optional)').fill('De Leon')
  const saved = page.waitForResponse((response) => response.request().method() === 'PATCH' && /\/accounts\/users\/\d+\/$/.test(new URL(response.url()).pathname))
  await account.getByRole('button', { name: 'Save changes' }).click()
  const response = await saved
  expect(response.ok()).toBe(true)
  expect(response.request().postDataJSON()).toMatchObject({ middle_name: 'De Leon' })
  expect(response.request().postDataJSON()).not.toHaveProperty('student_number')
  await expect(account.getByText('Account details saved.')).toBeVisible()
  const profile = dialog.getByRole('form', { name: 'Student profile' })
  await profile.getByLabel('Profile active').uncheck()
  await profile.getByRole('button', { name: 'Save changes' }).click()
  await expect(profile.getByText('Student profile saved.')).toBeVisible()
  await expect(account.getByLabel('Account active (can sign in)')).toBeChecked()
  await profile.getByLabel('Profile active').check()
  await profile.getByRole('button', { name: 'Save changes' }).click()
  await expect(profile.getByText('Student profile saved.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close student panel' }).click()
  await expect(page.getByLabel('Search students', { exact: true })).toHaveValue('E2E-001')
  await expect(page.getByRole('button', { name: 'View E2E-001', exact: true })).toBeFocused()
  await expect(page.locator('.students-table')).toContainText('De Leon')
})

test('create validation preserves inputs and success shows credentials; number changes use profile endpoint', async ({ page }) => {
  await openStudents(page)
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add student' })
  await dialog.getByLabel('Student number', { exact: true }).fill('E2E-001')
  await dialog.getByLabel('First name', { exact: true }).fill('New')
  await dialog.getByLabel('Middle name (optional)').fill('Middle')
  await dialog.getByLabel('Last name', { exact: true }).fill('Student')
  await dialog.getByRole('button', { name: 'Create student' }).click()
  await expect(dialog.getByLabel('Student number', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog.getByLabel('First name', { exact: true })).toHaveValue('New')
  await dialog.getByLabel('Student number', { exact: true }).fill('E2E-DIRECTORY-NEW')
  await dialog.getByRole('button', { name: 'Create student' }).click()
  await expect(dialog.getByRole('heading', { name: 'Student account created' })).toBeVisible()
  await expect(dialog.locator('dd')).toHaveText('E2E-DIRECTORY-NEW')
  await dialog.getByRole('button', { name: 'Close student panel' }).click()
  await page.getByLabel('Search students', { exact: true }).fill('E2E-DIRECTORY-NEW')
  await page.getByRole('button', { name: 'View E2E-DIRECTORY-NEW', exact: true }).click()
  const profile = page.getByRole('form', { name: 'Student profile' })
  await expect(profile).toContainText('temporary password will also become the new student number')
  await profile.getByLabel('Student number', { exact: true }).fill('E2E-DIRECTORY-RENAMED')
  await profile.getByRole('button', { name: 'Save changes' }).click()
  await expect(profile.getByText('Student profile saved.')).toBeVisible()
  await expect(page.locator('.students-identity')).toContainText('E2E-DIRECTORY-RENAMED')
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
  await expect(page.getByRole('button', { name: 'View TEST-30', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(page.getByRole('button', { name: 'View TEST-31', exact: true })).toBeVisible()
  expect(pageTwo).toBe(true)
  await page.getByLabel('Search students', { exact: true }).fill('Middle 31')
  await expect(page.locator('.students-table tbody tr')).toHaveCount(1)
  await expect(page.locator('td[data-label="Profile"]')).toHaveText('Active')
  await expect(page.locator('td[data-label="Account"]')).toHaveText('Inactive')
  await page.getByLabel('Search students', { exact: true }).fill('missing')
  await expect(page.getByRole('heading', { name: 'No matching students' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.getByLabel('Profile status').selectOption('inactive')
  await expect(page.getByRole('button', { name: 'View TEST-32', exact: true })).toBeVisible()
})

test('mobile detail panel contains focus and protects unsaved edits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openStudents(page)
  await page.getByRole('button', { name: 'View E2E-001', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Student details' })
  await dialog.getByLabel('First name', { exact: true }).fill('Unsaved')
  page.once('dialog', (prompt) => prompt.dismiss())
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('First name', { exact: true })).toHaveValue('Unsaved')
  page.once('dialog', (prompt) => prompt.dismiss())
  await dialog.getByRole('tab', { name: 'Modules', exact: true }).click()
  await expect(dialog.getByRole('tab', { name: 'Details', exact: true })).toHaveAttribute('aria-selected', 'true')
  await dialog.getByRole('button', { name: 'Close student panel' }).focus()
  await page.keyboard.press('Shift+Tab')
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/students-mobile.png' })
  page.once('dialog', (prompt) => prompt.accept())
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'View E2E-001', exact: true })).toBeFocused()
})

test('selected-student enrollments and Advanced tools remain available', async ({ page }) => {
  await openStudents(page)
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('aralforge.session') ?? '{}').access as string)
  const headers = { Authorization: `Bearer ${token}` }
  const studentNumber = `E2E-ENR-${randomUUID().slice(0, 12)}`
  const created = await page.request.post('http://127.0.0.1:8001/api/accounts/students/', {
    headers, data: { student_number: studentNumber, first_name: 'Enrollment', last_name: 'Fixture' },
  })
  expect(created.ok()).toBe(true)
  const profile = await created.json() as { user: number }
  let releaseRefresh = () => {}
  try {
    await page.getByLabel('Search students', { exact: true }).fill(studentNumber)
    await page.getByRole('button', { name: `View ${studentNumber}`, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Student details' })
    const enrollmentRequest = page.waitForRequest((request) => /\/api\/subjects\/schedule-students\//.test(request.url()) && request.method() === 'GET')
    await dialog.getByRole('tab', { name: 'Enrollments', exact: true }).click()
    const studentId = new URL((await enrollmentRequest).url()).searchParams.get('student')
    await expect(dialog.getByRole('combobox', { name: 'Class schedule', exact: true }).locator('option')).not.toHaveCount(1)
    const available = await dialog.getByRole('combobox', { name: 'Class schedule', exact: true }).locator('option').nth(1).getAttribute('value')
    await dialog.getByRole('combobox', { name: 'Class schedule', exact: true }).selectOption(available!)
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve })
    await page.route('**/api/subjects/schedule-students/?*', async (route) => {
      await refreshGate
      await route.continue()
    })
    const saved = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/subjects/schedule-students/'))
    await dialog.getByRole('button', { name: 'Save enrollment' }).click()
    const response = await saved
    expect(response.request().postDataJSON().student).toBe(Number(studentId))
    expect(response.ok()).toBe(true)
    await expect(dialog.getByRole('button', { name: 'Close student panel' })).toBeDisabled()
    await expect(dialog.getByText('Enrollment saved.')).toHaveCount(0)
    releaseRefresh()
    await expect(dialog.getByText('Enrollment saved.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Edit enrollment' }).last().click()
    await dialog.getByLabel('Enrollment active').uncheck()
    const updated = page.waitForResponse((response) => response.request().method() === 'PATCH' && /\/api\/subjects\/schedule-students\/\d+\/$/.test(new URL(response.url()).pathname))
    await dialog.getByRole('button', { name: 'Save enrollment' }).click()
    const update = await updated
    expect(update.ok()).toBe(true)
    expect(update.request().postDataJSON()).toMatchObject({ student: Number(studentId), is_active: false })
    await expect(dialog.getByText('Enrollment saved.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Close student panel' }).click()
    await expect(dialog).toBeHidden()
    await page.getByRole('tab', { name: 'Advanced tools', exact: true }).click()
    for (const title of ['User Accounts', 'Student Profiles', 'Class Enrollments', 'Module Access Grants', 'Bulk Module Access']) {
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    }
    await page.getByRole('tab', { name: 'Students', exact: true }).click()
    await page.screenshot({ path: 'test-results/students-desktop.png', fullPage: true })
  } finally {
    releaseRefresh()
    const deleted = await page.request.delete(`http://127.0.0.1:8001/api/accounts/users/${profile.user}/`, { headers })
    expect(deleted.ok()).toBe(true)
  }
})

test('activates, revokes, and renews module access without payment fields', async ({ page }) => {
  await openStudents(page)

  await page.getByLabel('Search students', { exact: true }).fill('E2E-002')
  await page.getByRole('button', { name: 'View E2E-002', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Student details' })
  await dialog.getByRole('tab', { name: 'Modules', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Amount paid')).toHaveCount(0)
  await expect(dialog.getByLabel('Receipt / reference')).toHaveCount(0)
  await dialog.locator('.student-module-grant-form select').selectOption({
    label: 'E2E102 - E2E Resume Learning Module',
  })

  const activated = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/modules/access/',
  )
  await dialog.getByRole('button', { name: 'Activate Access' }).click()
  const activationResponse = await activated
  expect(activationResponse.ok()).toBe(true)
  expect(activationResponse.request().postDataJSON()).not.toHaveProperty('amount_paid')
  expect(activationResponse.request().postDataJSON()).not.toHaveProperty('payment_status')
  expect(activationResponse.request().postDataJSON()).not.toHaveProperty('payment_reference')
  await expect(dialog).toContainText('Module access activated.')
  await expect(dialog.locator('.status-pill').filter({ hasText: /^Active$/ })).toBeVisible()

  const revoked = page.waitForResponse((response) =>
    response.request().method() === 'PATCH'
    && /\/api\/modules\/access\/\d+\/$/.test(new URL(response.url()).pathname),
  )
  await dialog.getByRole('button', { name: 'Revoke' }).click()
  expect((await revoked).ok()).toBe(true)
  await expect(dialog.getByText('Revoked', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: 'Renew' }).click()
  const renewed = page.waitForResponse((response) =>
    response.request().method() === 'PATCH'
    && /\/api\/modules\/access\/\d+\/$/.test(new URL(response.url()).pathname),
  )
  await dialog.getByRole('button', { name: 'Activate Access' }).click()
  expect((await renewed).ok()).toBe(true)
  await expect(dialog.locator('.status-pill').filter({ hasText: /^Active$/ })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/students-modules-mobile.png', fullPage: true })
})

test('damaged names are visible and cannot be saved until corrected', async ({ page }) => {
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
  await page.getByRole('button', { name: 'View E2E-001', exact: true }).click()
  const form = page.getByRole('form', { name: 'Account details' })
  await expect(form.getByLabel('First name', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(form.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  await form.getByLabel('First name', { exact: true }).fill('Corrected')
  await expect(form.getByLabel('First name', { exact: true })).toHaveAttribute('aria-invalid', 'false')
  await expect(form.getByRole('button', { name: 'Save changes' })).toBeEnabled()
})

test('directory exposes retry and an empty state without hiding creation', async ({ page }) => {
  let fail = true
  await page.route('**/api/accounts/students/?*', async (route) => {
    await route.fulfill(fail ? { status: 400, json: { detail: 'Students could not load.' } }
      : { json: { count: 0, next: null, previous: null, results: [] } })
  })
  await openStudents(page)
  await expect(page.getByRole('alert')).toContainText('Students could not load.')
  fail = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your student directory starts here' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add student', exact: true }).first()).toBeEnabled()
})

test('Advanced tools account edits refresh the student directory', async ({ page }) => {
  await openStudents(page)
  await expect(page.getByRole('button', { name: 'View E2E-003', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Advanced tools', exact: true }).click()
  const accounts = page.locator('.admin-resource').filter({ has: page.getByRole('heading', { name: 'User Accounts', exact: true }) })
  await accounts.getByRole('row').filter({ hasText: 'E2E-003' }).getByRole('button', { name: 'Edit User', exact: true }).click()
  await accounts.getByLabel('Middle name', { exact: true }).fill('Advanced')
  page.once('dialog', (prompt) => prompt.dismiss())
  await page.getByRole('tab', { name: 'Students', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Advanced tools', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(accounts.getByLabel('Middle name', { exact: true })).toHaveValue('Advanced')
  await accounts.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(accounts.getByText('User saved.', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Students', exact: true }).click()
  await expect(page.locator('.students-table').getByText('Morgan Advanced Lee', { exact: true })).toBeVisible()
})
