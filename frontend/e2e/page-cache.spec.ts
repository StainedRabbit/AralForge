import { expect, test, type Page } from '@playwright/test'

type CacheRecord = {
  ownerId: number
  savedAt: number
  state: {
    queries: Array<{ queryKey: unknown[]; state: { dataUpdatedAt: number } }>
  }
}

async function signIn(page: Page) {
  await page.goto('/admin/students')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/admin(?:\/)?$/)
  await page.goto('/admin/students')
  await expect(page.getByRole('heading', { name: 'Students', exact: true })).toBeVisible()
}

async function readCache(page: Page) {
  return page.evaluate(() => new Promise<CacheRecord | undefined>((resolve, reject) => {
    const opened = indexedDB.open('aralforge-page-cache', 1)
    opened.onerror = () => reject(opened.error)
    opened.onsuccess = () => {
      const database = opened.result
      const transaction = database.transaction('query-cache', 'readonly')
      const request = transaction.objectStore('query-cache').get('current-account')
      request.onsuccess = () => resolve(request.result as CacheRecord | undefined)
      request.onerror = () => reject(request.error)
      transaction.oncomplete = () => database.close()
    }
  }))
}

async function replaceCache(page: Page, update: (record: CacheRecord) => CacheRecord) {
  const record = await readCache(page)
  if (!record) throw new Error('The browser cache was not written.')
  const next = update(record)
  await page.evaluate((value) => new Promise<void>((resolve, reject) => {
    const opened = indexedDB.open('aralforge-page-cache', 1)
    opened.onerror = () => reject(opened.error)
    opened.onsuccess = () => {
      const database = opened.result
      const transaction = database.transaction('query-cache', 'readwrite')
      transaction.objectStore('query-cache').put(value, 'current-account')
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onerror = () => reject(transaction.error)
    }
  }), next)
}

test('one-hour page cache survives reload and browser reopen, expires, and is account scoped', async ({ browser, page }) => {
  await signIn(page)
  await expect.poll(async () => (await readCache(page))?.state.queries.some(
    (query) => query.queryKey[0] === 'student-directory',
  ) ?? false).toBe(true)

  let directoryRequests = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/accounts/students/' && request.method() === 'GET') {
      directoryRequests += 1
    }
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Students', exact: true })).toBeVisible()
  expect(directoryRequests).toBe(0)

  const browserState = await page.context().storageState({ indexedDB: true })
  await page.close()
  const reopenedContext = await browser.newContext({ storageState: browserState })
  try {
    const reopened = await reopenedContext.newPage()
    let reopenedRequests = 0
    reopened.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/accounts/students/' && request.method() === 'GET') {
        reopenedRequests += 1
      }
    })
    await reopened.goto('/admin/students')
    await expect(reopened.getByRole('heading', { name: 'Students', exact: true })).toBeVisible()
    expect(reopenedRequests).toBe(0)

    await reopened.goto('/admin/grades')
    await expect(reopened.locator('.app-shell')).toBeVisible()
    const storedKeys = (await readCache(reopened))?.state.queries.map((query) => query.queryKey) ?? []
    expect(storedKeys.some((key) => JSON.stringify(key).match(/grades|gradebook|scores|attempts|submissions/))).toBe(false)

    await reopened.goto('/admin/students')
    await expect(reopened.getByRole('heading', { name: 'Students', exact: true })).toBeVisible()
    await replaceCache(reopened, (record) => ({
      ...record,
      state: {
        ...record.state,
        queries: record.state.queries.map((query) => ({
          ...query,
          state: { ...query.state, dataUpdatedAt: Date.now() - 60 * 60 * 1000 - 1000 },
        })),
      },
    }))
    reopenedRequests = 0
    await reopened.reload()
    await expect(reopened.getByRole('heading', { name: 'Students', exact: true })).toBeVisible()
    expect(reopenedRequests).toBeGreaterThan(0)

    await expect.poll(async () => (await readCache(reopened))?.state.queries.some(
      (query) => query.queryKey[0] === 'student-directory',
    ) ?? false).toBe(true)
    await replaceCache(reopened, (record) => ({ ...record, ownerId: record.ownerId + 999 }))
    reopenedRequests = 0
    await reopened.reload()
    await expect(reopened.getByRole('heading', { name: 'Students', exact: true })).toBeVisible()
    expect(reopenedRequests).toBeGreaterThan(0)

    await reopened.getByRole('button', { name: 'Sign out' }).first().click()
    await reopened.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(reopened.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect.poll(async () => await readCache(reopened)).toBeUndefined()
  } finally {
    await reopenedContext.close()
  }
})

test('pages still load when IndexedDB is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined })
  })
  await signIn(page)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Students', exact: true })).toBeVisible()
})

test('a successful account edit invalidates a previously visited directory', async ({ page }) => {
  await signIn(page)
  await expect.poll(async () => (await readCache(page))?.state.queries.some(
    (query) => query.queryKey[0] === 'student-directory',
  ) ?? false).toBe(true)
  let directoryRequests = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/accounts/students/' && request.method() === 'GET') {
      directoryRequests += 1
    }
  })
  await page.locator('.appearance-control__details').first().locator('summary').click()
  const darkButton = page.locator('.appearance-control__details').first().getByRole('button', { name: 'Dark' })
  const lightButton = page.locator('.appearance-control__details').first().getByRole('button', { name: 'Light' })
  const nextButton = await darkButton.getAttribute('aria-pressed') === 'true' ? lightButton : darkButton
  const themeSave = page.waitForResponse((response) => response.url().includes('/api/accounts/users/me/theme/')
    && response.request().method() === 'PATCH' && response.ok())
  await nextButton.click()
  await themeSave
  await page.getByRole('link', { name: 'Overview', exact: true }).first().click()
  await page.getByRole('link', { name: 'Students', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Students', exact: true })).toBeVisible()
  expect(directoryRequests).toBeGreaterThan(0)
})
