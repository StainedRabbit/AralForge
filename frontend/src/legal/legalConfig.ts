export type LegalConfig = {
  operatorName: string
  schoolName: string
  serviceAddress: string | null
  supportEmail: string | null
  privacyEmail: string | null
  effectiveDate: string
  retentionPolicy: string
}

export const STORAGE_NOTICE_VERSION = '2026-09-10'
export const STORAGE_NOTICE_KEY = 'aralforge.legal.storage-notice'
export const LEGAL_DOCUMENT_VERSION = '2026-09-10'

const safeDefaults: LegalConfig = {
  operatorName: 'AralForge',
  schoolName: 'Your participating school',
  serviceAddress: null,
  supportEmail: null,
  privacyEmail: null,
  effectiveDate: 'September 10, 2026',
  retentionPolicy: 'Records are retained only for the school-approved period needed for the educational purpose, legal obligations, dispute handling, and secure backup expiry.',
}

const configured: LegalConfig = {
  operatorName: readValue(import.meta.env.VITE_LEGAL_OPERATOR_NAME, safeDefaults.operatorName),
  schoolName: readValue(import.meta.env.VITE_LEGAL_SCHOOL_NAME, safeDefaults.schoolName),
  serviceAddress: readOptionalValue(import.meta.env.VITE_LEGAL_SERVICE_ADDRESS),
  supportEmail: readOptionalValue(import.meta.env.VITE_LEGAL_SUPPORT_EMAIL),
  privacyEmail: readOptionalValue(import.meta.env.VITE_LEGAL_PRIVACY_EMAIL),
  effectiveDate: readValue(import.meta.env.VITE_LEGAL_EFFECTIVE_DATE, safeDefaults.effectiveDate),
  retentionPolicy: readValue(import.meta.env.VITE_LEGAL_RETENTION_POLICY, safeDefaults.retentionPolicy),
}

export const legalConfig = Object.freeze(configured)

function readValue(value: string | undefined, fallback: string) {
  const normalized = value?.trim()
  return normalized && !isPlaceholder(normalized) ? normalized : fallback
}

function readOptionalValue(value: string | undefined) {
  const normalized = value?.trim()
  return normalized && !isPlaceholder(normalized) ? normalized : null
}

function isPlaceholder(value: string) {
  return /example\.(?:com|invalid)|replace[-_ ]?me|to be confirmed|not for publication|your (?:name|school|address|email)/i.test(value)
}
