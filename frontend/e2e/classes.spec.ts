import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

async function openClasses(page: Page) {
  await page.goto('/admin/classes')
  await page.getByLabel('Student number').fill('e2e-teacher')
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
  await page.route('**/api/attendance/sessions/*/mark/', async route => {
    await route.fulfill({
      body: JSON.stringify({ detail: 'Temporary mark failure.' }),
      contentType: 'application/json',
      status: 500,
    })
  }, { times: 1 })
  await attendanceDialog.getByRole('button', { name: 'Present', exact: true }).click()
  await expect(attendanceDialog).toContainText('Temporary mark failure.')
  await expect(attendanceDialog.getByRole('heading', { name: 'Rivera, Alex' })).toBeVisible()
  await page.unroute('**/api/attendance/sessions/*/mark/')
  await attendanceDialog.getByRole('button', { name: 'Present', exact: true }).click()
  const secondStudentName = attendanceDialog.getByRole('heading', { name: 'Santos, Jamie' })
  await expect(secondStudentName).toBeVisible()
  await expect(secondStudentName).toBeFocused()
  await attendanceDialog.getByRole('button', { name: 'Undo last' }).click()
  await expect(attendanceDialog.getByRole('heading', { name: 'Rivera, Alex' })).toBeVisible()
  await page.keyboard.press('1')
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
})

test('loads the roster ten students at a time and exports the complete filtered list', async ({ page }) => {
  const rosterRequests: Array<{ limit: number; offset: number; search: string; status: string }> = []
  const students = Array.from({ length: 12 }, (_, index) => ({
    email: `paged-${index + 1}@example.test`,
    grade_summary: {},
    student_name: `Paged Student ${String(index + 1).padStart(2, '0')}`,
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
  expect(rosterRequests.filter((request) => request.limit === 10).map((request) => request.offset)).toEqual([0, 10])

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

  await page.route(/\/subjects\/subject-schedules\/\?.*/, async (route) => {
    const url = new URL(route.request().url())
    const limit = Number(url.searchParams.get('limit') ?? 50)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const search = url.searchParams.get('search') ?? ''
    const term = url.searchParams.get('term') ?? ''
    const termId = Number(term || 1)
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
      school_year_semester: termId,
      section: `Batch ${String(index + 1).padStart(2, '0')}`,
      start_time: '09:00:00',
      subject: 1,
      subject_code: `PCLS${String(index + 1).padStart(2, '0')}`,
      subject_name: `Paged Class ${String(index + 1).padStart(2, '0')}`,
      term_name: '1st Semester 2027-2028',
      updated_at: '2026-08-04T00:00:00Z',
      updated_by: null,
    }))
    const normalizedSearch = search.toLowerCase()
    const filteredClasses = classes.filter((schedule) =>
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

test('creates and reopens an attendance-style class score sheet', async ({ page }) => {
  await openClasses(page)
  await selectClass(page, 'E2E101')

  const scoresButton = page.getByRole('button', { name: 'Scores', exact: true })
  await expect(scoresButton).toBeVisible()
  await scoresButton.click()
  const dialog = page.getByRole('dialog', { name: 'Class scores' })
  await expect(dialog.getByRole('tab', { name: 'Enter scores' })).toHaveAttribute('aria-selected', 'true')
  await dialog.getByLabel('Title').fill('Quiz 1')
  await dialog.getByLabel('Maximum score').fill('10')
  await dialog.getByRole('button', { name: 'Start score sheet' }).click()

  await dialog.getByLabel('Score for Alex Rivera').fill('8.5')
  await expect(dialog.getByLabel('Score for Jamie Santos')).toHaveValue('')
  await expect(dialog).toContainText('2 Completed')
  await expect(dialog).toContainText('1 Zero on save')
  await expect(dialog).toContainText('Blank scores will be recorded as zero')

  await dialog.getByRole('button', { name: 'Close scores' }).click()
  const discard = dialog.getByRole('alertdialog', { name: 'Discard unsaved scores?' })
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Keep editing' }).click()
  await dialog.getByRole('button', { name: 'Save scores' }).click()
  await expect(dialog.getByText(/Scores saved: 2 graded, 1 zero, 0 excused/)).toBeVisible()

  await dialog.getByRole('tab', { name: 'Score sheets' }).click()
  await dialog.getByRole('button', { name: /Quiz 1/ }).click()
  await expect(dialog.getByLabel('Score for Alex Rivera')).toHaveValue('8.50')
  await expect(dialog.getByLabel('Score for Jamie Santos')).toHaveValue('0.00')
  await dialog.getByRole('button', { name: 'Close scores' }).click()
  await expect(scoresButton).toBeFocused()

  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Open Gradebook' }).click()
  await expect(page.getByRole('heading', { name: 'Gradebook' })).toBeVisible()
  await expect(page.getByText('Quiz 1', { exact: true }).first()).toBeVisible()
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

test('searches, selects, and reactivates students with the streamlined picker', async ({ page }) => {
  await openClasses(page)
  await selectClass(page, 'E2E101')
  await page.getByRole('button', { name: 'Add students' }).click()

  const dialog = page.getByRole('dialog', { name: 'Add students' })
  const chooseTab = dialog.getByRole('tab', { name: 'Choose students' })
  const importTab = dialog.getByRole('tab', { name: 'Import CSV' })
  await expect(chooseTab).toHaveAttribute('aria-selected', 'true')
  await chooseTab.focus()
  await chooseTab.press('ArrowRight')
  await expect(importTab).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByLabel('Student list CSV')).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download CSV template' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('student-roster-template.csv')
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  expect(await readFile(downloadPath!, 'utf8')).toBe('Student Number,Last Name,First Name,Middle Name\r\n')
  await chooseTab.click()

  const search = dialog.getByRole('combobox', { name: 'Find a student' })
  await expect(search).toBeFocused()
  await search.fill('Jamie')
  const jamieOption = dialog.getByRole('option').filter({ hasText: 'Jamie Santos' })
  await expect(jamieOption).toContainText('E2E-002')
  await expect(jamieOption).toContainText('Will reactivate')
  await search.press('ArrowDown')
  await search.press('Enter')

  const selection = dialog.getByRole('region', { name: 'Selected students' })
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
  await dialog.getByRole('button', { name: 'Add 1' }).click()
  await expect(dialog).toContainText('0 added, 1 reactivated, 0 already active.')
  await dialog.getByTitle('Close').click()
  await expect(page.getByRole('row').filter({ hasText: 'Jamie Santos' })).toBeVisible()

  await page.getByRole('button', { name: 'Add students' }).click()
  const importDialog = page.getByRole('dialog', { name: 'Add students' })
  await importDialog.getByRole('tab', { name: 'Import CSV' }).click()
  await importDialog.getByLabel('Student list CSV').setInputFiles({
    name: 'new-student.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from("\uFEFFStudent Number,Last Name,First Name,Middle Name,Email,Section\r\nE2E-NEW-01,young,robin   mae,ann-marie,ignored@example.com,Ignored\r\n"),
  })
  await expect(importDialog.getByLabel('Roster import preview')).toContainText('Create account')
  await expect(importDialog.getByLabel('Roster import preview')).toContainText('Robin Mae Ann-Marie Young')
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

  await page.getByTitle('Sign out').last().click()
  await page.getByLabel('Student number').fill('E2E-NEW-01')
  await page.getByLabel('Password').fill(temporaryPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Create your password' })).toBeVisible()
  await page.getByLabel('New password', { exact: true }).fill('StudentSecurePass!482')
  await page.getByLabel('Confirm new password').fill('StudentSecurePass!482')
  await page.getByRole('button', { name: 'Set password and continue' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Welcome back, Robin Mae Ann-Marie.' })).toBeVisible()
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

test('creates subjects and manages terms without leaving Schedule Setup', async ({ page }) => {
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
  await dialog.getByRole('button', { name: 'Create subject', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByLabel('Code')).toHaveValue('E2E101')
  await expect(dialog.getByLabel('Name')).toHaveValue('Computer Networks')
  await dialog.getByLabel('Code').fill('E2E103')
  await dialog.getByRole('button', { name: 'Create subject', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(subjectSelect.locator('option:checked')).toHaveText('E2E103 Computer Networks')
  await expect(form.getByLabel('Section')).toHaveValue('UNSAVED-DRAFT')
  await expect(createSubjectButton).toBeFocused()

  await manageTermsButton.click()
  dialog = page.getByRole('dialog', { name: 'Manage terms' })
  await expect(dialog.getByLabel('School year')).toBeFocused()
  await dialog.getByRole('button', { name: 'New school year' }).click()
  await dialog.getByLabel('Start year').fill('2032')
  await expect(dialog.getByLabel('End year')).toHaveValue('2033')
  await dialog.getByRole('button', { name: 'Create school year' }).click()
  await expect(dialog).toContainText('2032-2033 created and selected.')
  await expect(dialog.getByLabel('School year')).toHaveValue(/\d+/)
  await dialog.getByLabel('Semester', { exact: true }).selectOption('SUMMER')
  await dialog.getByRole('button', { name: 'Create term' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(termSelect.locator('option:checked')).toHaveText('Summer 2032-2033')
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
