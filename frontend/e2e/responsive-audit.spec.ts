import { expect, test, type Page } from '@playwright/test'

const viewports = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 500 },
  { width: 768, height: 1024 },
  { width: 900, height: 700 },
  { width: 901, height: 700 },
  { width: 1024, height: 768 },
  { width: 1160, height: 800 },
  { width: 1161, height: 800 },
  { width: 1280, height: 800 },
  { width: 1281, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 844, height: 390 },
]

async function signIn(page: Page, username: string) {
  await page.goto('/')
  await page.getByLabel('Student number').fill(username)
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.app-shell')).toBeVisible()
  const notice = page.getByRole('button', { name: 'Got it' })
  if (await notice.isVisible()) await notice.click()
}

async function checkGeometry(page: Page, route: string, width: number) {
  const metrics = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('.app-main')
    const content = main?.querySelector<HTMLElement>('.page')
    const bar = document.querySelector<HTMLElement>('.mobile-tabbar')
    const fixedActions = Array.from(document.querySelectorAll<HTMLElement>(
      '.lesson-editor__actions, .mobile-sticky-actions',
    )).filter((element) => getComputedStyle(element).position === 'fixed')
    const mainRect = main?.getBoundingClientRect()
    const contentRect = content?.getBoundingClientRect()
    const barRect = bar?.getBoundingClientRect()
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainCenter: mainRect ? mainRect.left + mainRect.width / 2 : null,
      contentCenter: contentRect?.width ? contentRect.left + contentRect.width / 2 : null,
      fixedActionsClearBar: fixedActions.every((element) =>
        !barRect || element.getBoundingClientRect().bottom <= barRect.top + 1),
    }
  })
  const offenders = metrics.scrollWidth > metrics.clientWidth + 1
    ? await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .map((element) => ({
        name: `${element.tagName.toLowerCase()}.${Array.from(element.classList).join('.')}`,
        right: Math.round(element.getBoundingClientRect().right),
        scroll: element.scrollWidth,
        client: element.clientWidth,
      }))
      .filter((item) => item.right > document.documentElement.clientWidth + 1)
      .slice(0, 20))
    : []
  expect(metrics.scrollWidth, `${route} at ${width}px has document overflow: ${JSON.stringify(offenders)}`).toBeLessThanOrEqual(metrics.clientWidth + 1)
  if (metrics.mainCenter !== null && metrics.contentCenter !== null && width > 900) {
    expect(Math.abs(metrics.contentCenter - metrics.mainCenter), `${route} at ${width}px is off center`).toBeLessThanOrEqual(2)
  }
  expect(metrics.fixedActionsClearBar, `${route} at ${width}px has actions behind navigation`).toBe(true)
}

async function auditRoute(page: Page, route: string) {
  await page.goto(route)
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.locator('.app-main')).toBeVisible()
  await page.waitForLoadState('networkidle')
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await checkGeometry(page, route, viewport.width)
  }
}

async function moduleFixture(page: Page, title: string) {
  return page.evaluate(async (requestedTitle) => {
    const headers = { Authorization: `Bearer ${window.__ARALFORGE_E2E_ACCESS_TOKEN__}` }
    const response = await fetch('http://127.0.0.1:8001/api/modules/modules/?limit=100', { headers })
    const payload = await response.json() as { results: Array<{ id: number; title: string }> }
    const module = payload.results.find((item) => item.title === requestedTitle)
    if (!module) throw new Error(`Missing E2E module: ${requestedTitle}`)
    const workspaceResponse = await fetch(
      `http://127.0.0.1:8001/api/modules/modules/${module.id}/workspace/?context=PERSONAL`,
      { headers },
    )
    const workspace = await workspaceResponse.json() as {
      topics: Array<{ id: number }>
      lessons: Array<{ id: number }>
      activities: Array<{ id: number }>
    }
    if (!workspace.topics.length || !workspace.lessons.length) throw new Error(`Incomplete E2E module: ${requestedTitle}`)
    return { moduleId: module.id, topicId: workspace.topics[0].id,
      lessonId: workspace.lessons[0].id, activityId: workspace.activities[0]?.id ?? null }
  }, title)
}

async function checkHeader(page: Page, route: string) {
  await page.goto(route)
  await expect(page.locator('.page-header h1')).toBeVisible()
  for (const width of [320, 390, 768, 900, 901]) {
    await page.setViewportSize({ width, height: 844 })
    const header = page.locator('.page-header').first()
    await expect(header).toBeVisible()
    await expect.poll(() => header.evaluate((element) => getComputedStyle(element).flexDirection)).toBe(
      width <= 900 ? 'column' : 'row',
    )
    await expect.poll(() => header.evaluate((element) => Number.parseFloat(getComputedStyle(element, '::before').width))).toBeGreaterThan(0)
    const geometry = await header.evaluate((header) => {
      const box = header.getBoundingClientRect()
      const marker = getComputedStyle(header, '::before')
      const title = header.querySelector('h1')?.getBoundingClientRect()
      const description = header.querySelector('p:not(.eyebrow)')?.getBoundingClientRect()
      const action = header.querySelector('.page-header__actions')?.getBoundingClientRect()
      return {
        direction: getComputedStyle(header).flexDirection,
        markerLeft: Number.parseFloat(marker.left) || 0,
        markerWidth: Number.parseFloat(marker.width),
        titleOffset: title ? title.left - box.left : null,
        descriptionOffset: description ? description.left - box.left : null,
        actionOffset: action ? action.left - box.left : null,
      }
    })
    if (width <= 900) {
      const markerRight = geometry.markerLeft + geometry.markerWidth
      expect(markerRight, `${route} marker at ${width}px`).toBeLessThanOrEqual(6)
      expect(geometry.titleOffset, `${route} title at ${width}px`).toBeGreaterThanOrEqual(markerRight + 8)
      expect(geometry.titleOffset, `${route} title at ${width}px`).toBeLessThanOrEqual(markerRight + 30)
      if (geometry.descriptionOffset !== null) {
        expect(Math.abs(geometry.descriptionOffset - geometry.titleOffset!), `${route} description at ${width}px`).toBeLessThanOrEqual(1)
      }
      if (geometry.actionOffset !== null) {
        expect(Math.abs(geometry.actionOffset - geometry.titleOffset!), `${route} action at ${width}px`).toBeLessThanOrEqual(1)
      }
    } else {
      expect(geometry.direction, `${route} at ${width}px`).toBe('row')
    }
    await checkGeometry(page, route, width)
    if (route === '/admin/gradebook' && width === 901) {
      await page.screenshot({ path: 'test-results/responsive-audit/teacher-gradebook-901x844.png' })
    }
  }
}

test('public and student routes fit representative devices', async ({ page }) => {
  test.setTimeout(180_000)
  for (const route of [
    '/', '/legal', '/legal/privacy', '/legal/storage', '/legal/terms',
    '/legal/acceptable-use', '/legal/copyright', '/legal/accessibility',
  ]) {
    await page.goto(route)
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await checkGeometry(page, route, viewport.width)
    }
  }
  await signIn(page, 'E2E-001')
  for (const route of ['/', '/classes', '/modules', '/attendance', '/grades', '/profile']) {
    await auditRoute(page, route)
  }
  await checkHeader(page, '/modules')
  const module = await moduleFixture(page, 'E2E Attempt Hydration Module')
  await auditRoute(page, `/modules/${module.moduleId}?topic=${module.topicId}&lesson=${module.lessonId}&context=PERSONAL`)
  if (module.activityId) await auditRoute(page, `/activities/${module.activityId}?context=PERSONAL`)
})

test('teacher routes fit representative devices and headers align with their marker', async ({ page }) => {
  test.setTimeout(300_000)
  await signIn(page, 'e2e-teacher')
  for (const route of [
    '/admin', '/admin/students', '/admin/classes', '/admin/attendance',
    '/admin/modules', '/admin/grades', '/admin/gradebook',
  ]) {
    await auditRoute(page, route)
  }
  await checkHeader(page, '/admin/classes')
  await checkHeader(page, '/admin/gradebook')

  const module = await moduleFixture(page, 'E2E Resume Learning Module')
  const moduleEditor = `/admin/modules/${module.moduleId}/edit`
  for (const route of [
    '/admin/modules/new', moduleEditor,
    `/admin/modules/${module.moduleId}/topics/new`,
    `/admin/modules/${module.moduleId}/topics/${module.topicId}/edit`,
    `/admin/modules/${module.moduleId}/topics/${module.topicId}/lessons/new`,
    `/admin/modules/${module.moduleId}/topics/${module.topicId}/lessons/${module.lessonId}/edit`,
    `/admin/modules/${module.moduleId}/present?topic=${module.topicId}&lesson=${module.lessonId}`,
    `/admin/modules/${module.moduleId}/progress`,
  ]) {
    await auditRoute(page, route)
  }
  await checkHeader(page, moduleEditor)

  const quiz = await moduleFixture(page, 'E2E Quiz Workflow')
  const quizEditor = `/admin/modules/${quiz.moduleId}/topics/${quiz.topicId}/lessons/${quiz.lessonId}/edit`
  await page.goto(quizEditor)
  const activityEditor = page.locator('#lesson-editor-main-activity')
  await activityEditor.getByRole('button', { name: /^Grading/ }).click()
  await expect(activityEditor.getByRole('heading', { name: 'Count this Quiz in the gradebook' })).toBeVisible()
  const applyAssignments = activityEditor.getByRole('button', { name: 'Apply selected assignments' })
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await checkGeometry(page, `${quizEditor}#grading`, viewport.width)
    if (viewport.width === 901) {
      await page.screenshot({ path: 'test-results/responsive-audit/quiz-grading-901x700.png' })
    }
    await applyAssignments.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    const actionIsReachable = await applyAssignments.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return Boolean(hit && (hit === element || element.contains(hit)))
    })
    expect(actionIsReachable, `Quiz apply action is obscured at ${viewport.width}x${viewport.height}`).toBe(true)
  }

  await page.goto('/admin')
  const submissionReview = await page.getByRole('link', { name: 'Review' }).first().getAttribute('href')
  if (submissionReview) await auditRoute(page, submissionReview)
  else await auditRoute(page, '/admin/submissions/999')
})

test('class drawer and attendance and score dialogs fit phone, tablet, and short screens', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, 'e2e-teacher')
  await page.goto('/admin/classes')
  await expect(page.locator('.class-list__item').first()).toBeVisible()

  async function checkPanel(selector: string) {
    for (const viewport of [
      { width: 320, height: 640 }, { width: 390, height: 844 },
      { width: 430, height: 500 }, { width: 768, height: 1024 },
      { width: 900, height: 700 }, { width: 901, height: 700 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      const bounds = await page.locator(selector).evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
          width: window.innerWidth, height: window.innerHeight }
      })
      expect(bounds.left, `${selector} at ${viewport.width}px`).toBeGreaterThanOrEqual(-1)
      expect(bounds.right, `${selector} at ${viewport.width}px`).toBeLessThanOrEqual(bounds.width + 1)
      expect(bounds.top, `${selector} at ${viewport.width}px`).toBeGreaterThanOrEqual(-1)
      expect(bounds.bottom, `${selector} at ${viewport.width}px`).toBeLessThanOrEqual(bounds.height + 1)
      await checkGeometry(page, selector, viewport.width)
    }
  }

  await page.getByRole('button', { name: 'Add class' }).click()
  await expect(page.getByRole('dialog', { name: 'Add class' })).toBeVisible()
  await checkPanel('.class-schedule-drawer__panel')
  await page.getByRole('dialog', { name: 'Add class' }).getByRole('button', { name: 'Close schedule panel' }).last().click()

  await page.locator('.class-list__item').filter({ hasText: 'E2E101' }).click()
  await page.getByRole('button', { name: 'Attendance', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Class attendance' })).toBeVisible()
  await checkPanel('.class-attendance-dialog')
  await page.getByRole('dialog', { name: 'Class attendance' }).getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByRole('button', { name: 'Scores', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Class scores' })).toBeVisible()
  await checkPanel('.class-score-dialog')
})
