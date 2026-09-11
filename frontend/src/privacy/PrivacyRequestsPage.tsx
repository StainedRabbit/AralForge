import { useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AuthedRequest } from '../app/types'
import { Icon } from '../components/Icon'
import { EmptyState, Page, PageHeader, StatusBanner } from '../components/ui'
import type { ApiPage, PrivacyRequestRecord, User } from '../types'
import { formatDateTime, toErrorMessage } from '../utils/format'

const requestLabels = {
  ACCESS: 'Access my data', CORRECTION: 'Correct my data', PORTABILITY: 'Receive a portable copy',
  OBJECTION: 'Object to processing', ERASURE_BLOCKING: 'Erase or block data',
} as const

export function PrivacyRequestsPage({ api, currentUser }: { api: AuthedRequest; currentUser: User }) {
  const query = useQuery({
    queryKey: ['privacy', 'requests'],
    queryFn: ({ signal }) => api<ApiPage<PrivacyRequestRecord>>('/privacy/requests/', { signal }),
  })
  const [requestType, setRequestType] = useState<keyof typeof requestLabels>('ACCESS')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const isStudent = currentUser.role === 'STUDENT'

  async function createRequest(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    try {
      await api('/privacy/requests/', { method: 'POST', body: JSON.stringify({ request_type: requestType, details }) })
      setDetails(''); setMessage('Your request was submitted to the school privacy office.')
      await query.refetch()
    } catch (caughtError) { setError(toErrorMessage(caughtError)) } finally { setBusy(false) }
  }

  async function transition(record: PrivacyRequestRecord, status: 'IDENTITY_VERIFICATION' | 'IN_REVIEW' | 'APPROVED' | 'DENIED') {
    const publicMessage = window.prompt('Public message for the student:')
    if (publicMessage === null) return
    const internalNote = window.prompt('Internal DPO note (not shown to the student):') ?? ''
    setBusy(true); setError('')
    try {
      await api(`/privacy/requests/${record.id}/transition/`, { method: 'POST', body: JSON.stringify({ status, public_message: publicMessage, internal_note: internalNote }) })
      await query.refetch()
    } catch (caughtError) { setError(toErrorMessage(caughtError)) } finally { setBusy(false) }
  }

  async function execute(record: PrivacyRequestRecord) {
    const publicMessage = window.prompt('Completion message for the student:')
    if (!publicMessage) return
    setBusy(true); setError('')
    try {
      await api(`/privacy/requests/${record.id}/execute/`, { method: 'POST', body: JSON.stringify({ public_message: publicMessage }) })
      await query.refetch()
    } catch (caughtError) { setError(toErrorMessage(caughtError)) } finally { setBusy(false) }
  }

  const records = query.data?.results ?? []
  return <Page><PageHeader eyebrow="Data privacy" title={isStudent ? 'Privacy requests' : 'Privacy request queue'} description={isStudent ? 'Exercise your privacy rights through the school Data Protection Officer.' : 'Review and document student privacy requests without opening academic workspaces.'} />
    {isStudent ? <section className="section-block"><h2>Submit a request</h2><form className="form-stack" onSubmit={createRequest}>
      <label><span>Request type</span><select value={requestType} onChange={(event) => setRequestType(event.target.value as keyof typeof requestLabels)}>{Object.entries(requestLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Details</span><textarea minLength={10} maxLength={4000} required value={details} onChange={(event) => setDetails(event.target.value)} /></label>
      <p className="muted">Do not include passwords or personal information about another person. Submission does not guarantee erasure where the school must retain an official record.</p>
      <button className="button button--primary" disabled={busy} type="submit"><Icon name="shield" /><span>{busy ? 'Submitting…' : 'Submit to the school DPO'}</span></button>
    </form></section> : null}
    {message ? <StatusBanner tone="success" title="Request submitted" message={message} /> : null}
    {error ? <StatusBanner tone="warning" title="Request could not be updated" message={error} /> : null}
    <section className="section-block privacy-request-list"><h2>{isStudent ? 'Your requests' : 'All requests'}</h2>
      {query.isPending ? <p role="status">Loading privacy requests…</p> : records.length ? records.map((record) => <article key={record.id} className="privacy-request-card">
        <div><strong>{requestLabels[record.request_type]}</strong><span>{record.status.replaceAll('_', ' ')}</span></div>
        {!isStudent ? <p><strong>{record.subject_name}</strong> · {record.subject_number}</p> : null}<p>{record.details}</p>
        {record.public_response ? <p><strong>School response:</strong> {record.public_response}</p> : null}
        <small>Submitted {formatDateTime(record.submitted_at)}</small>
        <ol>{record.events.map((event) => <li key={event.id}><strong>{event.to_status || event.event}</strong>{event.public_message ? ` — ${event.public_message}` : ''}<small>{formatDateTime(event.created_at)}</small></li>)}</ol>
        {currentUser.role === 'PRIVACY_OFFICER' ? <div className="privacy-request-actions">
          {record.status === 'SUBMITTED' ? <><button className="button button--secondary" disabled={busy} onClick={() => void transition(record, 'IDENTITY_VERIFICATION')} type="button">Verify identity</button><button className="button button--secondary" disabled={busy} onClick={() => void transition(record, 'IN_REVIEW')} type="button">Start review</button></> : null}
          {record.status === 'IDENTITY_VERIFICATION' ? <button className="button button--secondary" disabled={busy} onClick={() => void transition(record, 'IN_REVIEW')} type="button">Identity verified</button> : null}
          {record.status === 'IN_REVIEW' ? <><button className="button button--primary" disabled={busy} onClick={() => void transition(record, 'APPROVED')} type="button">Approve</button><button className="button button--secondary" disabled={busy} onClick={() => void transition(record, 'DENIED')} type="button">Deny</button></> : null}
        </div> : currentUser.role === 'ADMIN' && record.status === 'APPROVED' ? <button className="button button--primary" disabled={busy} onClick={() => void execute(record)} type="button">Record execution</button> : null}
      </article>) : <EmptyState icon="shield" title="No privacy requests" message={isStudent ? 'Requests you submit will appear here.' : 'The school DPO queue is clear.'} />}
    </section>
  </Page>
}
