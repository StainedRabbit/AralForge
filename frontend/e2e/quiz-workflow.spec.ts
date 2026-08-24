import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/admin')
  await page.getByLabel('Username').fill('e2e-teacher')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/admin(?:\/)?$/)
  await expect(page.getByRole('heading', { name: /Teacher Console/ })).toBeVisible()
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
  await expect(editor.getByLabel('Opens at')).toBeVisible()
  await expect(editor.getByLabel('Due at')).toBeVisible()
  const atomicSave = page.waitForResponse(
    (response) => response.url().includes('/api/modules/activities/atomic-save/') && response.request().method() === 'PUT',
  )
  await editor.getByLabel('Passing score').fill('8')
  await expect(editor.getByText('Unsaved changes', { exact: true })).toBeVisible()
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
  await expect(editor.getByRole('heading', { name: 'Student extensions' })).toBeVisible()
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
  await editButtons.first().click()
  dialog = page.getByRole('dialog', { name: 'Correct paper score' })
  await expect(dialog.getByRole('spinbutton', { name: 'Paper score' })).toHaveValue('9.50')
  await dialog.getByRole('spinbutton', { name: 'Paper score' }).fill('9')
  await dialog.getByRole('button', { name: 'Update paper score' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('status')).toContainText('Paper score corrected')
})
