import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { STORAGE_NOTICE_KEY, STORAGE_NOTICE_VERSION } from './legalConfig'
import { OPEN_STORAGE_NOTICE_EVENT } from './storageNotice'

export function EssentialStorageNotice() {
  const [open, setOpen] = useState(() => readAcknowledgedVersion() !== STORAGE_NOTICE_VERSION)
  const acknowledgeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const reopen = () => setOpen(true)
    window.addEventListener(OPEN_STORAGE_NOTICE_EVENT, reopen)
    return () => window.removeEventListener(OPEN_STORAGE_NOTICE_EVENT, reopen)
  }, [])

  useEffect(() => {
    if (open) window.requestAnimationFrame(() => acknowledgeRef.current?.focus())
  }, [open])

  function acknowledge() {
    try {
      window.localStorage.setItem(STORAGE_NOTICE_KEY, STORAGE_NOTICE_VERSION)
    } catch {
      // The notice still closes when browser storage is unavailable.
    }
    setOpen(false)
  }

  if (!open) return null

  return (
    <aside aria-labelledby="storage-notice-title" className="storage-notice" role="region">
      <div>
        <strong id="storage-notice-title">Essential browser storage only</strong>
        <p>
          AralForge stores sign-in tokens, local editing drafts, interface preferences, and this notice acknowledgment.
          This launch does not use advertising, analytics, or marketing trackers.
        </p>
      </div>
      <div className="storage-notice__actions">
        <Link className="button button--secondary" to="/legal/storage">Learn more</Link>
        <button className="button button--primary" onClick={acknowledge} ref={acknowledgeRef} type="button">Got it</button>
      </div>
    </aside>
  )
}

function readAcknowledgedVersion() {
  try {
    return window.localStorage.getItem(STORAGE_NOTICE_KEY)
  } catch {
    return null
  }
}
