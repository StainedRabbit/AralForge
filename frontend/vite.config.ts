import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function validateProductionApiBaseUrl(value: string | undefined) {
  const configuredUrl = value?.trim()
  if (!configuredUrl) {
    throw new Error('VITE_API_BASE_URL is required for production builds.')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(configuredUrl)
  } catch {
    throw new Error('VITE_API_BASE_URL must be an absolute HTTPS URL ending in /api.')
  }

  const normalizedPath = parsedUrl.pathname.replace(/\/+$/, '')
  if (
    parsedUrl.protocol !== 'https:'
    || LOOPBACK_HOSTNAMES.has(parsedUrl.hostname.toLowerCase())
    || normalizedPath !== '/api'
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.search
    || parsedUrl.hash
  ) {
    throw new Error(
      'VITE_API_BASE_URL must be a non-loopback HTTPS origin followed by /api.',
    )
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    validateProductionApiBaseUrl(env.VITE_API_BASE_URL)
  }

  return {
    plugins: [react()],
  }
})
