import { useState } from 'react'
import type { AuthedRequest } from '../app/types'
import { BrandMark } from '../components/navigation'
import { Icon } from '../components/Icon'
import type { LegalStatus } from '../types'
import { toErrorMessage } from '../utils/format'

const labels = {
  PRIVACY: 'Privacy Notice',
  TERMS: 'Terms of Use',
  ACCEPTABLE_USE: 'Acceptable Use and Academic Integrity Policy',
} as const

export function LegalAgreementGate({ api, status, onComplete, onLogout }: {
  api: AuthedRequest
  status: LegalStatus
  onComplete: () => Promise<unknown>
  onLogout: () => void
}) {
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const outstanding = status.documents.filter((document) => !document.accepted)
  const ready = outstanding.every((document) => confirmed[document.document])

  async function submit() {
    if (!ready || saving) return
    setSaving(true)
    setError('')
    try {
      for (const document of outstanding) {
        await api('/privacy/acknowledgments/', {
          method: 'POST',
          body: JSON.stringify({ document: document.document, version: document.version }),
        })
      }
      await onComplete()
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return <main className="legal-gate">
    <section className="legal-gate__card" aria-labelledby="legal-gate-title">
      <BrandMark compact />
      <div><p className="eyebrow">Before continuing</p><h1 id="legal-gate-title">Review AralForge’s current documents</h1>
        <p className="muted">Privacy acknowledgment confirms receipt of the notice; it is not blanket consent. Terms and acceptable-use rules require agreement.</p></div>
      <div className="legal-gate__documents">
        {outstanding.map((document) => <label key={document.document}>
          <input checked={Boolean(confirmed[document.document])} onChange={(event) => setConfirmed((current) => ({ ...current, [document.document]: event.target.checked }))} type="checkbox" />
          <span>I {document.action === 'AGREED' ? 'agree to' : 'acknowledge receiving'} the <a href={document.path} rel="noreferrer" target="_blank">{labels[document.document]}</a> (version {document.version}).</span>
        </label>)}
      </div>
      {error ? <div className="inline-alert" role="alert"><Icon name="warning" /><span>{error}</span></div> : null}
      <div className="legal-gate__actions"><button className="button button--secondary" onClick={onLogout} type="button">Sign out</button><button className="button button--primary" disabled={!ready || saving} onClick={() => void submit()} type="button"><Icon name="shield" /><span>{saving ? 'Recording…' : 'Agree and continue'}</span></button></div>
    </section>
  </main>
}
