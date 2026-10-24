import { expect, test, type Page } from '@playwright/test'

type ChoiceOrderTarget = {
  activity: number
  lesson: number
  module: number
  schedule: number
  topic: number
}

async function signInAsTeacher(page: Page) {
  await page.goto('/admin')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/admin(?:\/)?$/)
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
}

async function signOut(page: Page) {
  const signedOut = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/api/auth/logout/'),
  )
  await page.locator('button[title="Sign out"]:visible').click()
  const confirmation = page.locator('.logout-confirmation')
  await confirmation.getByRole('button', { name: 'Sign out', exact: true }).click()
  expect((await signedOut).status()).toBe(204)
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
}

async function signInAsStudent(page: Page) {
  await page.goto('/modules')
  await page.getByLabel('Student number').fill('E2E-001')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/')
}

async function findAndResetChoiceOrderTarget(page: Page): Promise<ChoiceOrderTarget> {
  return page.evaluate(async () => {
    const headers = { Authorization: `Bearer ${window.__ARALFORGE_E2E_ACCESS_TOKEN__}` }
    const loadRows = async (path: string) => {
      const rows: Array<Record<string, unknown>> = []
      let next: string | null = `http://127.0.0.1:8001/api${path}`
      while (next) {
        const response = await fetch(next, { headers })
        if (!response.ok) {
          const detail = await response.text()
          throw new Error(`Could not load ${path} (${response.status}): ${detail}`)
        }
        const payload = await response.json()
        if (Array.isArray(payload)) return payload
        rows.push(...payload.results)
        next = payload.next
      }
      return rows
    }
    const [modules, topics, lessons, activities, schedules, attempts] = await Promise.all([
      loadRows('/modules/modules/?limit=100'),
      loadRows('/modules/topics/?limit=100'),
      loadRows('/modules/lessons/?limit=100'),
      loadRows('/modules/activities/?limit=100'),
      loadRows('/subjects/subject-schedules/?limit=100&status=all'),
      loadRows('/modules/activity-attempts/?limit=100'),
    ])
    const module = modules.find((candidate) => candidate.title === 'E2E Quiz Workflow')
    if (!module || typeof module.id !== 'number' || typeof module.subject !== 'number') {
      throw new Error('Could not find the Main Activity choice-order fixture module.')
    }
    const topic = topics.find((candidate) => candidate.module === module.id)
    const lesson = lessons.find((candidate) => candidate.topic === topic?.id && candidate.title === 'Quiz Workflow Lesson')
    const activity = activities.find((candidate) => candidate.lesson === lesson?.id)
    const schedule = schedules.find((candidate) => candidate.subject === module.subject)
    if (
      typeof topic?.id !== 'number' ||
      typeof lesson?.id !== 'number' ||
      typeof activity?.id !== 'number' ||
      typeof schedule?.id !== 'number'
    ) {
      throw new Error('The Main Activity choice-order fixture is incomplete.')
    }

    for (const attempt of attempts.filter((candidate) => candidate.activity === activity.id)) {
      const deleted = await fetch(
        `http://127.0.0.1:8001/api/modules/activity-attempts/${attempt.id}/`,
        { headers, method: 'DELETE' },
      )
      if (!deleted.ok) throw new Error('Could not reset the choice-order attempt fixture.')
    }

    return {
      activity: activity.id,
      lesson: lesson.id,
      module: module.id,
      schedule: schedule.id,
      topic: topic.id,
    }
  })
}

test('a shuffled correct choice keeps its identity through autosave, reload, and grading', async ({ page }) => {
  await signInAsTeacher(page)
  const target = await findAndResetChoiceOrderTarget(page)
  await signOut(page)
  await signInAsStudent(page)

  let correctChoiceId = 0
  let questionId = 0
  let authoredOrder = -1
  await page.route('**/api/modules/activities/*/start-attempt/**', async (route) => {
    const response = await route.fetch()
    const payload = await response.json()
    const question = payload.attempt.question_snapshot.find(
      (item: { question_type: string }) => item.question_type === 'multiple_choice',
    )
    const correctChoice = question?.choices.find(
      (choice: { text: string }) => choice.text === 'Correct response',
    )
    if (!question || !correctChoice) {
      throw new Error('The started attempt did not contain the expected multiple-choice fixture.')
    }
    expect(question.choices.every((choice: Record<string, unknown>) => !('is_correct' in choice))).toBe(true)
    questionId = question.id
    correctChoiceId = correctChoice.id
    authoredOrder = correctChoice.order
    const displayOrder = [
      correctChoice,
      ...question.choices.filter((choice: { id: number }) => choice.id !== correctChoice.id),
    ]
    displayOrder.forEach((choice, index) => { choice.presentation_order = index })
    await route.fulfill({ response, json: payload })
  })

  await page.goto(
    `/modules/${target.module}?topic=${target.topic}&lesson=${target.lesson}&schedule=${target.schedule}`,
  )
  await page.getByRole('button', { name: 'Start Quiz' }).click()

  const choices = page.locator('#main-activity .choice-list .choice-option')
  await expect(choices).toHaveCount(2)
  await expect(choices.nth(0)).toContainText('Correct response')
  await expect(choices.nth(1)).toContainText('Incorrect response')
  expect(correctChoiceId).toBeGreaterThan(0)
  expect(questionId).toBeGreaterThan(0)
  expect(authoredOrder).toBe(1)

  const correctRadio = page.getByRole('radio', { name: 'Correct response', exact: true })
  const autosave = page.waitForRequest((request) =>
    request.method() === 'PATCH' && /\/activity-attempts\/\d+\/draft\//.test(request.url()),
  )
  await correctRadio.check()
  const savedRequest = await autosave
  const savedPayload = savedRequest.postDataJSON()
  expect(savedPayload.answers[String(questionId)].selected_choice).toBe(correctChoiceId)
  await expect(page.locator('.activity-draft-status')).toContainText('Answers saved')

  await page.reload()
  await expect(page.getByRole('radio', { name: 'Correct response', exact: true })).toBeChecked()
  await page.getByRole('button', { name: 'Review and submit' }).click()
  await page.getByRole('button', { name: 'Confirm submission' }).click()

  await expect(page.getByText('Quiz submitted.')).toBeVisible()
  await expect(page.getByText('Review Answers is unlocked.')).toBeVisible()
  const review = page.locator('#main-activity .answer-review')
  await expect(review.locator('p').nth(0)).toHaveText('Correct response')
  await expect(review.locator('p').nth(1)).toHaveText('Correct response')
  await expect(page.getByRole('region', { name: 'Current attempt history' })).toContainText('10/10')
})
