import type { AuthedRequest } from './types'
import type { User } from '../types'
import { BrandMark } from '../components/navigation'
import { PrivacyRequestsPage } from '../privacy/PrivacyRequestsPage'


export function PrivacyOfficerApp({ api, currentUser, onLogout }: {
  api: AuthedRequest
  currentUser: User
  onLogout: () => void
}) {
  return <div className="legal-site">
    <header className="legal-site__header"><BrandMark compact /><button className="button button--secondary" onClick={onLogout} type="button">Sign out</button></header>
    <main className="legal-document"><PrivacyRequestsPage api={api} currentUser={currentUser} /></main>
  </div>
}
