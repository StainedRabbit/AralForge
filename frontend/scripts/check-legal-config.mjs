import process from 'node:process'
import { loadEnv } from 'vite'

const required = [
  'VITE_LEGAL_OPERATOR_NAME',
  'VITE_LEGAL_SCHOOL_NAME',
  'VITE_LEGAL_SERVICE_ADDRESS',
  'VITE_LEGAL_SUPPORT_EMAIL',
  'VITE_LEGAL_PRIVACY_EMAIL',
  'VITE_LEGAL_EFFECTIVE_DATE',
  'VITE_LEGAL_RETENTION_POLICY',
]

const env = { ...loadEnv('production', process.cwd(), ''), ...process.env }
const placeholder = /example\.(?:com|invalid)|replace[-_ ]?me|to be confirmed|not for publication|your (?:name|school|address|email)/i
const invalid = required.filter((name) => {
  const value = env[name]?.trim()
  return !value || placeholder.test(value)
})

if (invalid.length) {
  console.error(`Production legal configuration is missing or contains placeholders: ${invalid.join(', ')}`)
  process.exit(1)
}
