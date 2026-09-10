import { Link } from 'react-router-dom'
import { openStorageNotice } from './storageNotice'

const legalLinks = [
  ['/legal/privacy', 'Privacy'],
  ['/legal/terms', 'Terms'],
  ['/legal/storage', 'Storage'],
  ['/legal/acceptable-use', 'Acceptable use'],
  ['/legal/copyright', 'Copyright'],
  ['/legal/accessibility', 'Accessibility'],
] as const

export function LegalLinks({ compact = false }: { compact?: boolean }) {
  const links = compact ? legalLinks.slice(0, 3) : legalLinks

  return (
    <nav aria-label="Legal and privacy" className={`legal-links${compact ? ' legal-links--compact' : ''}`}>
      <Link to="/legal">Legal center</Link>
      {links.map(([to, label]) => <Link key={to} to={to}>{label}</Link>)}
      <button onClick={openStorageNotice} type="button">Storage notice</button>
    </nav>
  )
}
