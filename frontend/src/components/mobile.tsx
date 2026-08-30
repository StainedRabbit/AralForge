import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

export function ResponsiveRecordList<T>({
  ariaLabel,
  className = '',
  empty,
  items,
  itemKey,
  renderItem,
}: {
  ariaLabel: string
  className?: string
  empty?: ReactNode
  items: T[]
  itemKey: (item: T) => string | number
  renderItem: (item: T) => ReactNode
}) {
  if (!items.length) return <>{empty ?? null}</>
  return <div aria-label={ariaLabel} className={`responsive-record-list ${className}`.trim()}>{items.map((item) => <article className="responsive-record-card" key={itemKey(item)}>{renderItem(item)}</article>)}</div>
}

export function MobileStickyActions({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mobile-sticky-actions ${className}`.trim()}>{children}</div>
}

export function ResponsiveDetailSheet({ children, footer, onClose, open, title }: {
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  open: boolean
  title: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.requestAnimationFrame(() => closeRef.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const controls = panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
      if (!controls?.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = originalOverflow
      previous?.focus()
    }
  }, [onClose, open])
  if (!open) return null
  return <div aria-labelledby="responsive-detail-title" aria-modal="true" className="responsive-detail" role="dialog"><button aria-label="Close details" className="responsive-detail__backdrop" onClick={onClose} type="button" /><div className="responsive-detail__panel" ref={panelRef}><header><strong id="responsive-detail-title">{title}</strong><button aria-label="Close" className="icon-button" onClick={onClose} ref={closeRef} type="button"><Icon name="close" /></button></header><div className="responsive-detail__body">{children}</div>{footer ? <footer>{footer}</footer> : null}</div></div>
}
