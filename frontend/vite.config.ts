import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function validateProductionApiBaseUrl(value: string | undefined) {
  const configuredUrl = value?.trim()
  if (!configuredUrl) {
    throw new Error('VITE_API_BASE_URL is required for production builds.')
  }
  if (configuredUrl === '/api') return

  let parsedUrl: URL
  try {
    parsedUrl = new URL(configuredUrl)
  } catch {
    throw new Error('VITE_API_BASE_URL must be /api or an absolute HTTPS URL ending in /api.')
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
      'VITE_API_BASE_URL must be /api or a non-loopback HTTPS origin followed by /api.',
    )
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (command === 'build') {
    validateProductionApiBaseUrl(process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL)
  }

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: env.API_UPSTREAM_ORIGIN || 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
        '/media': {
          target: env.API_UPSTREAM_ORIGIN || 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
  }
})
