import { expect, test, type Page } from '@playwright/test'

async function signInAndFindTarget(page: Page) {
  await page.goto('/modules')
  await page.getByLabel('Student number').fill('E2E-001')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/')

  const target = await page.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem('aralforge.session') ?? '{}') as { access?: string }
    const headers = { Authorization: `Bearer ${session.access}` }
    const modulesResponse = await fetch('http://127.0.0.1:8001/api/modules/modules/?limit=100', { headers })
    const modulesPayload = await modulesResponse.json()
    const module = modulesPayload.results.find(
      (candidate: { title: string }) => candidate.title === 'E2E Attempt Hydration Module',
    )
    const workspaceResponse = await fetch(
      `http://127.0.0.1:8001/api/modules/modules/${module.id}/workspace/?context=PERSONAL`,
      { headers },
    )
    const workspace = await workspaceResponse.json()
    return {
      attempt: workspace.activity_attempts[0],
      lesson: workspace.lessons[0].id,
      module: module.id,
      topic: workspace.topics[0].id,
    }
  })

  return target
}

test('module workspace uses attempt summaries and hydrates only the opened attempt once', async ({ page }) => {
  const target = await signInAndFindTarget(page)

  expect(target.attempt).not.toHaveProperty('question_snapshot')
  expect(target.attempt).not.toHaveProperty('draft_answers')

  const hydrationRequests: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (
      request.method() === 'GET' &&
      /^\/api\/modules\/activity-attempts\/\d+\/$/.test(url.pathname)
    ) {
      hydrationRequests.push(url.pathname)
    }
  })

  await page.goto(`/modules/${target.module}?topic=${target.topic}&lesson=${target.lesson}&context=PERSONAL`)
  await expect(page.getByRole('heading', { name: 'Saved Attempt Hydration' })).toBeVisible()
  await expect(page.getByText('What is loaded only for this attempt?')).toBeVisible()
  await expect(page.getByLabel('Answer for Question 1')).toHaveValue('The saved draft')
  expect(hydrationRequests).toHaveLength(1)
})

test('failed final draft save blocks submission and preserves answers for retry', async ({ page }) => {
  const target = await signInAndFindTarget(page)
  let blockDraftSave = true
  let submitRequests = 0
  await page.route('**/api/modules/activity-attempts/*/draft/**', async route => {
    if (blockDraftSave) {
      await route.fulfill({
        body: JSON.stringify({ detail: 'Temporary draft failure' }),
        contentType: 'application/json',
        status: 503,
      })
      return
    }
    await route.continue()
  })
  page.on('request', request => {
    if (
      request.method() === 'POST' &&
      /\/api\/modules\/activity-attempts\/\d+\/submit\//.test(new URL(request.url()).pathname)
    ) {
      submitRequests += 1
    }
  })

  await page.goto(`/modules/${target.module}?topic=${target.topic}&lesson=${target.lesson}&context=PERSONAL`)
  const answer = page.getByLabel('Answer for Question 1')
  await expect(answer).toHaveValue('The saved draft')
  await answer.fill('Latest answer survives retry')
  await page.getByRole('button', { name: 'Review and submit' }).click()
  await page.getByRole('button', { name: 'Confirm submission' }).click()

  await expect(page.getByRole('alert')).toContainText('Nothing was submitted')
  expect(submitRequests).toBe(0)
  await expect(answer).toHaveValue('Latest answer survives retry')

  blockDraftSave = false
  await page.getByRole('button', { name: 'Retry submission' }).click()

  await expect(page.getByText('Main Activity submitted.')).toBeVisible()
  expect(submitRequests).toBe(1)
  await expect(page.getByLabel('Answer for Question 1')).toHaveValue('Latest answer survives retry')
})

test('question navigator focuses questions and stays horizontal on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const target = await signInAndFindTarget(page)
  await page.goto(`/modules/${target.module}?topic=${target.topic}&lesson=${target.lesson}&context=PERSONAL`)

  const navigator = page.getByRole('navigation', { name: 'Main Activity questions' })
  await expect(navigator).toBeVisible()
  const questionButtons = navigator.getByRole('button')
  await expect(questionButtons).toHaveCount(2)
  await expect(questionButtons.nth(0)).toContainText('Answered')
  await expect(questionButtons.nth(1)).toContainText(/Open|Answered/)
  await questionButtons.nth(1).click()

  const secondQuestion = page.getByRole('heading', { name: 'Which question is still open?' }).locator('..')
  await expect(secondQuestion).toBeFocused()
  const layout = await navigator.evaluate((element) => {
    const buttons = [...element.querySelectorAll('button')]
    return {
      display: getComputedStyle(element).display,
      overflowX: getComputedStyle(element).overflowX,
      rows: new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size,
    }
  })
  expect(layout).toEqual({ display: 'flex', overflowX: 'auto', rows: 1 })
  await testInfo.attach('mobile-main-activity-navigator', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
})

test('unlocked attempt history hydrates the selected submitted attempt', async ({ page }) => {
  const target = await signInAndFindTarget(page)
  await page.goto(`/modules/${target.module}?topic=${target.topic}&lesson=${target.lesson}&context=PERSONAL`)

  const history = page.getByRole('region', { name: 'Current attempt history' })
  await expect(history.getByRole('button')).toHaveCount(2)
  await history.getByRole('button', { name: /Attempt 1/ }).click()

  await expect(page.getByText('Review Answers is unlocked.')).toBeVisible()
  await expect(page.getByLabel('Answer for Question 2')).toHaveValue('Question two')
  await expect(page.getByLabel('Answer for Question 2')).toBeDisabled()
})
