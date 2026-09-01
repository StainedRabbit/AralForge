import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import type { ModuleLesson, ModuleLessonProgress } from '../src/types'
import { getLessonResumeTarget } from '../src/utils/modules'

async function openModuleWorkspace(page: Page) {
  await page.goto('/admin/modules/new')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/admin(?:\/)?$/)

  await page.goto('/admin/modules/new')
  await expect(page.getByText('Printable PDF', { exact: true })).toHaveCount(0)
  await page.getByLabel('Title').fill('E2E Programming Module')
  await page.getByLabel('Subject').selectOption({ label: 'E2E101 - Programming Fundamentals' })
  await page.getByRole('button', { name: 'Save module' }).click()
  await page.waitForURL(/\/admin\/modules\?subject=\d+&module=\d+/)
}

async function openOutlineImporter(page: Page) {
  const importButton = page.getByRole('button', { name: 'Import Outline MD' })
  if (!(await importButton.isVisible())) {
    await page.locator('summary').filter({ hasText: 'Manage' }).click()
  }
  await importButton.click()
  const dialog = page.getByRole('dialog', { name: 'Import Module Outline Markdown' })
  await expect(dialog).toBeVisible()
  return dialog
}

function resumeLesson(
  id: number,
  order: number,
  isPublished = true,
) {
  return {
    id,
    is_published: isPublished,
    order,
    title: `Lesson ${id}`,
    topic: 1,
  } as ModuleLesson
}

function lessonProgress({
  completedAt = null,
  lastViewedAt,
  lesson,
  student = 1,
}: {
  completedAt?: string | null
  lastViewedAt: string
  lesson: number
  student?: number
}) {
  return {
    completed_at: completedAt,
    id: lesson * 10 + student,
    last_viewed_at: lastViewedAt,
    lesson,
    started_at: lastViewedAt,
    student,
  } satisfies ModuleLessonProgress
}

test('selects valid start, resume, continue, and review lesson targets', () => {
  const hiddenLesson = resumeLesson(99, 0, false)
  const firstLesson = resumeLesson(1, 1)
  const secondLesson = resumeLesson(2, 2)
  const lessons = [hiddenLesson, firstLesson, secondLesson]
  const options = { currentUserId: 1, isAccessible: true }

  expect(getLessonResumeTarget(lessons, [], options)).toMatchObject({
    lesson: { id: firstLesson.id },
    mode: 'start',
  })

  const resumed = getLessonResumeTarget(lessons, [
    lessonProgress({ lastViewedAt: '2030-01-01T08:00:00Z', lesson: firstLesson.id }),
    lessonProgress({ lastViewedAt: '2030-01-01T10:00:00Z', lesson: hiddenLesson.id }),
    lessonProgress({ lastViewedAt: '2030-01-01T11:00:00Z', lesson: secondLesson.id, student: 2 }),
  ], options)
  expect(resumed).toMatchObject({ lesson: { id: firstLesson.id }, mode: 'resume' })

  const continued = getLessonResumeTarget(lessons, [
    lessonProgress({
      completedAt: '2030-01-01T09:00:00Z',
      lastViewedAt: '2030-01-01T09:00:00Z',
      lesson: firstLesson.id,
    }),
  ], options)
  expect(continued).toMatchObject({ lesson: { id: secondLesson.id }, mode: 'continue' })

  const reviewed = getLessonResumeTarget(lessons, [
    lessonProgress({
      completedAt: '2030-01-01T09:00:00Z',
      lastViewedAt: '2030-01-01T09:00:00Z',
      lesson: firstLesson.id,
    }),
    lessonProgress({
      completedAt: '2030-01-01T10:00:00Z',
      lastViewedAt: '2030-01-01T10:00:00Z',
      lesson: secondLesson.id,
    }),
  ], options)
  expect(reviewed).toMatchObject({ lesson: { id: secondLesson.id }, mode: 'review' })
  expect(getLessonResumeTarget(lessons, [], { ...options, isAccessible: false })).toBeNull()
})

test('loads presentation using only the module-scoped workspace endpoint', async ({ page }) => {
  await page.goto('/admin')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/admin(?:\/)?$/)

  await page.getByRole('link', { name: 'Modules', exact: true }).click()
  await page.getByLabel('Subject').selectOption({ label: 'E2E102 - Database Systems' })
  const presentLink = page.getByRole('link', { name: 'Present', exact: true }).first()
  await expect(presentLink).toBeVisible()
  const presentHref = await presentLink.getAttribute('href')
  expect(presentHref).toBeTruthy()
  const presentUrl = new URL(presentHref!, 'http://127.0.0.1:4173')
  const moduleId = Number(presentUrl.pathname.match(/modules\/(\d+)\/present/)?.[1])
  const topicId = Number(presentUrl.searchParams.get('topic'))
  expect(moduleId).toBeGreaterThan(0)
  expect(topicId).toBeGreaterThan(0)

  await page.route(
    `**/api/modules/modules/${moduleId}/presentation-workspace/`,
    async (route) => route.fulfill({
      contentType: 'application/json',
      status: 200,
      body: JSON.stringify({
        module: { id: moduleId, subject: null, title: 'Scoped Presentation Module' },
        topics: [{
          id: topicId,
          module: moduleId,
          title: 'Scoped Presentation Topic',
          order: 1,
          overview: 'Scoped topic overview',
          competency_text: '',
          essential_question: '',
          enduring_understanding: '',
          performance_task: '',
          success_criteria: '',
        }],
        lessons: [{
          id: 2001,
          topic: topicId,
          title: 'Scoped Presentation Lesson',
          order: 1,
          learning_targets: 'Understand scoped API loading.',
          objectives: '',
          before_you_start: '',
          short_discussion: '',
          overview: '',
          lets_practice: '',
          challenge_task: '',
          is_published: true,
        }],
        lesson_examples: [{
          id: 3001,
          lesson: 2001,
          order: 1,
          title: 'Scoped API Example',
          image: 'http://127.0.0.1:8001/media/presentation-example.svg',
          alt_text: 'Scoped presentation diagram',
          body: 'This example came from the compact workspace.',
          common_mistake: '',
          is_published: true,
        }],
      }),
    }),
  )
  await page.route('**/media/presentation-example.svg', async (route) => {
    await route.fulfill({
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"></svg>',
      contentType: 'image/svg+xml',
      status: 200,
    })
  })

  await page.waitForLoadState('networkidle')
  const moduleApiPaths: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/modules/')) {
      moduleApiPaths.push(url.pathname)
    }
  })
  await presentLink.click()

  await expect(page.getByText('Scoped Presentation Module / Scoped Presentation Topic')).toBeVisible()
  await page.getByRole('button', { name: 'Topic Introduction' }).click()
  await page.getByRole('menuitem', { name: /Scoped Presentation Lesson/ }).click()
  await page.getByRole('button', { name: 'Open section list' }).click()
  await page.getByRole('button', { name: "Let's Look at Examples" }).click()
  await expect(page.getByRole('heading', { name: "Let's Look at Examples" })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Scoped API Example' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Scoped presentation diagram' })).toBeVisible()
  expect(moduleApiPaths.length).toBeGreaterThan(0)
  expect(new Set(moduleApiPaths)).toEqual(new Set([
    `/api/modules/modules/${moduleId}/presentation-workspace/`,
  ]))
})

test('downloads and imports topic outline Markdown variants', async ({ page }) => {
  await openModuleWorkspace(page)
  let dialog = await openOutlineImporter(page)

  let downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download Topics Only MD' }).click()
  let download = await downloadPromise
  expect(download.suggestedFilename()).toBe('module-topics-only-template.md')
  let downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  let markdown = await readFile(downloadPath!, 'utf8')
  expect(markdown).toContain('# E2E Programming Module')
  expect(markdown).toContain('## Topic 1: Input, Process, Output')
  expect(markdown).not.toContain('- Lesson 1:')

  downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download Topics + Lessons MD' }).click()
  download = await downloadPromise
  expect(download.suggestedFilename()).toBe('module-topics-and-lessons-template.md')
  downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  markdown = await readFile(downloadPath!, 'utf8')
  expect(markdown).toContain('# E2E Programming Module')
  expect(markdown).toContain('- Lesson 1: IPO Model')

  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'topics-only.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(`# module import preview

## Topic 1: foundations
Competency Code: E2E-FOUND-001
Unit: programming   fundamentals
Overview: foundational programming concepts.
`),
  })
  await expect(dialog).toContainText('Module import preview')
  await expect(dialog).toContainText('Foundations')
  await expect(dialog).toContainText('Programming fundamentals')
  await expect(dialog.locator('textarea')).toHaveValue(/Overview: foundational programming concepts\./)
  await expect(dialog).toContainText('New topics1')
  await expect(dialog).toContainText('Lessons to create0')
  await expect(dialog).toContainText('Warnings0')
  await expect(dialog).toContainText('Topic only')
  await dialog.getByRole('button', { name: 'Apply Outline' }).click()
  await expect(dialog).toContainText('1 topic created.')
  await dialog.getByRole('button', { name: 'Close' }).click()

  dialog = await openOutlineImporter(page)
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'topics-and-lessons.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(`# E2E Programming Module

## Topic 1: foundations
- Lesson 1: variables
- Lesson 1: variables

## Topic 2: Applications
This line should be ignored.
`),
  })
  await expect(dialog).toContainText('New topics1')
  await expect(dialog).toContainText('Existing topics1')
  await expect(dialog).toContainText('Lessons to create1')
  await expect(dialog).toContainText('Duplicate lessons skipped1')
  await expect(dialog).toContainText('Warnings2')
  await expect(dialog).toContainText('Applications')
  await expect(dialog).toContainText('Topic only')
  await expect(dialog).toContainText('Ignored line: This line should be ignored.')
  await dialog.getByRole('button', { name: 'Apply Outline' }).click()
  await expect(dialog).toContainText('1 topic created.')
  await expect(dialog).toContainText('1 existing topic matched.')
  await expect(dialog).toContainText('1 lesson created.')
  await expect(dialog).toContainText('1 duplicate lesson skipped.')
  await dialog.getByRole('button', { name: 'Close' }).click()

  const outlineButton = page.getByRole('button', { name: 'Module Outline' })
  if (!(await outlineButton.isVisible())) {
    await page.locator('summary').filter({ hasText: 'Manage' }).click()
  }
  await outlineButton.click()
  const outline = page.getByRole('dialog', { name: 'Module Outline' })
  await expect(outline).toContainText('Foundations')
  await expect(outline).toContainText('Draft | 1 lesson')
  await expect(outline).toContainText('Applications')
  await expect(outline).toContainText('Draft | 0 lessons')
  await expect(outline).toContainText('Variables')
  await outline.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('link', { name: 'Edit Lesson' }).click()
  await expect(page.getByRole('heading', { name: 'Edit Lesson' })).toBeVisible()
  const checklist = page.getByRole('complementary', { name: 'Lesson checklist' })
  await expect(checklist).toContainText('0 of 5 sections filled')
  for (const retainedSection of [
    "What We'll Learn",
    'Before We Start',
    "Let's Understand",
    "Let's Practice",
    'Challenge Task',
  ]) {
    await expect(page.getByRole('textbox', { name: retainedSection, exact: true })).toBeVisible()
  }
  for (const removedSection of [
    "Words We'll Use",
    'Now We Apply',
    'How Our Work Will Be Checked',
    "Let's Reflect",
    'How We Show Learning',
  ]) {
    await expect(page.getByRole('textbox', { name: removedSection, exact: true })).toHaveCount(0)
  }

  const lessonUrl = page.url()
  const lessonId = lessonUrl.match(/lessons\/(\d+)\/edit/)?.[1]
  expect(lessonId).toBeTruthy()
  await page.evaluate((id) => {
    localStorage.setItem(`ezoryx:lesson-draft:lesson:${id}`, JSON.stringify({
      savedAt: new Date().toISOString(),
      value: {
        key_terms: 'Stale legacy content',
        title: 'Stale recovered title',
      },
    }))
  }, lessonId)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Restore Draft' })).toHaveCount(0)
  await expect(page.getByLabel('Lesson Title')).toHaveValue('Variables')

  await page.getByRole('button', { name: 'Import Lesson MD' }).click()
  const lessonImport = page.getByRole('dialog', { name: 'Import Lesson Markdown' })
  downloadPromise = page.waitForEvent('download')
  await lessonImport.getByRole('button', { name: 'Download Example MD' }).click()
  download = await downloadPromise
  downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  markdown = await readFile(downloadPath!, 'utf8')
  for (const removedHeading of [
    "## Words We'll Use",
    '## Now We Apply',
    '## How Our Work Will Be Checked',
    "## Let's Reflect",
    '## How We Show Learning',
    'Mini-check:',
  ]) {
    expect(markdown).not.toContain(removedHeading)
  }

  await lessonImport.locator('label').filter({ hasText: 'Upload MD' }).locator('input').setInputFiles({
    name: 'legacy-lesson.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(`# Lesson: variables

## Words We'll Use
- Variable

## Now We Apply
Apply the lesson.

## How Our Work Will Be Checked
Use the rubric.

## Let's Reflect
Reflect on the lesson.

## How We Show Learning
Submit evidence.

## Lesson Examples

### Example: legacy example
Common mistake:
Avoid the wrong symbol.

Mini-check:
Which symbol should be used?

## Let's Practice
Complete the retained practice.
`),
  })
  await expect(lessonImport).toContainText(
    "Unsupported sections: Words We'll Use, Now We Apply, How Our Work Will Be Checked, Let's Reflect, How We Show Learning",
  )
  await expect(lessonImport).toContainText('Variables')
  await expect(lessonImport).toContainText('Legacy example')
  await expect(lessonImport).toContainText('Lesson example field: Mini-check')
  await lessonImport.getByRole('button', { name: 'Apply to Empty Fields' }).click()
  await expect(lessonImport).toContainText('Lesson import applied to the draft.')
  await lessonImport.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('textbox', { name: "Let's Practice", exact: true })).toHaveValue('Complete the retained practice.')
})

test('creates, selects, and reloads a lesson beyond the global first page', async ({ page }) => {
  await page.goto('/admin/modules')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/admin(?:\/)?$/)
  await page.goto('/admin/modules')

  await page.getByLabel('Subject').selectOption({ label: 'E2EL1 - Lesson Authoring' })
  const topicSelect = page.locator('label').filter({ hasText: /^Topic/ }).locator('select')
  await expect(topicSelect).toHaveValue(/\d+/)
  await page.getByRole('link', { name: 'New Lesson' }).click()
  await expect(page.getByRole('heading', { name: 'Create Lesson' })).toBeVisible()
  await expect(page.getByText('Printable PDF', { exact: true })).toHaveCount(0)
  await page.getByLabel('Lesson Title').fill('Persisted Scoped Lesson')
  await page.getByLabel('Order').fill('1')

  const createResponse = page.waitForResponse(
    response => response.url().includes('/api/modules/lessons/') &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Save lesson' }).click()
  await expect((await createResponse).status()).toBe(201)
  await page.waitForURL(/\/admin\/modules\?subject=\d+&topic=\d+&lesson=\d+/)
  await expect(page.getByRole('heading', { name: /Persisted Scoped Lesson/ })).toBeVisible()
  await expect(page.getByText('Topic PDF', { exact: true })).toBeVisible()
  await expect(page.getByText('Module PDF', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Lesson PDF', { exact: true })).toHaveCount(0)

  const savedUrl = page.url()
  await page.reload()
  await expect(page).toHaveURL(savedUrl)
  await expect(page.getByRole('heading', { name: /Persisted Scoped Lesson/ })).toBeVisible()

  await page.getByLabel('Subject').selectOption({ label: 'E2EO1 - Lesson Overflow Fixtures' })
  await expect(page.getByText('Overflow Lesson 105', { exact: true })).toBeVisible()
  await page.getByLabel('Subject').selectOption({ label: 'E2EL1 - Lesson Authoring' })
  await expect(page.getByRole('heading', { name: /Persisted Scoped Lesson/ })).toBeVisible()
  await expect(page.getByText('Overflow Lesson 105', { exact: true })).toHaveCount(0)
})

test('starts, resumes, continues, and reviews lessons from module pages', async ({ page }) => {
  const topicDownloadPaths: string[] = []
  await page.route(/\/api\/modules\/topics\/\d+\/download_pdf\/$/, async (route) => {
    topicDownloadPaths.push(new URL(route.request().url()).pathname)
    await route.fulfill({
      body: Buffer.from('%PDF-1.4 topic fixture'),
      contentType: 'application/pdf',
      status: 200,
    })
  })
  await page.goto('/modules')
  await page.getByLabel('Student number').fill('E2E-001')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await page.goto('/modules')

  await page.getByLabel('Subject').selectOption({ label: 'E2E102 - Database Systems' })
  await expect(page).toHaveURL(/subject=\d+/)
  const moduleLibraryUrl = page.url()
  await expect(page.getByRole('heading', { name: 'E2E Resume Learning Module' })).toBeVisible()

  let progressPromise = page.waitForResponse(
    (response) => response.url().includes('/api/modules/lesson-progress/') && response.request().method() === 'POST',
  )
  await page.getByRole('link', { name: /Start Lesson.*Resume Basics/ }).click()
  await progressPromise
  await expect(page.getByRole('heading', { name: 'Resume Basics' })).toBeVisible()
  await expect(page.getByText('In progress', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download Topic PDF' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download Module PDF' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Download Printable PDF' })).toHaveCount(0)
  const topicDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Topic PDF' }).click()
  expect((await topicDownload).suggestedFilename()).toBe(
    'e2e-resume-learning-module-resume-topic.pdf',
  )
  expect(topicDownloadPaths).toHaveLength(1)

  await page.getByRole('button', { name: 'Module Contents', exact: true }).first().click()
  await expect(page.getByRole('button', { name: /Resume Lesson.*Resume Basics/ })).toBeVisible()
  await page.getByRole('button', { name: 'View topic overview' }).click()
  await expect(page.getByRole('button', { name: 'Download Topic PDF' })).toBeVisible()
  await page.getByRole('button', { name: 'Module Contents', exact: true }).first().click()

  await page.goto(moduleLibraryUrl)
  await expect(page.getByRole('link', { name: /Resume Lesson.*Resume Basics/ })).toBeVisible()
  await page.getByRole('link', { name: /Resume Lesson.*Resume Basics/ }).click()

  let completionPromise = page.waitForResponse(
    (response) => response.url().includes('/api/modules/lesson-progress/') && response.request().method() === 'PATCH',
  )
  await page.getByRole('button', { name: 'Mark Complete', exact: true }).first().click()
  await completionPromise
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Module Contents', exact: true }).first().click()
  const continuePractice = page.getByRole('button', { name: /Continue Lesson.*Resume Practice/ })
  await expect(continuePractice).toBeVisible()
  progressPromise = page.waitForResponse(
    (response) => response.url().includes('/api/modules/lesson-progress/') && response.request().method() === 'POST',
  )
  await continuePractice.click()
  await progressPromise
  await expect(page.getByRole('heading', { name: 'Resume Practice' })).toBeVisible()
  await expect(page.getByText('In progress', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Resume Topic', exact: true }).click()
  await expect(page.getByRole('button', { name: /Resume Lesson.*Resume Practice/ })).toBeVisible()
  await page.getByRole('button', { name: /Resume Lesson.*Resume Practice/ }).click()

  completionPromise = page.waitForResponse(
    (response) => response.url().includes('/api/modules/lesson-progress/') && response.request().method() === 'PATCH',
  )
  await page.getByRole('button', { name: 'Mark Complete', exact: true }).first().click()
  await completionPromise
  await page.getByRole('button', { name: 'Module Contents', exact: true }).first().click()

  const continueReview = page.getByRole('button', { name: /Continue Lesson.*Resume Review/ })
  await expect(continueReview).toBeVisible()
  progressPromise = page.waitForResponse(
    (response) => response.url().includes('/api/modules/lesson-progress/') && response.request().method() === 'POST',
  )
  await continueReview.click()
  await progressPromise
  await expect(page.getByText('In progress', { exact: true }).first()).toBeVisible()

  completionPromise = page.waitForResponse(
    (response) => response.url().includes('/api/modules/lesson-progress/') && response.request().method() === 'PATCH',
  )
  await page.getByRole('button', { name: 'Mark Complete', exact: true }).first().click()
  await completionPromise
  await page.getByRole('button', { name: 'Module Contents', exact: true }).first().click()
  await expect(page.getByRole('button', { name: /Review Last Lesson.*Resume Review/ })).toBeVisible()

  await page.goto(moduleLibraryUrl)
  const reviewLink = page.getByRole('link', { name: /Review Last Lesson.*Resume Review/ })
  await expect(reviewLink).toBeVisible()
  await reviewLink.click()
  await expect(page.getByRole('heading', { name: 'Resume Review' })).toBeVisible()
})
