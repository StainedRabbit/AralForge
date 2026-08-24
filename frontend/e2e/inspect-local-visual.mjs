import { mkdir, readFile } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from 'playwright'

const sessionPath = process.env.ARALFORGE_VISUAL_SESSION_FILE
if (!sessionPath) {
  throw new Error('ARALFORGE_VISUAL_SESSION_FILE is required.')
}

const sessions = JSON.parse(await readFile(sessionPath, 'utf8'))
const output = 'test-results/visual-refresh-local'
await mkdir(output, { recursive: true })

const browser = await chromium.launch({ headless: true })

async function inspect(label, path, session) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript((value) => {
    localStorage.setItem('aralforge.session', JSON.stringify(value))
  }, session)
  const page = await context.newPage()
  const consoleErrors = []
  const missingAssets = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('response', (response) => {
    if (response.status() === 404 && /\.(?:css|ico|js|png|svg|webp)$/i.test(response.url())) {
      missingAssets.push(response.url())
    }
  })

  await page.goto(`http://127.0.0.1:5173${path}`, { waitUntil: 'networkidle' })
  const metrics = await page.evaluate(() => ({
    hasHeading: Boolean(document.querySelector('h1')),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  await page.screenshot({ path: `${output}/${label}-desktop-1440x900.png` })
  console.log(JSON.stringify({
    label,
    ...metrics,
    consoleErrors: consoleErrors.length,
    missingAssets: missingAssets.length,
  }))
  await context.close()
}

try {
  await inspect('student-dashboard-real-data', '/', sessions.student)
  await inspect('admin-dashboard-real-data', '/admin', sessions.teacher)
} finally {
  await browser.close()
}
