import { readFile, readdir, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const assets = fileURLToPath(new URL('../dist/assets/', import.meta.url))
const html = await readFile(`${dist}/index.html`, 'utf8')
const entryMatch = html.match(/<script[^>]+src="\/assets\/(index-[^"]+\.js)"/)

if (!entryMatch) {
  throw new Error('Could not find the production entry script in dist/index.html.')
}

const entry = await readFile(`${assets}/${entryMatch[1]}`)
const entryGzipBytes = gzipSync(entry).byteLength
const imageNames = (await readdir(assets)).filter((name) =>
  name.startsWith('aralforge-dashboard-journey-') ||
  name.startsWith('aralforge-login-illustration-'),
)
if (!imageNames.length) {
  throw new Error('Could not find the bundled AralForge visual assets.')
}
const imageSizes = await Promise.all(imageNames.map(async (name) => (await stat(`${assets}/${name}`)).size))
const largestHeroBytes = Math.max(0, ...imageSizes)

const budgets = [
  { actual: entryGzipBytes, label: 'entry JavaScript (gzip)', maximum: 100 * 1024 },
  { actual: largestHeroBytes, label: 'largest AralForge visual', maximum: 250 * 1024 },
]
const failures = budgets.filter(({ actual, maximum }) => actual > maximum)

for (const { actual, label, maximum } of budgets) {
  console.log(`${label}: ${(actual / 1024).toFixed(1)} KiB / ${(maximum / 1024).toFixed(0)} KiB`)
}

if (failures.length) {
  throw new Error(`Performance budget exceeded: ${failures.map(({ label }) => label).join(', ')}`)
}
