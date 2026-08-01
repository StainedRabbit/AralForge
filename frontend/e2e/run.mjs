import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const isWindows = process.platform === 'win32'
const python = process.env.PYTHON ?? 'python'
const servers = []

function start(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    detached: !isWindows,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.on('error', (error) => {
    child.spawnError = error
  })
  servers.push(child)
  return child
}

async function waitFor(url, child, timeout = 120_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (child.spawnError) throw child.spawnError
    if (child.exitCode !== null) {
      throw new Error(`Server exited before ${url} became ready.`)
    }
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`Timed out waiting for ${url}.`)
}

function stopTree(child) {
  if (!child.pid) return
  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // The server may already have stopped.
    }
  }
}

function runTests(args) {
  const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url))
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'test', ...args], {
      cwd: new URL('../', import.meta.url),
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? 1))
  })
}

let exitCode = 1
try {
  const backend = start(
    python,
    ['manage.py', 'run_e2e', '--settings=config.settings_e2e'],
    new URL('../../backend/', import.meta.url),
  )
  await waitFor('http://127.0.0.1:8001/api/subjects/subjects/', backend)

  const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
  const frontend = start(
    process.execPath,
    [vite, '--mode', 'e2e', '--host', '127.0.0.1', '--port', '4173'],
    new URL('../', import.meta.url),
  )
  await waitFor('http://127.0.0.1:4173', frontend)

  exitCode = await runTests(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
} finally {
  for (const server of servers.reverse()) stopTree(server)
}

process.exit(exitCode)
