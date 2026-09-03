import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/admin')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/admin(?:\/)?$/)
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
}

async function findWorkflowLesson(page: Page) {
  return page.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem('aralforge.session') ?? '{}') as { access?: string }
    const headers = { Authorization: `Bearer ${session.access}` }
    const load = async (path: string) => {
      const rows = []
      let next: string | null = `http://127.0.0.1:8001/api${path}`
      while (next) {
        const response = await fetch(next, { headers })
        const payload = await response.json()
        if (Array.isArray(payload)) return payload
        rows.push(...payload.results)
        next = payload.next
      }
      return rows
    }
    const [modules, topics, lessons] = await Promise.all([
      load('/modules/modules/?limit=100'),
      load('/modules/topics/?limit=100'),
      load('/modules/lessons/?limit=100'),
    ])
    const module = modules.find(
      (candidate: { title: string }) => candidate.title === 'E2E Main Activity Workflow',
    )
    const topic = topics.find((candidate: { module: number }) => candidate.module === module?.id)
    const lesson = lessons.find(
      (candidate: { topic: number; title: string }) =>
        candidate.topic === topic?.id && candidate.title === 'Quiz Workflow Lesson',
    )
    return { lesson: lesson?.id, module: module?.id, topic: topic?.id }
  })
}

test('bulk links a Main Activity and records score-only paper submissions', async ({ page }, testInfo) => {
  await signIn(page)

  const target = await page.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem('aralforge.session') ?? '{}') as { access?: string }
    const headers = { Authorization: `Bearer ${session.access}` }
    const load = async (path: string) => {
      const rows = []
      let next: string | null = `http://127.0.0.1:8001/api${path}`
      while (next) {
        const response = await fetch(next, { headers })
        const payload = await response.json()
        if (Array.isArray(payload)) return payload
        rows.push(...payload.results)
        next = payload.next
      }
      return rows
    }
    const [modules, topics, lessons] = await Promise.all([
      load('/modules/modules/'),
      load('/modules/topics/'),
      load('/modules/lessons/'),
    ])
    const module = modules.find((candidate: { title: string }) => candidate.title === 'E2E Main Activity Workflow')
    const topic = topics.find((candidate: { module: number }) => candidate.module === module?.id)
    const lesson = lessons.find((candidate: { topic: number; title: string }) =>
      candidate.topic === topic?.id && candidate.title === 'Quiz Workflow Lesson')
    return { lesson: lesson?.id, module: module?.id, topic: topic?.id }
  })
  expect(target).toEqual({ lesson: expect.any(Number), module: expect.any(Number), topic: expect.any(Number) })
  const editorRequests: Array<{ method: string; path: string }> = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) {
      editorRequests.push({ method: request.method(), path: `${url.pathname}${url.search}` })
    }
  })
  await page.goto(`/admin/modules/${target.module}/topics/${target.topic}/lessons/${target.lesson}/edit`)
  const editor = page.locator('#lesson-editor-main-activity')
  await expect(editor.getByRole('heading', { name: 'Main Activity' })).toBeVisible()
  expect(editorRequests.filter(request => request.path.includes('/grading-workspace/'))).toHaveLength(0)
  expect(editorRequests.some(request => request.path === `/api/modules/lessons/${target.lesson}/main-activity-workspace/`)).toBe(true)
  const forbiddenInitialCollections = [
    '/api/modules/activities/',
    '/api/modules/activity-questions/',
    '/api/modules/activity-choices/',
    '/api/modules/activity-matching-pairs/',
    '/api/accounts/users/',
    '/api/subjects/subject-schedules/',
    '/api/subjects/schedule-students/',
    '/api/grades/categories/',
    '/api/grades/items/',
  ]
  for (const path of forbiddenInitialCollections) {
    expect(editorRequests.some(request =>
      request.method === 'GET' &&
      (request.path === path || request.path.startsWith(`${path}?`)),
    )).toBe(false)
  }
  await expect(editor.getByLabel('Points (from published questions)')).toBeDisabled()
  await expect(editor.getByLabel('Grading period')).toHaveValue('PRELIM')
  await expect(editor.getByLabel('Opens at')).toHaveCount(0)
  await expect(editor.getByLabel('Due at')).toHaveCount(0)
  const atomicSave = page.waitForResponse(
    (response) => response.url().includes('/api/modules/activities/atomic-save/') && response.request().method() === 'PUT',
  )
  await editor.getByLabel('Passing score').fill('8')
  await expect(editor.getByText('Unpublished changes', { exact: true })).toBeVisible()
  await editor.getByRole('button', { name: 'Publish changes' }).click()
  await atomicSave
  await expect(editor.getByText('Saved', { exact: true }).first()).toBeVisible()
  const workspaceGetsAfterSave = editorRequests.filter(
    request => request.method === 'GET' && request.path === `/api/modules/lessons/${target.lesson}/main-activity-workspace/`,
  )
  expect(workspaceGetsAfterSave).toHaveLength(1)
  const gradingWorkspace = page.waitForResponse(
    response => response.url().includes('/grading-workspace/') && response.request().method() === 'GET',
  )
  await editor.getByRole('button', { name: /^Grading/ }).click()
  await gradingWorkspace
  await expect(editor.getByRole('heading', { name: 'Count this Main Activity as a quiz' })).toBeVisible()
  await expect(editor.getByRole('heading', { name: 'Student extensions' })).toHaveCount(0)
  expect(editorRequests.filter(request => request.path.includes('/grading-workspace/'))).toHaveLength(1)

  const classRows = editor.locator('.activity-grading-row')
  await expect(classRows).toHaveCount(2)
  await editor.getByRole('button', { name: 'Select all' }).click()
  await expect(classRows.nth(0).getByRole('checkbox')).toBeChecked()
  await expect(classRows.nth(1).getByRole('checkbox')).toBeChecked()
  await editor.getByRole('button', { name: 'Apply selected assignments' }).click()
  await expect(editor.getByRole('status')).toContainText('Assignments applied: 2 linked')

  const gradebookLinks = editor.getByRole('link', { name: 'Open Gradebook' })
  await expect(gradebookLinks).toHaveCount(2)
  await testInfo.attach('bulk-main-activity-links', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
  await gradebookLinks.first().click()
  await expect(page).toHaveURL(/\/admin\/gradebook\?schedule=\d+&period=PRELIM&category=\d+&item=\d+&filter=PENDING/)
  await expect(page.getByRole('heading', { name: 'Gradebook' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Pending/ }).first()).toContainText('3')

  await page.getByRole('button', { name: 'Enter paper scores' }).click()
  await page.getByLabel('Paper score for Alex Rivera').fill('9.5')
  await page.getByRole('button', { name: 'Save paper scores' }).click()
  await expect(page.getByRole('status')).toContainText('1 new, 0 corrected')
  await expect(page.getByRole('button', { name: /Pending/ }).first()).toContainText('2')
  await testInfo.attach('inline-paper-score-entry', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
  await page.getByRole('button', { name: 'Close paper score entry' }).click()

  const paperButtons = page.getByRole('button', { exact: true, name: 'Enter paper score' })
  await expect(paperButtons).toHaveCount(2)
  await paperButtons.first().click()

  let dialog = page.getByRole('dialog', { name: 'Enter paper score' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Maximum score')
  await dialog.getByRole('spinbutton', { name: 'Paper score' }).fill('10')
  await expect(dialog).toContainText('100%')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alertdialog', { name: 'Discard unsaved paper score?' })).toBeVisible()
  await page.getByRole('button', { name: 'Keep editing' }).click()
  await dialog.getByRole('button', { name: 'Save paper score' }).click()

  dialog = page.getByRole('dialog', { name: 'Enter paper score' })
  await expect(dialog).toContainText('Next pending student')
  await expect(dialog).toContainText('10.00 / 10.00')
  await testInfo.attach('next-pending-paper-score', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
  await dialog.getByRole('spinbutton', { name: 'Paper score' }).fill('8')
  await page.keyboard.press('Control+s')

  await expect(dialog).toBeHidden()
  await expect(page.getByRole('status')).toContainText('Paper entry complete: no pending students remain')
  await expect(page).toHaveURL(/filter=PENDING/)

  await page.getByLabel('Submission summary').getByRole('button', { name: /Paper/ }).click()
  const editButtons = page.getByRole('button', { name: 'Edit paper score' })
  await expect(editButtons).toHaveCount(3)
  await page.locator('.gradebook-score-table tbody tr').filter({ hasText: 'Alex Rivera' }).getByRole('button', { name: 'Edit paper score' }).click()
  dialog = page.getByRole('dialog', { name: 'Correct paper score' })
  await expect(dialog.getByRole('spinbutton', { name: 'Paper score' })).toHaveValue('9.50')
  await dialog.getByRole('spinbutton', { name: 'Paper score' }).fill('9')
  await dialog.getByRole('button', { name: 'Update paper score' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('status')).toContainText('Paper score corrected')

  const scheduleId = Number(new URL(page.url()).searchParams.get('schedule'))
  const temporaryAccess = await page.evaluate(async (moduleId) => {
    const session = JSON.parse(localStorage.getItem('aralforge.session') ?? '{}') as { access?: string }
    const headers = {
      Authorization: `Bearer ${session.access}`,
      'Content-Type': 'application/json',
    }
    const usersResponse = await fetch('http://127.0.0.1:8001/api/accounts/users/?limit=100', { headers })
    const usersPayload = await usersResponse.json()
    const student = usersPayload.results.find(
      (candidate: { username: string }) => candidate.username === 'E2E-001',
    )
    const grantsResponse = await fetch('http://127.0.0.1:8001/api/modules/access/?limit=100', { headers })
    const grantsPayload = await grantsResponse.json()
    const existing = grantsPayload.results.find(
      (candidate: { module: number; student: number }) =>
        candidate.module === moduleId && candidate.student === student.id,
    )
    if (existing?.is_active) {
      return { cleanup: 'deactivate', id: existing.id, token: session.access }
    }
    if (existing) {
      await fetch(`http://127.0.0.1:8001/api/modules/access/${existing.id}/`, {
        body: JSON.stringify({ is_active: true }),
        headers,
        method: 'PATCH',
      })
      return { cleanup: 'deactivate', id: existing.id, token: session.access }
    }
    const accessResponse = await fetch('http://127.0.0.1:8001/api/modules/access/', {
      body: JSON.stringify({ module: moduleId, student: student.id, is_active: true }),
      headers,
      method: 'POST',
    })
    const access = await accessResponse.json()
    return { cleanup: 'delete', id: access.id, token: session.access }
  }, target.module)
  try {
    await page.evaluate(() => localStorage.clear())
    await page.goto('/modules')
    await page.getByLabel('Student number').fill('E2E-001')
    await page.getByLabel('Password', { exact: true }).fill('e2e-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL((url) => url.pathname === '/')
    await page.goto(
      `/modules/${target.module}?topic=${target.topic}&lesson=${target.lesson}&schedule=${scheduleId}`,
    )
    await expect(page.getByText('Paper submission final', { exact: true })).toBeVisible()
    await expect(page.getByText(
      'The checked-paper score is final for this activity. Individual paper answers were not stored online.',
    )).toBeVisible()
    await expect(page.getByRole('region', { name: 'Paper attempt review' })).toContainText(
      'Individual paper answers are not available online.',
    )
  } finally {
    await page.evaluate(async ({ cleanup, id, token }) => {
      if (cleanup === 'none') return
      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
      await fetch(`http://127.0.0.1:8001/api/modules/access/${id}/`, cleanup === 'delete'
        ? { headers, method: 'DELETE' }
        : { body: JSON.stringify({ is_active: false }), headers, method: 'PATCH' })
    }, temporaryAccess)
  }
})

test('published editor conflict preserves recovery actions', async ({ page }, testInfo) => {
  await signIn(page)
  const target = await findWorkflowLesson(page)
  expect(target).toEqual({
    lesson: expect.any(Number),
    module: expect.any(Number),
    topic: expect.any(Number),
  })
  await page.goto(`/admin/modules/${target.module}/topics/${target.topic}/lessons/${target.lesson}/edit`)
  const editor = page.locator('#lesson-editor-main-activity')
  await expect(editor.getByRole('heading', { name: 'Main Activity' })).toBeVisible()

  await page.route('**/api/modules/activities/atomic-save/', async route => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        body: JSON.stringify({
          detail: 'This Main Activity was changed in another editor.',
          current_revision: 999,
        }),
        contentType: 'application/json',
        status: 409,
      })
      return
    }
    await route.continue()
  })
  await editor.getByLabel('Passing score').fill('7.5')
  await expect(editor.getByText('Unpublished changes', { exact: true })).toBeVisible()
  await editor.getByRole('button', { name: 'Publish changes' }).click()

  await expect(editor.getByRole('alert')).toContainText('A newer server revision is available')
  await expect(editor.getByRole('button', { name: 'Download local draft' })).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Reload server version' })).toBeVisible()
  const download = page.waitForEvent('download')
  await editor.getByRole('button', { name: 'Download local draft' }).click()
  await download
  await testInfo.attach('published-main-activity-conflict', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
})
