import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

async function openClasses(page: Page) {
  await page.goto('/admin/classes')
  await page.getByLabel('Username').fill('e2e-teacher')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/admin(?:\/)?$/)
  await page.goto('/admin/classes')
  await expect(page.getByRole('heading', { name: 'Classes' })).toBeVisible()
}

async function selectClass(page: Page, code: string) {
  await page.locator('.class-list__item').filter({ hasText: code }).click()
  await expect(page).toHaveURL(/\/admin\/classes\?schedule=\d+/)
}

async function startNewSchedule(page: Page) {
  const newButton = page.locator('.class-form').getByRole('button', { name: 'New' })
  if (await newButton.isVisible()) {
    await newButton.click()
    await expect(page.locator('.class-form')).toContainText('New schedule')
    await expect(page).not.toHaveURL(/schedule=/)
  }
}

async function fillSchedule(page: Page, options: {
  days: string[]
  end: string
  section: string
  start: string
  subject: string
  term: string
}) {
  const form = page.locator('.class-form')
  const subjectValue = await form.getByLabel('Subject').locator('option').filter({ hasText: options.subject }).getAttribute('value')
  const termValue = await form.getByLabel('Term').locator('option').filter({ hasText: options.term }).getAttribute('value')
  if (!subjectValue || !termValue) throw new Error('The requested subject or term option is unavailable.')
  await form.getByLabel('Subject').selectOption(subjectValue)
  await form.getByLabel('Term').selectOption(termValue)
  await form.getByLabel('Section').fill(options.section)
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
    await form.getByLabel(day).uncheck()
  }
  for (const day of options.days) await form.getByLabel(day).check()
  await form.getByLabel('Start time').fill(options.start)
  await form.getByLabel('End time').fill(options.end)
}

test('persists class selection and keeps class links scoped', async ({ page }) => {
  await openClasses(page)
  await selectClass(page, 'E2E101')
  const selectedUrl = page.url()

  await page.reload()
  await expect(page).toHaveURL(selectedUrl)
  await expect(page.locator('.class-form').getByLabel('Subject')).toHaveValue(/\d+/)
  await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible()

  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Open Gradebook' })).toHaveAttribute('href', /schedule=\d+/)
  await expect(page.getByRole('menuitem', { name: 'Attendance reports' })).toHaveAttribute('href', /schedule=\d+/)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Attendance' }).click()
  await expect(page.getByRole('dialog')).toContainText('E2E101')
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
})

test('creates allowed schedules and rejects a shared-day overlap', async ({ page }) => {
  await openClasses(page)
  await startNewSchedule(page)
  await fillSchedule(page, {
    days: ['Monday', 'Wednesday'],
    end: '11:00',
    section: 'E2E-ADJ',
    start: '10:00',
    subject: 'E2E102',
    term: '1st Semester',
  })
  await page.locator('.class-form').getByRole('button', { name: 'Save schedule' }).click()
  await expect(page.locator('.class-form')).toContainText('Schedule saved.')
  await expect(page).toHaveURL(/schedule=\d+/)

  await startNewSchedule(page)
  await fillSchedule(page, {
    days: ['Monday'],
    end: '10:30',
    section: 'E2E-CONFLICT',
    start: '09:30',
    subject: 'E2E102',
    term: '1st Semester',
  })
  await page.locator('.class-form').getByRole('button', { name: 'Save schedule' }).click()
  await expect(page.locator('.class-form')).toContainText('Conflicts with E2E101 E2E-A')

  const secondTerm = await page.locator('.class-form').getByLabel('Term').locator('option').filter({ hasText: '2nd Semester' }).getAttribute('value')
  if (!secondTerm) throw new Error('The second term option is unavailable.')
  await page.locator('.class-form').getByLabel('Term').selectOption(secondTerm)
  await page.locator('.class-form').getByRole('button', { name: 'Save schedule' }).click()
  await expect(page.locator('.class-form')).toContainText('Schedule saved.')
})

test('supports keyboard row actions and safe roster removal', async ({ page }) => {
  await openClasses(page)
  await selectClass(page, 'E2E101')

  const alexRow = page.getByRole('row').filter({ hasText: 'Alex Rivera' })
  const alexMenu = alexRow.getByRole('button', { name: 'More actions for Alex Rivera' })
  await alexMenu.focus()
  await alexMenu.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Record score' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.getByRole('menuitem', { name: 'Remove from roster' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(alexMenu).toBeFocused()

  let deleteRequests = 0
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && request.url().includes('/schedule-students/')) deleteRequests += 1
  })
  await alexMenu.click()
  await page.getByRole('menuitem', { name: 'Remove from roster' }).click()
  await expect(page.getByRole('dialog', { name: 'Remove this student?' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Remove this student?' }).getByRole('button', { name: 'Cancel' }).click()
  await expect(alexRow).toBeVisible()
  expect(deleteRequests).toBe(0)

  await page.route('**/api/subjects/schedule-students/*/', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Removal failed for testing.' }) })
    } else {
      await route.continue()
    }
  })
  await alexMenu.click()
  await page.getByRole('menuitem', { name: 'Remove from roster' }).click()
  await page.getByRole('dialog', { name: 'Remove this student?' }).getByRole('button', { name: 'Remove from active roster' }).click()
  await expect(alexRow.getByRole('alert')).toContainText('Removal failed for testing.')
  await expect(alexRow).toBeVisible()
  await page.unroute('**/api/subjects/schedule-students/*/')

  const jamieRow = page.getByRole('row').filter({ hasText: 'Jamie Santos' })
  await jamieRow.getByRole('button', { name: 'More actions for Jamie Santos' }).click()
  await page.getByRole('menuitem', { name: 'Remove from roster' }).click()
  await page.getByRole('dialog', { name: 'Remove this student?' }).getByRole('button', { name: 'Remove from active roster' }).click()
  await expect(jamieRow).toHaveCount(0)
})

test('archives and restores a class without deleting it', async ({ page }) => {
  await openClasses(page)
  await startNewSchedule(page)
  await fillSchedule(page, {
    days: ['Saturday'],
    end: '17:00',
    section: 'E2E-ARCHIVE',
    start: '16:00',
    subject: 'E2E102',
    term: '2nd Semester',
  })
  await page.locator('.class-form').getByRole('button', { name: 'Save schedule' }).click()
  await expect(page.locator('.class-form')).toContainText('Schedule saved.')

  await page.locator('.class-form').getByRole('button', { name: 'Archive class' }).click()
  const dialog = page.getByRole('dialog', { name: 'Archive this class?' })
  await expect(dialog).toContainText('roster, attendance, and grades will be preserved')
  await dialog.getByRole('button', { name: 'Archive class' }).click()
  await expect(page.locator('.class-form')).toContainText('Status: Archived')

  await expect(page.locator('.class-list__item').filter({ hasText: 'E2E-ARCHIVE' })).toBeVisible()

  await page.locator('.class-form').getByRole('button', { name: 'Restore class' }).click()
  await expect(page.locator('.class-form')).toContainText('Status: Active')
})
