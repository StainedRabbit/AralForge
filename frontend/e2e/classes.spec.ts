import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

function encodeWindows1252(value: string) {
  const bytes = Array.from(value, (character) => {
    if (character === '\u00f1') return 0xf1
    if (character === '\u00d1') return 0xd1
    const code = character.codePointAt(0) ?? 0
    if (code > 0x7f) throw new Error(`Missing Windows-1252 test mapping for ${character}`)
    return code
  })
  return Buffer.from(bytes)
}

async function openClasses(page: Page) {
  await page.goto('/admin/classes')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
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
  if (/schedule=/.test(page.url())) {
    await expect(newButton).toBeVisible()
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
  const subjectValue = await form.getByLabel('Subject', { exact: true }).locator('option').filter({ hasText: options.subject }).getAttribute('value')
  const termValue = await form.getByLabel('Term', { exact: true }).locator('option').filter({ hasText: options.term }).getAttribute('value')
  if (!subjectValue || !termValue) throw new Error('The requested subject or term option is unavailable.')
  await form.getByLabel('Subject', { exact: true }).selectOption(subjectValue)
  await form.getByLabel('Term', { exact: true }).selectOption(termValue)
  await form.getByLabel('Section').fill(options.section)
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
    await form.getByLabel(day).uncheck()
  }
  for (const day of options.days) await form.getByLabel(day).check()
  await form.getByLabel('Start time').fill(options.start)
  await form.getByLabel('End time').fill(options.end)
}

test('persists class selection and keeps class links scoped', async ({ page }, testInfo) => {
  await openClasses(page)
  await selectClass(page, 'E2E101')
  const selectedUrl = page.url()

  await page.reload()
  await expect(page).toHaveURL(selectedUrl)
  await expect(page.locator('.class-form').getByLabel('Subject', { exact: true })).toHaveValue(/\d+/)
  await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible()
  const rosterTotals = page.getByRole('group', { name: 'Filter roster by status' })
  await expect(rosterTotals).toContainText('2Active')
  await expect(rosterTotals).toContainText('0Inactive')
  await expect(rosterTotals.locator('.class-roster-summary__item')).toHaveCount(2)
  const activeFilter = rosterTotals.getByRole('button', { name: '2 Active' })
  const inactiveFilter = rosterTotals.getByRole('button', { name: '0 Inactive' })
  await expect(activeFilter).toHaveAttribute('aria-pressed', 'true')
  await expect(inactiveFilter).toHaveAttribute('aria-pressed', 'false')

  const rosterSearch = page.getByPlaceholder('Search roster by name or student number')
  await rosterSearch.fill('Alex')
  await expect(page.getByRole('row').filter({ hasText: 'Alex Rivera' })).toBeVisible()
  await inactiveFilter.focus()
  await inactiveFilter.press('Enter')
  await expect(inactiveFilter).toHaveAttribute('aria-pressed', 'true')
  await expect(activeFilter).toHaveAttribute('aria-pressed', 'false')
  await expect(rosterSearch).toHaveValue('Alex')
  await expect(page.getByText('No roster matches found for this search.')).toBeVisible()
  await rosterSearch.clear()
  await expect(page.getByText('No inactive students in this class.')).toBeVisible()
  await activeFilter.click()
  await expect(activeFilter).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('row').filter({ hasText: 'Alex Rivera' })).toBeVisible()

  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Open Gradebook' })).toHaveAttribute('href', /schedule=\d+/)
  await expect(page.getByRole('menuitem', { name: 'Attendance reports' })).toHaveAttribute('href', /schedule=\d+/)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Attendance' }).click()
  const attendanceDialog = page.getByRole('dialog', { name: 'Class attendance' })
  await expect(attendanceDialog).toContainText('E2E101')
  const attendanceDate = attendanceDialog.getByLabel('Attendance date')
  const today = new Date()
  const expectedToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const selectedDate = new Date(today)
  selectedDate.setDate(selectedDate.getDate() + 30 + testInfo.retry)
  const selectedAttendanceDate = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`
  await expect(attendanceDate).toHaveValue(expectedToday)
  await attendanceDate.fill(selectedAttendanceDate)
  await expect(attendanceDate).toHaveValue(selectedAttendanceDate)
  await expect(attendanceDialog.getByLabel('Title')).toHaveCount(0)
  await expect(attendanceDialog.getByLabel('Points possible')).toHaveCount(0)
  await attendanceDialog.getByRole('button', { name: 'Start session' }).click()
  await expect(attendanceDialog).toContainText('This date is in the future.')
  await attendanceDialog.getByRole('button', { name: 'Create future session' }).click()
  await expect(attendanceDialog).toContainText('Attendance session started.')
  const currentStudentName = attendanceDialog.getByRole('heading', { name: 'Rivera, Alex' })
  await expect(currentStudentName).toBeVisible()
  await expect(currentStudentName).toHaveCSS('white-space', 'nowrap')
  await expect(attendanceDialog.locator('.attendance-student-card__avatar')).toHaveCount(0)
  await expect(attendanceDialog.getByText('Current student', { exact: true })).toHaveCount(0)
  await expect(attendanceDialog).toContainText('1 of 2')
  await attendanceDialog.getByRole('button', { name: 'Skip for now' }).click()
  await expect(attendanceDialog.getByRole('heading', { name: 'Santos, Jamie' })).toBeVisible()
  await attendanceDialog.getByRole('button', { name: 'Previous' }).click()
  await expect(attendanceDialog.getByRole('heading', { name: 'Rivera, Alex' })).toBeVisible()
  let releaseFailedMark = () => undefined
  const failedMarkGate = new Promise<void>((resolve) => { releaseFailedMark = resolve })
  let failedMarkRequests = 0
  await page.route('**/api/attendance/sessions/*/mark/', async route => {
    failedMarkRequests += 1
    await failedMarkGate
    await route.fulfill({
      body: JSON.stringify({ detail: 'Temporary mark failure.' }),
      contentType: 'application/json',
      status: 500,
    })
  })
  await attendanceDialog.getByRole('button', { name: 'Present', exact: true }).click()
  await expect(attendanceDialog.getByRole('heading', { name: 'Santos, Jamie' })).toBeVisible()
  await expect(attendanceDialog.getByRole('button', { name: 'Mark remaining Present' })).toBeDisabled()
  await attendanceDialog.getByRole('button', { name: 'Absent', exact: true }).click()
  await expect(attendanceDialog.getByRole('heading', { name: 'All 2 students are marked' })).toBeVisible()
  await expect(attendanceDialog.getByText('Saving 2 marks...')).toBeVisible()
  await expect(attendanceDialog.getByRole('button', { name: 'Finish' })).toBeDisabled()
  await expect(attendanceDialog.getByRole('button', { name: 'History', exact: true })).toBeDisabled()
  await expect(attendanceDialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled()
  await expect.poll(() => failedMarkRequests).toBe(1)
  releaseFailedMark()
  await expect(attendanceDialog).toContainText('Temporary mark failure.')
  await expect(attendanceDialog.getByRole('heading', { name: 'Rivera, Alex' })).toBeVisible()
  await page.unroute('**/api/attendance/sessions/*/mark/')

  let releaseFirstSavedMark = () => undefined
  const firstSavedMarkGate = new Promise<void>((resolve) => { releaseFirstSavedMark = resolve })
  const savedMarkStatuses: string[] = []
  await page.route('**/api/attendance/sessions/*/mark/', async route => {
    const payload = route.request().postDataJSON() as { status: string }
    savedMarkStatuses.push(payload.status)
    if (savedMarkStatuses.length === 1) await firstSavedMarkGate
    await route.continue()
  })
  await attendanceDialog.getByRole('button', { name: 'Present', exact: true }).click()
  const secondStudentName = attendanceDialog.getByRole('heading', { name: 'Santos, Jamie' })
  await expect(secondStudentName).toBeVisible()
  await expect(secondStudentName).toBeFocused()
  await attendanceDialog.getByRole('button', { name: 'Absent', exact: true }).click()
  await expect(attendanceDialog.getByRole('heading', { name: 'All 2 students are marked' })).toBeVisible()
  await expect(attendanceDialog.getByText('Saving 2 marks...')).toBeVisible()
  await expect.poll(() => savedMarkStatuses).toEqual(['PRESENT'])
  releaseFirstSavedMark()
  await expect.poll(() => savedMarkStatuses).toEqual(['PRESENT', 'ABSENT'])
  await expect(attendanceDialog.getByText(/Saving \d+ marks?\.\.\./)).toHaveCount(0)
  await expect(attendanceDialog.getByRole('button', { name: 'Finish' })).toBeEnabled()
  await page.unroute('**/api/attendance/sessions/*/mark/')
  await attendanceDialog.getByRole('button', { name: 'Undo last' }).click()
  await expect(secondStudentName).toBeVisible()
  await attendanceDialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(attendanceDialog).toBeHidden()

  await page.getByRole('button', { name: 'Attendance', exact: true }).click()
  const resumedAttendanceDate = attendanceDialog.getByLabel('Attendance date')
  await expect(resumedAttendanceDate).toHaveValue(expectedToday)
  await resumedAttendanceDate.fill(selectedAttendanceDate)
  await attendanceDialog.getByRole('button', { name: 'Continue session' }).click()
  await expect(attendanceDialog.getByRole('heading', { name: 'Santos, Jamie' })).toBeVisible()
  await expect(attendanceDialog).toContainText('latest saved marks')
  await page.setViewportSize({ width: 390, height: 844 })
  const statusButtons = attendanceDialog.locator('.attendance-status-action')
  await expect(statusButtons).toHaveCount(4)
  for (const button of await statusButtons.all()) {
    const box = await button.boundingBox()
    expect(box?.width).toBeLessThan(180)
  }
  await attendanceDialog.getByRole('button', { name: 'Mark remaining Present' }).click()
  await expect(attendanceDialog.getByRole('alertdialog', { name: 'Confirm mark remaining present' })).toBeVisible()
  await attendanceDialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(attendanceDialog.getByRole('heading', { name: 'All 2 students are marked' })).toBeVisible()
  await attendanceDialog.getByRole('button', { name: 'Review from first' }).click()
  await attendanceDialog.getByLabel('Jump to student').selectOption({ label: 'Santos, Jamie' })
  await expect(attendanceDialog.getByRole('heading', { name: 'Santos, Jamie' })).toBeVisible()
  await page.keyboard.press('4')
  await attendanceDialog.getByRole('button', { name: 'Confirm excused' }).click()
  await expect(attendanceDialog).toContainText('Enter an excuse reason.')
  await expect(attendanceDialog.getByRole('heading', { name: 'Santos, Jamie' })).toBeVisible()
  await attendanceDialog.getByLabel('Excuse reason').fill('Medical appointment')
  await attendanceDialog.getByRole('button', { name: 'Confirm excused' }).click()
  await expect(attendanceDialog.getByRole('heading', { name: 'All 2 students are marked' })).toBeVisible()
  const attendanceTotals = attendanceDialog.getByRole('group', { name: 'Attendance totals' })
  await expect(attendanceTotals).toContainText('1Present')
  await expect(attendanceTotals).toContainText('1Excused')
  await attendanceDialog.getByRole('button', { name: 'Review from first' }).click()
  await expect(attendanceDialog.getByRole('heading', { name: 'Rivera, Alex' })).toBeVisible()
  await attendanceDialog.getByRole('button', { name: 'Late', exact: true }).click()
  await expect(attendanceDialog.getByRole('heading', { name: 'All 2 students are marked' })).toBeVisible()
  await expect(attendanceTotals).toContainText('1Late')
  await attendanceDialog.getByRole('button', { name: 'History', exact: true }).click()
  const selectedAttendanceDateLabel = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
  }).format(new Date(`${selectedAttendanceDate}T00:00:00`))
  const selectedAttendanceRow = attendanceDialog.getByRole('row').filter({
    hasText: selectedAttendanceDateLabel,
  })
  await expect(selectedAttendanceRow).toHaveCount(1)
  await selectedAttendanceRow.getByRole('button', { name: 'View', exact: true }).click()
  const riveraHistoryRow = attendanceDialog.getByRole('row').filter({ hasText: 'Rivera, Alex' })
  await riveraHistoryRow.locator('select').selectOption('EXCUSED')
  await attendanceDialog.getByRole('button', { name: 'Confirm Excused' }).click()
  await expect(attendanceDialog).toContainText('Enter an excuse reason.')
  await attendanceDialog.getByLabel('Excuse reason for Rivera, Alex').fill('School activity')
  await attendanceDialog.getByRole('button', { name: 'Confirm Excused' }).click()
  await expect(attendanceDialog).toContainText('Attendance status updated.')
  await page.keyboard.press('Escape')
  await expect(attendanceDialog).toBeHidden()

  for (const chip of await rosterTotals.locator('.class-roster-summary__item').all()) {
    const box = await chip.boundingBox()
    expect(box?.height).toBeLessThanOrEqual(40)
    expect(box?.width).toBeLessThanOrEqual(120)
  }
})

test('opens the selected class subject module from the roster actions', async ({ page }) => {
  await openClasses(page)

  await selectClass(page, 'E2E101')
  await expect(
    page.getByRole('button', {
      name: 'Open Module unavailable: no module is linked to this subject',
    }),
  ).toBeDisabled()

  await selectClass(page, 'E2E102')
  const openModuleLink = page.getByRole('link', { name: 'Open Module' })
  const moduleHref = await openModuleLink.getAttribute('href')
  expect(moduleHref).toMatch(/^\/admin\/modules\?subject=\d+$/)

  await openModuleLink.click()
  await expect(page).toHaveURL(/\/admin\/modules\?subject=\d+/)
  await expect(page.getByText('Resume Basics', { exact: true }).first()).toBeVisible()
})

test('activates and refreshes module access from the class roster without duplicate grants', async ({ page }) => {
  const accessRequests: string[] = []
  page.on('request', (request) => {
    if (/\/api\/modules\/access\/(?:\d+\/)?$/.test(new URL(request.url()).pathname)) {
      accessRequests.push(request.method())
    }
  })

  await openClasses(page)
  await page.locator('.class-list__item')
    .filter({ hasText: 'E2EQ1' })
    .filter({ hasText: 'E2E-C' })
    .click()
  await expect(page).toHaveURL(/\/admin\/classes\?schedule=\d+/)

  const alexRow = page.getByRole('row').filter({ hasText: 'Alex Rivera' })
  await alexRow.getByRole('button', { name: 'More actions for Alex Rivera' }).click()
  await page.getByRole('menuitem', { name: 'Modules' }).click()

  let dialog = page.getByRole('dialog', { name: 'Module Access' })
  const moduleSelect = dialog.locator('.student-module-grant-form select')
  let enrolledModuleRow = dialog.locator('.student-module-access-section').first()
    .locator('article')
    .filter({ hasText: 'E2E Main Activity Workflow' })
  let grantRow = dialog.locator('.student-module-access-section').nth(1)
    .locator('article')
    .filter({ hasText: 'E2E Main Activity Workflow' })
  await expect(moduleSelect).toHaveValue(/\d+/)
  await expect(moduleSelect.locator('option:checked')).toHaveText(
    'E2EQ1 - E2E Main Activity Workflow',
  )
  await expect(enrolledModuleRow.getByText('Locked', { exact: true })).toBeVisible()

  const activated = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/modules/access/',
  )
  await dialog.getByRole('button', { name: 'Activate Access' }).click()
  expect((await activated).ok()).toBe(true)
  await expect(dialog).toContainText('Module access activated.')
  await expect(enrolledModuleRow.getByText('Active', { exact: true })).toBeVisible()
  await expect(grantRow.getByText('Active', { exact: true })).toBeVisible()

  await dialog.getByTitle('Close').click()
  await expect(dialog).toBeHidden()

  await alexRow.getByRole('button', { name: 'More actions for Alex Rivera' }).click()
  await page.getByRole('menuitem', { name: 'Modules' }).click()
  dialog = page.getByRole('dialog', { name: 'Module Access' })
  enrolledModuleRow = dialog.locator('.student-module-access-section').first()
    .locator('article')
    .filter({ hasText: 'E2E Main Activity Workflow' })
  grantRow = dialog.locator('.student-module-access-section').nth(1)
    .locator('article')
    .filter({ hasText: 'E2E Main Activity Workflow' })
  await expect(enrolledModuleRow.getByText('Active', { exact: true })).toBeVisible()
  await expect(grantRow.getByText('Active', { exact: true })).toBeVisible()

  const reactivated = page.waitForResponse((response) =>
    response.request().method() === 'PATCH'
    && /\/api\/modules\/access\/\d+\/$/.test(new URL(response.url()).pathname),
  )
  await dialog.getByRole('button', { name: 'Activate Access' }).click()
  expect((await reactivated).ok()).toBe(true)
  expect(accessRequests.filter((method) => method === 'POST')).toHaveLength(1)

  const revoked = page.waitForResponse((response) =>
    response.request().method() === 'PATCH'
    && /\/api\/modules\/access\/\d+\/$/.test(new URL(response.url()).pathname),
  )
  await grantRow.getByRole('button', { name: 'Revoke' }).click()
  expect((await revoked).ok()).toBe(true)
  await expect(enrolledModuleRow.getByText('Locked', { exact: true })).toBeVisible()
  await expect(grantRow.getByText('Revoked', { exact: true })).toBeVisible()

  await grantRow.getByRole('button', { name: 'Renew' }).click()
  const renewed = page.waitForResponse((response) =>
    response.request().method() === 'PATCH'
    && /\/api\/modules\/access\/\d+\/$/.test(new URL(response.url()).pathname),
  )
  await dialog.getByRole('button', { name: 'Activate Access' }).click()
  expect((await renewed).ok()).toBe(true)
  await expect(enrolledModuleRow.getByText('Active', { exact: true })).toBeVisible()
  await expect(grantRow.getByText('Active', { exact: true })).toBeVisible()

  const cleanup = page.waitForResponse((response) =>
    response.request().method() === 'PATCH'
    && /\/api\/modules\/access\/\d+\/$/.test(new URL(response.url()).pathname),
  )
  await grantRow.getByRole('button', { name: 'Revoke' }).click()
  expect((await cleanup).ok()).toBe(true)
  await expect(enrolledModuleRow.getByText('Locked', { exact: true })).toBeVisible()
})

test('loads the roster ten students at a time and exports the complete filtered list', async ({ page }) => {
  const rosterRequests: Array<{ limit: number; offset: number; search: string; status: string }> = []
  const students = Array.from({ length: 12 }, (_, index) => ({
    email: `paged-${index + 1}@example.test`,
    grade_summary: {},
    student_name: `Paged Student ${String(index + 1).padStart(2, '0')}`,
    student_full_name: `Paged Middle Student ${String(index + 1).padStart(2, '0')}`,
    student_number: `PAGE-${String(index + 1).padStart(3, '0')}`,
  }))

  await page.route(/\/subjects\/subject-schedules\/\d+\/roster\/.*/, async (route) => {
    const url = new URL(route.request().url())
    const limit = Number(url.searchParams.get('limit') ?? 50)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const search = url.searchParams.get('search') ?? ''
    const rosterStatus = url.searchParams.get('status') ?? ''
    const scheduleId = Number(url.pathname.match(/subject-schedules\/(\d+)/)?.[1])
    const normalizedSearch = search.toLowerCase()
    const filteredStudents = students.filter((student) =>
      `${student.student_name} ${student.student_number}`.toLowerCase().includes(normalizedSearch),
    )
    const pageStudents = filteredStudents.slice(offset, offset + limit)
    rosterRequests.push({ limit, offset, search, status: rosterStatus })

    await route.fulfill({
      body: JSON.stringify({
        active_count: students.length,
        count: filteredStudents.length,
        inactive_count: 0,
        next: offset + limit < filteredStudents.length ? offset + limit : null,
        previous: offset ? Math.max(offset - limit, 0) : null,
        results: pageStudents.map((student, index) => ({
          ...student,
          added_at: '2026-08-04T00:00:00Z',
          added_by: null,
          deactivated_at: null,
          deactivated_by: null,
          id: 1000 + offset + index,
          is_active: true,
          schedule: scheduleId,
          schedule_display: 'E2E101 A',
          school_year_semester: 1,
          student: 2000 + offset + index,
          subject: 1,
          subject_code: 'E2E101',
          subject_name: 'Programming Fundamentals',
          term_name: 'First Semester',
          updated_at: '2026-08-04T00:00:00Z',
        })),
        total_count: students.length,
      }),
      contentType: 'application/json',
      status: 200,
    })
  })

  await openClasses(page)
  await selectClass(page, 'E2E101')

  const rosterScroller = page.locator('.class-roster-scroll')
  const pagination = page.locator('.class-roster-pagination')
  const rosterRows = page.locator('.class-roster-table tbody').getByRole('row')
  await expect(pagination).toContainText('Showing 10 of 12 students')
  await expect(rosterRows).toHaveCount(10)
  await expect(pagination.getByRole('button', { name: 'Load more' })).toBeEnabled()
  expect(rosterRequests[0]).toMatchObject({ limit: 10, offset: 0, status: 'active' })

  const desktopScrollMetrics = await rosterScroller.evaluate((element) => {
    const styles = window.getComputedStyle(element)
    return {
      clientHeight: element.clientHeight,
      maxHeight: styles.maxHeight,
      overflowY: styles.overflowY,
      scrollHeight: element.scrollHeight,
    }
  })
  expect(desktopScrollMetrics.maxHeight).not.toBe('none')
  expect(desktopScrollMetrics.overflowY).toBe('auto')
  expect(desktopScrollMetrics.clientHeight).toBeLessThanOrEqual(680)
  expect(desktopScrollMetrics.scrollHeight).toBeGreaterThan(desktopScrollMetrics.clientHeight)
  await expect(page.locator('.class-roster-table thead th').first()).toHaveCSS('position', 'sticky')
  await expect(pagination).toHaveCSS('position', 'sticky')

  await rosterScroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(pagination).toContainText('Showing 12 of 12 students')
  await expect(rosterRows).toHaveCount(12)
  expect([...new Set(rosterRequests.filter((request) => request.limit === 10).map((request) => request.offset))]).toEqual([0, 10])

  await page.getByPlaceholder('Search roster by name or student number').fill('Paged Student 12')
  await expect(pagination).toContainText('Showing 1 of 1 student')
  expect(rosterRequests.at(-1)).toMatchObject({ limit: 10, offset: 0, search: 'Paged Student 12' })

  await page.getByPlaceholder('Search roster by name or student number').clear()
  await expect(pagination).toContainText(/Showing (10|12) of 12 students/)
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Export roster CSV' }).click()
  const download = await downloadPromise
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const csv = await readFile(downloadPath!, 'utf8')
  expect(csv.trim().split('\n')).toHaveLength(13)
  expect(csv).toContain('Paged Middle Student 01')
  expect(csv).toContain('Paged Middle Student 12')
  expect(rosterRequests).toContainEqual({ limit: 100, offset: 0, search: '', status: 'active' })

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileScrollMetrics = await rosterScroller.evaluate((element) => ({
    clientHeight: element.clientHeight,
    maxHeight: window.getComputedStyle(element).maxHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(mobileScrollMetrics.maxHeight).toBe('none')
  expect(mobileScrollMetrics.scrollHeight).toBe(mobileScrollMetrics.clientHeight)
})

test('loads the Select Class list ten classes at a time inside its panel', async ({ page }) => {
  const classRequests: Array<{ limit: number; offset: number; search: string; term: string }> = []
  let failNextClassPage = false
  const classes = Array.from({ length: 12 }, (_, index) => ({
    archived_at: null,
    archived_by: null,
    created_at: '2026-08-04T00:00:00Z',
    created_by: null,
    days: 'MO,WE,FR',
    end_time: '10:00:00',
    id: 9001 + index,
    is_active: true,
    room: `Lab ${index + 1}`,
    school_year_semester: 1,
    section: `Batch ${String(index + 1).padStart(2, '0')}`,
    start_time: '09:00:00',
    subject: 1,
    subject_code: `PCLS${String(index + 1).padStart(2, '0')}`,
    subject_name: `Paged Class ${String(index + 1).padStart(2, '0')}`,
    term_name: '1st Semester 2027-2028',
    updated_at: '2026-08-04T00:00:00Z',
    updated_by: null,
  }))

  await page.route(/\/subjects\/subject-schedules\/9012\/$/, async (route) => {
    await route.fulfill({
      body: JSON.stringify(classes[11]),
      contentType: 'application/json',
      status: 200,
    })
  })

  await page.route(/\/subjects\/subject-schedules\/\?.*/, async (route) => {
    const url = new URL(route.request().url())
    const limit = Number(url.searchParams.get('limit') ?? 50)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const search = url.searchParams.get('search') ?? ''
    const term = url.searchParams.get('term') ?? ''
    const termId = Number(term || 1)
    const matchingTermClasses = classes.map((schedule) => ({
      ...schedule,
      school_year_semester: termId,
    }))
    const normalizedSearch = search.toLowerCase()
    const filteredClasses = matchingTermClasses.filter((schedule) =>
      `${schedule.subject_code} ${schedule.subject_name} ${schedule.section} ${schedule.days} ${schedule.room}`
        .toLowerCase()
        .includes(normalizedSearch),
    )

    if (limit === 10) classRequests.push({ limit, offset, search, term })
    if (failNextClassPage && limit === 10 && offset === 10) {
      failNextClassPage = false
      await route.fulfill({ body: JSON.stringify({ detail: 'Temporary class page failure.' }), status: 500 })
      return
    }

    await route.fulfill({
      body: JSON.stringify({
        count: filteredClasses.length,
        next: offset + limit < filteredClasses.length ? offset + limit : null,
        previous: offset ? Math.max(offset - limit, 0) : null,
        results: filteredClasses.slice(offset, offset + limit),
      }),
      contentType: 'application/json',
      status: 200,
    })
  })

  await openClasses(page)

  const classList = page.locator('.class-list')
  const classItems = classList.locator('.class-list__item')
  const pagination = classList.locator('.class-list__pagination')
  await expect(classItems).toHaveCount(10)
  await expect(pagination).toContainText('Showing 10 of 12 classes')
  expect(classRequests[0]).toMatchObject({ limit: 10, offset: 0, search: '' })

  await page.goto('/admin/classes?schedule=9012')
  await expect(classList.locator('.class-list__item.active')).toContainText('PCLS12')
  await expect(classItems).toHaveCount(11)

  const desktopScrollMetrics = await classList.evaluate((element) => {
    const finderPanel = element.closest<HTMLElement>('.classes-setup__panel--finder')
    const setupPanel = finderPanel?.parentElement?.querySelector<HTMLElement>(
      '.classes-setup__panel:not(.classes-setup__panel--finder)',
    )
    const scheduleForm = setupPanel?.querySelector<HTMLElement>('.class-form')
    if (!finderPanel || !setupPanel || !scheduleForm) throw new Error('Classes setup layout is missing.')

    const styles = window.getComputedStyle(element)
    const listRect = element.getBoundingClientRect()
    const scheduleFormRect = scheduleForm.getBoundingClientRect()
    return {
      clientHeight: element.clientHeight,
      finderPanelHeight: finderPanel.getBoundingClientRect().height,
      listBottom: listRect.bottom,
      overflowY: styles.overflowY,
      scheduleFormBottom: scheduleFormRect.bottom,
      scrollHeight: element.scrollHeight,
      setupPanelHeight: setupPanel.getBoundingClientRect().height,
    }
  })
  expect(desktopScrollMetrics.overflowY).toBe('auto')
  expect(desktopScrollMetrics.finderPanelHeight).toBeCloseTo(desktopScrollMetrics.setupPanelHeight, 0)
  expect(Math.abs(desktopScrollMetrics.listBottom - desktopScrollMetrics.scheduleFormBottom))
    .toBeLessThanOrEqual(1)
  expect(desktopScrollMetrics.scrollHeight).toBeGreaterThan(desktopScrollMetrics.clientHeight)

  await classList.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(pagination).toContainText('Showing 12 of 12 classes')
  await expect(classItems).toHaveCount(12)
  expect(Array.from(new Set(
    classRequests.filter((request) => request.search === '').map((request) => request.offset),
  ))).toEqual([0, 10])

  const classSearch = page.getByPlaceholder('Subject, section, day, room')
  await classSearch.fill('Paged Class 05')
  await expect(pagination).toContainText('Showing 1 of 1 class')
  await expect(classItems).toHaveCount(1)
  expect(classRequests.at(-1)).toMatchObject({ limit: 10, offset: 0, search: 'Paged Class 05' })

  failNextClassPage = true
  await classSearch.fill('PCLS')
  await expect(pagination).toContainText('Showing 11 of 12 classes')
  await classList.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(pagination.getByRole('button', { name: 'Retry loading more' })).toBeVisible()
  await pagination.getByRole('button', { name: 'Retry loading more' }).click()
  await expect(pagination).toContainText('Showing 12 of 12 classes')
  expect(classRequests.filter((request) => request.search === 'PCLS').map((request) => request.offset))
    .toEqual([0, 10, 10])

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileScrollMetrics = await classList.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: window.getComputedStyle(element).overflowY,
  }))
  expect(mobileScrollMetrics.overflowY).toBe('auto')
  expect(mobileScrollMetrics.clientHeight).toBeLessThanOrEqual(340)
})

test('creates, edits, clears, and deletes a class score sheet', async ({ page }) => {
  await openClasses(page)
  await selectClass(page, 'E2E101')

  const scoresButton = page.getByRole('button', { name: 'Scores', exact: true })
  await expect(scoresButton).toBeVisible()
  await scoresButton.click()
  const dialog = page.getByRole('dialog', { name: 'Class scores' })
  await expect(dialog.getByRole('tab', { name: 'Enter scores' })).toHaveAttribute('aria-selected', 'true')
  await dialog.getByLabel('Title').fill('Quiz 1')
  await dialog.getByLabel('Maximum score').fill('10')
  const scoreDate = await dialog.getByLabel('Date').inputValue()
  await dialog.getByRole('button', { name: 'Start scoring' }).click()

  await expect(dialog.getByRole('heading', { name: 'Rivera, Alex' })).toBeVisible()
  await expect(dialog).toContainText('1 of 2')
  const studentSearch = dialog.getByRole('combobox', { name: 'Find a student' })
  await studentSearch.fill('E2E-002')
  const jamieSearchResult = dialog.getByRole('option').filter({ hasText: 'Santos, Jamie' })
  await expect(jamieSearchResult).toContainText('Pending')
  await studentSearch.press('ArrowDown')
  await studentSearch.press('Enter')
  await expect(dialog.getByRole('heading', { name: 'Santos, Jamie' })).toBeVisible()
  await expect(dialog.getByLabel('Score for Santos, Jamie')).toBeFocused()
  await expect(studentSearch).toHaveValue('')

  await studentSearch.fill('a')
  await studentSearch.press('ArrowUp')
  await studentSearch.press('Enter')
  await expect(dialog.getByRole('heading', { name: 'Santos, Jamie' })).toBeVisible()

  await studentSearch.fill('Alex Rivera')
  const alexSearchResult = dialog.getByRole('option').filter({ hasText: 'Rivera, Alex' })
  await expect(alexSearchResult).toContainText('Pending')
  await alexSearchResult.click()
  await expect(dialog.getByRole('heading', { name: 'Rivera, Alex' })).toBeVisible()
  await expect(dialog.getByLabel('Score for Rivera, Alex')).toBeFocused()

  await studentSearch.fill('Santos')
  await studentSearch.press('Escape')
  await expect(studentSearch).toHaveValue('')
  await expect(dialog).toBeVisible()
  await studentSearch.fill('not-a-student')
  await expect(dialog).toContainText('No active students match')
  await dialog.getByRole('button', { name: 'Clear student search' }).click()
  await expect(studentSearch).toHaveValue('')

  let releaseFailedScore = () => undefined
  const failedScoreGate = new Promise<void>((resolve) => { releaseFailedScore = resolve })
  let failedScoreRequests = 0
  await page.route('**/api/grades/items/*/mark/', async route => {
    failedScoreRequests += 1
    await failedScoreGate
    await route.fulfill({
      body: JSON.stringify({ detail: 'Temporary score failure.' }),
      contentType: 'application/json',
      status: 500,
    })
  })
  await dialog.getByLabel('Score for Rivera, Alex').fill('8.5')
  await dialog.getByRole('button', { name: 'Record score' }).click()
  await expect(dialog.getByRole('heading', { name: 'Santos, Jamie' })).toBeVisible()
  await expect(dialog.getByLabel('Score for Santos, Jamie')).toBeEnabled()
  await dialog.getByLabel('Score for Santos, Jamie').fill('7')
  await dialog.getByRole('button', { name: 'Record score' }).click()
  await expect(dialog.getByText('Score sheet complete', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Saving 2 scores...')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Review scores' })).toBeDisabled()
  await expect(dialog.getByRole('tab', { name: 'Score sheets' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Close scores' })).toBeDisabled()
  await expect.poll(() => failedScoreRequests).toBe(1)
  releaseFailedScore()
  await expect(dialog).toContainText('Temporary score failure.')
  await expect(dialog.getByRole('heading', { name: 'Rivera, Alex' })).toBeVisible()
  await expect(dialog.getByLabel('Score for Rivera, Alex')).toHaveValue('')
  await expect(dialog.getByRole('group', { name: 'Current score totals' })).toContainText('0Saved')
  await page.unroute('**/api/grades/items/*/mark/')

  let releaseFirstScore = () => undefined
  const firstScoreGate = new Promise<void>((resolve) => { releaseFirstScore = resolve })
  const savedScoreValues: string[] = []
  await page.route('**/api/grades/items/*/mark/', async route => {
    const payload = route.request().postDataJSON() as { raw_score: string }
    savedScoreValues.push(payload.raw_score)
    if (savedScoreValues.length === 1) await firstScoreGate
    await route.continue()
  })
  await dialog.getByLabel('Score for Rivera, Alex').fill('8.5')
  await dialog.getByLabel('Score for Rivera, Alex').press('Enter')
  await expect(dialog.getByRole('heading', { name: 'Santos, Jamie' })).toBeVisible()
  await expect(dialog.getByLabel('Score for Santos, Jamie')).toBeFocused()
  await expect(dialog.getByText('Saving 1 score...')).toBeVisible()
  await dialog.getByLabel('Score for Santos, Jamie').fill('7')
  await dialog.getByRole('button', { name: 'Record score' }).click()
  await expect(dialog.getByText('Score sheet complete', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Saving 2 scores...')).toBeVisible()
  await expect.poll(() => savedScoreValues).toEqual(['8.5'])
  releaseFirstScore()
  await expect.poll(() => savedScoreValues).toEqual(['8.5', '7'])
  await expect(dialog.getByText(/Saving \d+ scores?\.\.\./)).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Review scores' })).toBeEnabled()
  await page.unroute('**/api/grades/items/*/mark/')
  await dialog.getByRole('button', { name: 'Undo last' }).click()
  await expect(dialog.getByRole('heading', { name: 'Santos, Jamie' })).toBeVisible()
  await expect(dialog.getByLabel('Score for Santos, Jamie')).toHaveValue('')
  await dialog.getByRole('button', { name: 'Close scores' }).click()
  await expect(dialog).toHaveCount(0)

  await scoresButton.click()
  const reopenedDialog = page.getByRole('dialog', { name: 'Class scores' })
  await reopenedDialog.getByRole('tab', { name: 'Score sheets' }).click()
  const scoreSheetSearch = reopenedDialog.getByLabel('Search score sheets')
  await scoreSheetSearch.fill('Quiz 1')
  await expect(reopenedDialog.getByRole('button', { name: /Quiz 1/ })).toBeVisible()
  await expect(reopenedDialog.getByText('1 of 1', { exact: true })).toBeVisible()
  await scoreSheetSearch.fill('Quizzes')
  await expect(reopenedDialog.getByRole('button', { name: /Quiz 1/ })).toBeVisible()
  await scoreSheetSearch.fill(scoreDate)
  await expect(reopenedDialog.getByRole('button', { name: /Quiz 1/ })).toBeVisible()
  await scoreSheetSearch.fill('missing sheet')
  await expect(reopenedDialog.getByText('No score sheets found', { exact: true })).toBeVisible()
  await expect(reopenedDialog.getByText('0 of 1', { exact: true })).toBeVisible()
  await reopenedDialog.getByRole('button', { name: 'Clear search' }).click()
  await expect(scoreSheetSearch).toHaveValue('')
  await reopenedDialog.getByRole('button', { name: /Quiz 1/ }).click()
  await expect(reopenedDialog.getByRole('heading', { name: 'Santos, Jamie' })).toBeVisible()
  await expect(reopenedDialog).toContainText('Continuing at the first pending student')
  await reopenedDialog.getByRole('button', { name: 'Excused' }).click()
  await reopenedDialog.getByRole('button', { name: 'Confirm excused' }).click()
  await expect(reopenedDialog).toContainText('Enter an excuse reason')
  await reopenedDialog.getByLabel('Excuse reason').fill('Approved absence')
  await reopenedDialog.getByRole('button', { name: 'Confirm excused' }).click()
  await expect(reopenedDialog.getByText('Score sheet complete', { exact: true })).toBeVisible()
  await expect(reopenedDialog.getByRole('group', { name: 'Score totals' })).toContainText('1Excused')
  await reopenedDialog.getByRole('button', { name: 'Undo last' }).click()
  await expect(reopenedDialog.getByRole('heading', { name: 'Santos, Jamie' })).toBeVisible()
  await reopenedDialog.getByRole('button', { name: 'Skip as 0' }).click()
  await expect(reopenedDialog.getByText('Score sheet complete', { exact: true })).toBeVisible()
  await expect(reopenedDialog.getByRole('group', { name: 'Score totals' })).toContainText('1Zero')

  await reopenedDialog.getByRole('button', { name: 'Edit activity' }).click()
  await reopenedDialog.getByLabel('Edit activity title').fill('Quiz 1 revised')
  await reopenedDialog.getByLabel('Edit maximum score').fill('12')
  await reopenedDialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(reopenedDialog).toContainText('Activity details updated')
  await expect(reopenedDialog.getByText('Score sheet complete', { exact: true })).toBeVisible()

  await reopenedDialog.getByRole('button', { name: 'Review scores' }).click()
  await expect(reopenedDialog.getByRole('heading', { name: 'Rivera, Alex' })).toBeVisible()
  await expect(reopenedDialog.getByLabel('Score for Rivera, Alex')).toHaveValue('8.50')
  await expect(reopenedDialog).toContainText('12 points')
  await reopenedDialog.getByLabel('Score for Rivera, Alex').fill('9')
  await reopenedDialog.getByRole('button', { name: 'Update score' }).click()
  await expect(reopenedDialog.getByText('Score sheet complete', { exact: true })).toBeVisible()
  await reopenedDialog.getByRole('button', { name: 'Review scores' }).click()
  await reopenedDialog.getByRole('button', { name: 'Clear score' }).click()
  const clearConfirmation = reopenedDialog.getByRole('alertdialog', { name: /Clear Rivera, Alex's saved result/ })
  await expect(clearConfirmation).toContainText('return to Pending')
  await clearConfirmation.getByRole('button', { name: 'Clear score' }).click()
  await expect(reopenedDialog.getByLabel('Score for Rivera, Alex')).toHaveValue('')
  await reopenedDialog.getByRole('button', { name: 'Undo last' }).click()
  await expect(reopenedDialog.getByLabel('Score for Rivera, Alex')).toHaveValue('9.00')
  await reopenedDialog.getByRole('button', { name: 'Next student' }).click()
  await expect(reopenedDialog.getByLabel('Score for Santos, Jamie')).toHaveValue('0.00')
  await reopenedDialog.getByRole('tab', { name: 'Score sheets' }).click()
  await reopenedDialog.getByRole('button', { name: /Quiz 1 revised/ }).click()
  await expect(reopenedDialog.getByLabel('Score for Rivera, Alex')).toHaveValue('9.00')
  await expect(reopenedDialog.getByRole('heading', { name: 'Rivera, Alex' })).toBeVisible()
  await reopenedDialog.getByRole('button', { name: 'Close scores' }).click()
  await expect(scoresButton).toBeFocused()

  await scoresButton.click()
  const mobileDialog = page.getByRole('dialog', { name: 'Class scores' })
  await page.setViewportSize({ width: 390, height: 844 })
  await mobileDialog.getByRole('tab', { name: 'Score sheets' }).click()
  await mobileDialog.getByRole('button', { name: /Quiz 1 revised/ }).click()
  await expect(mobileDialog.getByLabel('Score for Rivera, Alex')).toBeVisible()
  await expect(mobileDialog.locator('.score-runner-actions')).toBeVisible()
  const mobileScoreMetrics = await mobileDialog.locator('.attendance-modal__panel').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(mobileScoreMetrics.scrollWidth).toBeLessThanOrEqual(mobileScoreMetrics.clientWidth + 1)
  await mobileDialog.getByRole('button', { name: 'Close scores' }).click()

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Open Gradebook' }).click()
  await expect(page.getByRole('heading', { name: 'Gradebook' })).toBeVisible()
  await expect(page.getByText('Quiz 1 revised', { exact: true }).first()).toBeVisible()

  await page.goto('/admin/classes')
  await expect(page.getByRole('heading', { name: 'Classes' })).toBeVisible()
  await selectClass(page, 'E2E101')
  const deleteScoresButton = page.getByRole('button', { name: 'Scores', exact: true })
  await deleteScoresButton.click()
  const deleteDialog = page.getByRole('dialog', { name: 'Class scores' })
  await deleteDialog.getByRole('tab', { name: 'Score sheets' }).click()
  await deleteDialog.getByRole('button', { name: /Quiz 1 revised/ }).click()
  await deleteDialog.getByRole('button', { name: 'Delete sheet' }).click()
  const sheetConfirmation = deleteDialog.getByRole('alertdialog', { name: 'Permanently delete this score sheet?' })
  await expect(sheetConfirmation).toContainText('Quiz 1 revised and 2 saved student results')
  await sheetConfirmation.getByRole('button', { name: 'Delete permanently' }).click()
  await expect(deleteDialog).toContainText('Quiz 1 revised was permanently deleted')
  await expect(deleteDialog.getByRole('button', { name: /Quiz 1 revised/ })).toHaveCount(0)
})

test('creates adjacent and overlapping schedules', async ({ page }) => {
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
  await expect(page.locator('.class-form')).toContainText('Schedule saved.')
  await expect(page).toHaveURL(/schedule=\d+/)
})

test('fits compact mobile roster cards and paginates 51 students', async ({ page }) => {
  const students = Array.from({ length: 51 }, (_, index) => ({
    id: 5000 + index, student: 6000 + index, is_active: true,
    student_name: index === 0 ? 'Alexandria VeryLongUnbrokenFamilyNameForWrapping Rivera' : `Mobile Student ${index + 1}`,
    student_number: `MOBILE-${index + 1}`, email: index === 0 ? 'mobile@example.test' : '',
    grade_summary: {},
  }))
  await page.route(/\/subjects\/subject-schedules\/\d+\/roster\/.*/, async (route) => {
    const url = new URL(route.request().url())
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const limit = Number(url.searchParams.get('limit') ?? 10)
    const search = (url.searchParams.get('search') ?? '').toLowerCase()
    const inactive = url.searchParams.get('status') === 'inactive'
    const filtered = students.filter((student) => `${student.student_name} ${student.student_number}`.toLowerCase().includes(search))
    await route.fulfill({ json: {
      count: filtered.length, total_count: 52, active_count: 51, inactive_count: 1,
      next: offset + limit < filtered.length ? offset + limit : null, previous: offset || null,
      results: filtered.slice(offset, offset + limit).map((student) => ({ ...student,
        schedule: Number(url.pathname.match(/subject-schedules\/(\d+)/)?.[1]),
        is_active: !inactive, subject: 1, subject_code: 'E2E101',
      })),
    } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await openClasses(page)
  await selectClass(page, 'E2E101')
  const cards = page.locator('.roster-student-row')
  await expect(cards.first()).toContainText(students[0].student_name)
  for (const width of [320, 390, 640, 768, 900]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(cards.first().locator('.roster-cell--detail').first()).toBeHidden()
    const geometry = await cards.first().evaluate((row) => ({
      overflow: row.scrollWidth > row.clientWidth + 1,
      cells: [...row.children].map((cell) => [cell.className, cell.clientWidth, cell.scrollWidth]),
      nameClipped: row.querySelector('.roster-cell--name')!.scrollHeight > row.querySelector('.roster-cell--name')!.clientHeight + 1,
      nameSize: getComputedStyle(row.querySelector('.roster-cell--name')!).fontSize,
      buttonHeights: [...row.querySelectorAll('button')].map((button) => button.getBoundingClientRect().height),
    }))
    expect(geometry.overflow, JSON.stringify({ width, geometry })).toBe(false)
    expect(geometry.nameClipped).toBe(false)
    expect(geometry.nameSize).toBe('14px')
    expect(geometry.buttonHeights.every((height) => height >= 44)).toBe(true)
    for (const card of [cards.first(), cards.nth(4), cards.nth(await cards.count() - 1)]) {
      const more = card.getByRole('button', { name: /More actions/ })
      await more.click()
      const menu = page.getByRole('menu')
      await expect(menu).toBeVisible()
      expect(await menu.evaluate((element) => element.parentElement === document.body)).toBe(true)
      const bounds = await menu.boundingBox()
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
      for (const label of await menu.locator('span').all()) {
        expect(await label.evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          return range.getClientRects().length
        })).toBe(1)
      }
      await page.keyboard.press('Escape')
      await expect(more).toBeFocused()
      await expect(card.getByRole('button', { name: 'Grades', exact: true })).toHaveCSS('white-space', 'nowrap')
    }
  }
  await cards.first().getByRole('button', { name: /More actions/ }).click()
  await page.setViewportSize({ width: 640, height: 320 })
  await page.getByRole('menu').getByRole('menuitem').first().press('End')
  await expect(page.getByRole('menuitem', { name: 'Remove from roster' })).toBeInViewport()
  await page.mouse.wheel(0, 100)
  const shortBounds = await page.getByRole('menu').boundingBox()
  expect(shortBounds!.y).toBeGreaterThanOrEqual(0)
  expect(shortBounds!.y + shortBounds!.height).toBeLessThanOrEqual(320)
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await cards.first().getByRole('button', { name: 'Grades', exact: true }).click()
  const details = page.getByRole('dialog', { name: 'Grade details' })
  await expect(details).toContainText('Email: mobile@example.test')
  await expect(details).toContainText('Prelim')
  await details.getByRole('button', { name: 'Close', exact: true }).click()
  const pagination = page.locator('.class-roster-pagination')
  for (let batch = 0; batch < 6 && await cards.count() < 51; batch += 1) {
    await pagination.scrollIntoViewIfNeeded()
    const previousCount = await cards.count()
    const loadMore = pagination.getByRole('button', { name: 'Load more', exact: true })
    if (await loadMore.isVisible()) await loadMore.click()
    await expect.poll(() => cards.count()).toBeGreaterThan(previousCount)
  }
  await expect(cards).toHaveCount(51)
  await cards.last().getByRole('button', { name: /More actions/ }).click()
  await expect(page.getByRole('menuitem', { name: 'Remove from roster' })).toBeInViewport()
  await page.keyboard.press('Escape')
  await page.getByPlaceholder('Search roster by name or student number').fill('MOBILE-51')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText('Mobile Student 51')
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(cards.first().locator('.roster-cell--detail').first()).toBeVisible()
  await expect(page.locator('.class-roster-table')).toHaveCSS('display', 'table')
})

test('supports keyboard row actions and safe roster removal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
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

test('searches, selects, and reactivates students with the streamlined picker', async ({ page }, testInfo) => {
  const importedStudentNumber = `E2E-NEW-${String(testInfo.retry + 1).padStart(2, '0')}`
  const createdStudentNumber = `E2E-DIRECT-${String(testInfo.retry + 1).padStart(2, '0')}`
  const secondCreatedStudentNumber = `${createdStudentNumber}-B`
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' })
  await openClasses(page)
  await selectClass(page, 'E2E101')
  await page.getByRole('button', { name: 'Add students' }).click()

  const dialog = page.getByRole('dialog', { name: 'Add students' })
  const chooseTab = dialog.getByRole('tab', { name: 'Choose students' })
  const createTab = dialog.getByRole('tab', { name: 'Create new' })
  const importTab = dialog.getByRole('tab', { name: 'Import CSV' })
  await expect(chooseTab).toHaveAttribute('aria-selected', 'true')
  await chooseTab.focus()
  await chooseTab.press('ArrowRight')
  await expect(createTab).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByLabel('Student number')).toBeVisible()
  await createTab.press('ArrowRight')
  await expect(importTab).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByLabel('Student list CSV')).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download CSV template' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('student-roster-template.csv')
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  expect(await readFile(downloadPath!, 'utf8')).toBe('Student Number,Last Name,First Name,Middle Name\r\n')
  await createTab.click()

  const createStudentNumberInput = dialog.getByLabel('Student number')
  await expect(createStudentNumberInput).toBeFocused()
  await createStudentNumberInput.fill('invalid number')
  await dialog.getByLabel('First name').fill('Temporary')
  await dialog.getByLabel('Last name').fill('Entry')
  await dialog.getByRole('button', { name: 'Create and add student' }).click()
  await expect(dialog).toContainText('Student number may contain only')
  await expect(createStudentNumberInput).toHaveAttribute('aria-invalid', 'true')

  await createStudentNumberInput.fill('E2E-003')
  await dialog.getByRole('button', { name: 'Create and add student' }).click()
  const existingAccount = dialog.getByRole('region', { name: 'Existing student account' })
  await expect(existingAccount).toContainText('Morgan Lee')
  await expect(existingAccount).toContainText('Not enrolled')
  await existingAccount.getByRole('button', { name: 'Use existing student' }).click()
  await expect(chooseTab).toHaveAttribute('aria-selected', 'true')
  const selection = dialog.getByRole('region', { name: 'Selected students' })
  await expect(selection).toContainText('Morgan Lee')
  await selection.getByRole('button', { name: 'Remove Morgan Lee' }).click()

  await createTab.click()
  await createStudentNumberInput.fill(createdStudentNumber)
  await dialog.getByLabel('First name').fill('Direct')
  await dialog.getByLabel('Middle name').fill('De Leon')
  await dialog.getByLabel('Last name').fill('Student')
  await dialog.getByLabel('Email').fill('direct.student@example.com')
  let directCreateRequests = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/create-student/')) directCreateRequests += 1
  })
  await dialog.getByRole('button', { name: 'Create and add student' }).dblclick()
  const createSuccess = dialog.getByRole('status', { name: 'Student created' })
  await expect(createSuccess).toContainText('Direct D. Student')
  await expect(createSuccess).toContainText(createdStudentNumber)
  expect(directCreateRequests).toBe(1)
  await createSuccess.getByRole('button', { name: 'Copy credentials' }).click()
  await expect(createSuccess).toContainText('Credentials copied.')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(createdStudentNumber)
  await createSuccess.getByRole('button', { name: 'Add another' }).click()
  await expect(createStudentNumberInput).toBeFocused()
  await createStudentNumberInput.fill(secondCreatedStudentNumber)
  await dialog.getByLabel('First name').fill('Second')
  await dialog.getByLabel('Last name').fill('Student')
  await dialog.getByRole('button', { name: 'Create and add student' }).click()
  await expect(createSuccess).toContainText('Second Student')
  await createSuccess.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('row').filter({ hasText: 'Direct D. Student' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'Second Student' })).toBeVisible()

  const activeJamieRow = page.getByRole('row').filter({ hasText: 'Jamie Santos' })
  if (await activeJamieRow.count()) {
    await activeJamieRow.getByRole('button', { name: 'More actions for Jamie Santos' }).click()
    await page.getByRole('menuitem', { name: 'Remove from roster' }).click()
    await page.getByRole('dialog', { name: 'Remove this student?' }).getByRole('button', { name: 'Remove from active roster' }).click()
    await expect(activeJamieRow).toHaveCount(0)
  }

  await page.getByRole('button', { name: 'Add students' }).click()
  await expect(chooseTab).toHaveAttribute('aria-selected', 'true')

  const search = dialog.getByRole('combobox', { name: 'Find a student' })
  await expect(search).toBeFocused()
  await search.fill('Jamie')
  const jamieOption = dialog.getByRole('option').filter({ hasText: 'Jamie Santos' })
  await expect(jamieOption).toContainText('E2E-002')
  await expect(jamieOption).toContainText('Will reactivate')
  await search.press('ArrowDown')
  await search.press('Enter')

  await expect(selection).toContainText('Selected (1)')
  await expect(selection).toContainText('Jamie Santos')
  await search.fill('Morgan')
  await dialog.getByRole('option').filter({ hasText: 'Morgan Lee' }).click()
  await expect(selection).toContainText('Selected (2)')
  await selection.getByRole('button', { name: 'Remove Morgan Lee' }).click()
  await expect(selection).toContainText('Selected (1)')
  await search.fill('zz')
  await expect(selection).toContainText('Jamie Santos')
  await search.press('Escape')
  await expect(search).toHaveValue('')
  await expect(dialog).toBeVisible()

  await importTab.click()
  await expect(dialog.getByLabel('Student list CSV')).toBeVisible()
  await chooseTab.click()
  await expect(selection).toContainText('Jamie Santos')
  await selection.getByRole('button', { name: 'Clear all' }).click()
  await expect(selection).toContainText('Selected (0)')

  await search.fill('E2E-002')
  await expect(dialog.getByRole('option').filter({ hasText: 'Jamie Santos' })).toBeVisible()
  await search.press('Enter')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(selection.locator('li')).toBeVisible()
  await createTab.click()
  await expect(dialog.getByRole('button', { name: 'Create and add student' })).toBeVisible()
  const mobileDialogMetrics = await dialog.locator('.attendance-modal__panel').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(mobileDialogMetrics.scrollWidth).toBeLessThanOrEqual(mobileDialogMetrics.clientWidth + 1)
  await chooseTab.click()
  await expect(selection).toContainText('Jamie Santos')
  await dialog.getByRole('button', { name: 'Add 1' }).click()
  await expect(dialog).toContainText('0 added, 1 reactivated, 0 already active.')
  await dialog.getByTitle('Close').click()
  await expect(page.getByRole('row').filter({ hasText: 'Jamie Santos' })).toBeVisible()

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.locator('.class-list__item')
    .filter({ hasText: 'E2E102' })
    .filter({ hasText: 'E2E-B' })
    .click()
  await expect(page).toHaveURL(/\/admin\/classes\?schedule=\d+/)
  await page.getByRole('button', { name: 'Add students' }).click()
  const importDialog = page.getByRole('dialog', { name: 'Add students' })
  await importDialog.getByRole('tab', { name: 'Import CSV' }).click()
  const rosterFileInput = importDialog.getByLabel('Student list CSV')
  let rosterPreviewRequests = 0
  page.on('request', (request) => {
    if (
      request.method() === 'POST'
      && /\/api\/subjects\/subject-schedules\/\d+\/import-roster\/$/.test(new URL(request.url()).pathname)
      && request.postData()?.includes('"dry_run":true')
    ) {
      rosterPreviewRequests += 1
    }
  })

  await rosterFileInput.setInputFiles({
    name: 'windows-1252-student.csv',
    mimeType: 'text/csv',
    buffer: encodeWindows1252(`Student Number,Last Name,First Name,Middle Name\r\n${importedStudentNumber}-CP,student,Espa\u00f1ol,\r\n`),
  })
  await expect(importDialog.getByLabel('Roster import preview')).toContainText('Espa\u00f1ol Student')
  await expect(importDialog).toContainText('decoded using Windows-1252 compatibility mode')
  await expect(importDialog).not.toContainText('\uFFFD')

  const utf16Roster = `Student Number,Last Name,First Name,Middle Name\r\n${importedStudentNumber}-UTF16,student,Espa\u00f1ol,\r\n`
  await rosterFileInput.setInputFiles({
    name: 'utf-16-student.csv',
    mimeType: 'text/csv',
    buffer: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(utf16Roster, 'utf16le')]),
  })
  await expect(importDialog.getByLabel('Roster import preview')).toContainText('Espa\u00f1ol Student')
  await expect(importDialog).not.toContainText('decoded using Windows-1252 compatibility mode')

  const previewCountBeforeDamagedFile = rosterPreviewRequests
  await rosterFileInput.setInputFiles({
    name: 'damaged-student.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`Student Number,Last Name,First Name,Middle Name\r\n${importedStudentNumber}-BAD,student,Espa\ufffdol,\r\n`),
  })
  await expect(importDialog.getByRole('alert')).toContainText('Found 1 unknown replacement character')
  await expect(importDialog.getByLabel('Roster import preview')).toHaveCount(0)
  await expect(importDialog.getByRole('button', { name: /^Import \d+ students$/ })).toHaveCount(0)
  await expect.poll(() => rosterPreviewRequests).toBe(previewCountBeforeDamagedFile)

  await rosterFileInput.setInputFiles({
    name: 'new-student.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`\uFEFFStudent Number,Last Name,First Name,Middle Name,Email,Section\r\n${importedStudentNumber},young,robin   mae,ann-marie,ignored@example.com,Ignored\r\n`),
  })
  await expect(importDialog.getByLabel('Roster import preview')).toContainText('Create account')
  await expect(importDialog.getByLabel('Roster import preview')).toContainText('Robin Mae A. Young')
  const credentialsDownloadPromise = page.waitForEvent('download')
  await importDialog.getByRole('button', { name: 'Import 1 students' }).click()
  const credentialsDownload = await credentialsDownloadPromise
  expect(credentialsDownload.suggestedFilename()).toBe('new-student-credentials.csv')
  const credentialsPath = await credentialsDownload.path()
  expect(credentialsPath).not.toBeNull()
  const credentialsCsv = await readFile(credentialsPath!, 'utf8')
  const temporaryPassword = credentialsCsv.trim().split(/\r?\n/)[1].split(',')[1]
  expect(temporaryPassword).toBeTruthy()
  await expect(importDialog).toContainText('1 accounts created, 1 enrolled, 0 reactivated.')
  await expect(importDialog.getByRole('button', { name: 'Download credentials again' })).toBeVisible()
  await importDialog.getByTitle('Close').click()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'More navigation', exact: true }).click()
  await page.locator('.mobile-more[role="dialog"]').getByRole('button', { name: 'Sign out' }).click()
  await page.getByLabel('Student number').fill(importedStudentNumber)
  await page.getByLabel('Password', { exact: true }).fill(temporaryPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Create your password' })).toBeVisible()
  await page.getByLabel('New password', { exact: true }).fill('StudentSecurePass!482')
  await page.getByLabel('Confirm new password').fill('StudentSecurePass!482')
  await page.getByRole('button', { name: 'Set password and continue' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Welcome back, Robin Mae.' })).toBeVisible()
})

test('continues a roster import after the dialog closes and reconnects to progress', async ({ page }) => {
  const jobId = '00000000-0000-4000-8000-000000000051'
  let submitted = false
  let pollCount = 0
  const job = (status: 'PENDING' | 'RUNNING' | 'SUCCEEDED', progress: number) => ({
    id: jobId,
    job_type: 'IMPORT',
    owner: 1,
    status,
    attempts: status === 'PENDING' ? 0 : 1,
    progress,
    total: 2,
    result: status === 'SUCCEEDED' ? {
      schedule: 1,
      created_count: 2,
      created_student_numbers: ['BG-IMPORT-1', 'BG-IMPORT-2'],
      added_count: 2,
      reactivated_count: 0,
      already_active_count: 0,
    } : {},
    error: '',
    created_at: '2026-09-04T12:00:00Z',
    started_at: status === 'PENDING' ? null : '2026-09-04T12:00:01Z',
    finished_at: status === 'SUCCEEDED' ? '2026-09-04T12:00:03Z' : null,
  })

  await page.route('**/api/subjects/subject-schedules/*/roster-import-status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: submitted ? job('RUNNING', 1) : null }),
    })
  })
  await page.route('**/api/subjects/subject-schedules/*/import-roster/', async (route) => {
    const body = route.request().postDataJSON()
    const preview = {
      valid: true,
      row_count: 2,
      ready_count: 2,
      rows: [
        { row: 1, student_number: 'BG-IMPORT-1', student_name: 'Background One', status: 'create' },
        { row: 2, student_number: 'BG-IMPORT-2', student_name: 'Background Two', status: 'create' },
      ],
      create_count: 2,
      enroll_count: 0,
      reactivate_count: 0,
      already_active_count: 0,
    }
    if (body.dry_run) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(preview) })
      return
    }
    submitted = true
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ ...preview, job: job('PENDING', 0) }),
    })
  })
  await page.route(`**/api/jobs/${jobId}/`, async (route) => {
    pollCount += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(pollCount >= 2 ? job('SUCCEEDED', 2) : job('RUNNING', 1)),
    })
  })

  await openClasses(page)
  await selectClass(page, 'E2E101')
  await page.getByRole('button', { name: 'Add students' }).click()
  let dialog = page.getByRole('dialog', { name: 'Add students' })
  await dialog.getByRole('tab', { name: 'Import CSV' }).click()
  await dialog.getByLabel('Student list CSV').setInputFiles({
    name: 'background-roster.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Student Number,Last Name,First Name,Middle Name\r\nBG-IMPORT-1,One,Background,\r\nBG-IMPORT-2,Two,Background,\r\n',
    ),
  })
  await dialog.getByRole('button', { name: 'Import 2 students' }).click()
  await expect(dialog.getByRole('status')).toContainText(/Preparing [01] of 2 students/)
  await expect(dialog.getByRole('tab', { name: 'Choose students' })).toBeEnabled()
  await expect(dialog.getByTitle('Close')).toBeEnabled()
  await dialog.getByTitle('Close').click()
  await expect(dialog).toHaveCount(0)

  const credentialsDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Add students' }).click()
  dialog = page.getByRole('dialog', { name: 'Add students' })
  await dialog.getByRole('tab', { name: 'Import CSV' }).click()
  await expect(dialog.getByRole('status')).toContainText('Preparing 1 of 2 students')
  const credentialsDownload = await credentialsDownloadPromise
  expect(credentialsDownload.suggestedFilename()).toBe('new-student-credentials.csv')
  await expect(dialog).toContainText('2 accounts created, 2 enrolled, 0 reactivated.')
  await expect(dialog.getByRole('button', { name: 'Download credentials again' })).toBeVisible()
})

test('reports a failed background roster import without leaving the import blocked', async ({ page }) => {
  const jobId = '00000000-0000-4000-8000-000000000052'
  const preview = {
    valid: true,
    row_count: 1,
    ready_count: 1,
    rows: [{ row: 1, student_number: 'BG-FAIL-1', student_name: 'Failed Student', status: 'create' }],
    create_count: 1,
    enroll_count: 0,
    reactivate_count: 0,
    already_active_count: 0,
  }
  const baseJob = {
    id: jobId,
    job_type: 'IMPORT',
    owner: 1,
    attempts: 1,
    total: 1,
    created_at: '2026-09-04T12:00:00Z',
    started_at: '2026-09-04T12:00:01Z',
  }
  await page.route('**/api/subjects/subject-schedules/*/roster-import-status/', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: null }) }))
  await page.route('**/api/subjects/subject-schedules/*/import-roster/', async (route) => {
    if (route.request().postDataJSON().dry_run) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(preview) })
      return
    }
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        ...preview,
        job: { ...baseJob, status: 'PENDING', progress: 0, result: {}, error: '', finished_at: null },
      }),
    })
  })
  await page.route(`**/api/jobs/${jobId}/`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ...baseJob,
      status: 'FAILED',
      progress: 1,
      result: {
        preview: {
          ...preview,
          valid: false,
          ready_count: 0,
          rows: [{ row: 1, student_number: 'BG-FAIL-1', status: 'error', error: 'Conflict created during import.' }],
        },
      },
      error: 'The roster changed while the import was running. No students were imported.',
      finished_at: '2026-09-04T12:00:02Z',
    }),
  }))

  await openClasses(page)
  await selectClass(page, 'E2E101')
  await page.getByRole('button', { name: 'Add students' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add students' })
  await dialog.getByRole('tab', { name: 'Import CSV' }).click()
  await dialog.getByLabel('Student list CSV').setInputFiles({
    name: 'failed-background-roster.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Student Number,Last Name,First Name,Middle Name\r\nBG-FAIL-1,Student,Failed,\r\n'),
  })
  await dialog.getByRole('button', { name: 'Import 1 students' }).click()
  await expect(dialog).toContainText('No students were imported.')
  await expect(dialog.getByLabel('Roster import preview')).toContainText('Conflict created during import.')
  await expect(dialog.getByLabel('Student list CSV')).toBeEnabled()
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

test('creates subjects and manages terms without leaving Schedule Setup', async ({ page }, testInfo) => {
  const createdSubjectCode = `E2E${103 + testInfo.retry}`
  const createdSchoolYear = 2032 + testInfo.retry
  await openClasses(page)
  await startNewSchedule(page)

  const form = page.locator('.class-form')
  const subjectSelect = form.getByLabel('Subject', { exact: true })
  const termSelect = form.getByLabel('Term', { exact: true })
  const createSubjectButton = form.getByRole('button', { name: 'Create subject' })
  const manageTermsButton = form.getByRole('button', { name: 'Manage terms' })
  await expect(createSubjectButton).toBeVisible()
  await expect(manageTermsButton).toBeVisible()
  await form.getByLabel('Section').fill('UNSAVED-DRAFT')

  await createSubjectButton.click()
  let dialog = page.getByRole('dialog', { name: 'Create subject' })
  await expect(dialog.getByLabel('Code')).toBeFocused()
  const dialogPanel = dialog.locator('.academic-setup-dialog')
  await dialogPanel.getByRole('button', { name: 'Close Create subject' }).focus()
  await dialogPanel.getByRole('button', { name: 'Close Create subject' }).press('Shift+Tab')
  await expect(dialogPanel.getByRole('button', { name: 'Create subject', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(createSubjectButton).toBeFocused()

  await createSubjectButton.click()
  dialog = page.getByRole('dialog', { name: 'Create subject' })
  await dialog.getByLabel('Code').fill('E2E101')
  await dialog.getByLabel('Name').fill('Computer Networks')
  await dialog.getByLabel('Description').fill('Created from Schedule Setup.')
  const duplicateSubjectResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/subjects/subjects/'
  ))
  await dialog.getByRole('button', { name: 'Create subject', exact: true }).click()
  expect((await duplicateSubjectResponse).status()).toBe(400)
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByLabel('Code')).toHaveValue('E2E101')
  await expect(dialog.getByLabel('Name')).toHaveValue('Computer Networks')
  await dialog.getByLabel('Code').fill(createdSubjectCode)
  await dialog.getByRole('button', { name: 'Create subject', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(subjectSelect.locator('option:checked')).toHaveText(`${createdSubjectCode} Computer Networks`)
  await expect(form.getByLabel('Section')).toHaveValue('UNSAVED-DRAFT')
  await expect(createSubjectButton).toBeFocused()

  await manageTermsButton.click()
  dialog = page.getByRole('dialog', { name: 'Manage terms' })
  await expect(dialog.getByLabel('School year')).toBeFocused()
  await dialog.getByRole('button', { name: 'New school year' }).click()
  await dialog.getByLabel('Start year').fill(String(createdSchoolYear))
  await expect(dialog.getByLabel('End year')).toHaveValue(String(createdSchoolYear + 1))
  await dialog.getByRole('button', { name: 'Create school year' }).click()
  await expect(dialog).toContainText(`${createdSchoolYear}-${createdSchoolYear + 1} created and selected.`)
  await expect(dialog.getByLabel('School year')).toHaveValue(/\d+/)
  await dialog.getByLabel('Semester', { exact: true }).selectOption('SUMMER')
  await dialog.getByRole('button', { name: 'Create term' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(termSelect.locator('option:checked')).toHaveText(`Summer ${createdSchoolYear}-${createdSchoolYear + 1}`)
  await expect(form.getByLabel('Section')).toHaveValue('UNSAVED-DRAFT')
  await expect(manageTermsButton).toBeFocused()

  await manageTermsButton.click()
  dialog = page.getByRole('dialog', { name: 'Manage terms' })
  await dialog.getByRole('radio', { name: /1st Semester 2030-2031/ }).click()
  await expect(dialog).toContainText('1st Semester 2030-2031 is now the active default and is selected.')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(termSelect.locator('option:checked')).toHaveText('1st Semester 2030-2031')
  await expect(manageTermsButton).toBeFocused()

  await manageTermsButton.click()
  dialog = page.getByRole('dialog', { name: 'Manage terms' })
  await dialog.locator('.attendance-modal__backdrop').click({ position: { x: 5, y: 5 } })
  await expect(dialog).toHaveCount(0)
  await expect(manageTermsButton).toBeFocused()

  await page.goto('/admin/academic-setup')
  await expect(page).toHaveURL(/\/admin\/classes$/)
  await expect(page.getByRole('link', { name: 'Academic Setup' })).toHaveCount(0)
})
