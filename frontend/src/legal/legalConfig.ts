export type LegalConfig = {
  operatorName: string
  schoolName: string
  serviceAddress: string
  supportEmail: string
  privacyEmail: string
  effectiveDate: string
  retentionPolicy: string
}

export const STORAGE_NOTICE_VERSION = '2026-09-10'
export const STORAGE_NOTICE_KEY = 'aralforge.legal.storage-notice'
export const LEGAL_DOCUMENT_VERSION = '2026-09-10'

const developmentDefaults: LegalConfig = {
  operatorName: 'AralForge development operator',
  schoolName: 'Participating school (to be confirmed)',
  serviceAddress: 'Development environment — not for publication',
  supportEmail: 'support@example.invalid',
  privacyEmail: 'privacy@example.invalid',
  effectiveDate: 'September 10, 2026',
  retentionPolicy: 'Records are retained only for the school-approved period needed for the educational purpose, legal obligations, dispute handling, and secure backup expiry.',
}

const configured: LegalConfig = {
  operatorName: readValue('VITE_LEGAL_OPERATOR_NAME', import.meta.env.VITE_LEGAL_OPERATOR_NAME, developmentDefaults.operatorName),
  schoolName: readValue('VITE_LEGAL_SCHOOL_NAME', import.meta.env.VITE_LEGAL_SCHOOL_NAME, developmentDefaults.schoolName),
  serviceAddress: readValue('VITE_LEGAL_SERVICE_ADDRESS', import.meta.env.VITE_LEGAL_SERVICE_ADDRESS, developmentDefaults.serviceAddress),
  supportEmail: readValue('VITE_LEGAL_SUPPORT_EMAIL', import.meta.env.VITE_LEGAL_SUPPORT_EMAIL, developmentDefaults.supportEmail),
  privacyEmail: readValue('VITE_LEGAL_PRIVACY_EMAIL', import.meta.env.VITE_LEGAL_PRIVACY_EMAIL, developmentDefaults.privacyEmail),
  effectiveDate: readValue('VITE_LEGAL_EFFECTIVE_DATE', import.meta.env.VITE_LEGAL_EFFECTIVE_DATE, developmentDefaults.effectiveDate),
  retentionPolicy: readValue('VITE_LEGAL_RETENTION_POLICY', import.meta.env.VITE_LEGAL_RETENTION_POLICY, developmentDefaults.retentionPolicy),
}

export const legalConfig = Object.freeze(configured)

function readValue(name: string, value: string | undefined, developmentDefault: string) {
  const normalized = value?.trim()

  if (!normalized) {
    if (import.meta.env.PROD) {
      throw new Error(`${name} is required for a production legal configuration.`)
    }
    return developmentDefault
  }

  if (import.meta.env.PROD && isPlaceholder(normalized)) {
    throw new Error(`${name} must not contain a placeholder in production.`)
  }

  return normalized
}

function isPlaceholder(value: string) {
  return /example\.(?:com|invalid)|replace[-_ ]?me|to be confirmed|not for publication|your (?:name|school|address|email)/i.test(value)
}
