import { useState } from 'react'
import type { AuthedRequest } from '../app/types'
import type { Module } from '../types'
import { toErrorMessage } from '../utils/format'
import { Icon } from './Icon'

export function TopicPdfDownloads({
  api,
  module,
}: {
  api: AuthedRequest
  module: Module
}) {
  if (!module.downloadable_topics.length) {
    return (
      <p className="locked-topic-downloads__empty">
        Your teacher has not published any downloadable topics yet.
      </p>
    )
  }

  return (
    <div className="locked-topic-downloads">
      {module.downloadable_topics.map((topic) => (
        <article className="locked-topic-download" key={topic.id}>
          <span className="locked-topic-download__icon">
            <Icon name="file" />
          </span>
          <div className="locked-topic-download__copy">
            <small>{[topic.unit, topic.competency_code].filter(Boolean).join(' / ') || `Topic ${topic.order + 1}`}</small>
            <strong>{topic.title}</strong>
            <span>Lessons and printable Main Activity questions</span>
          </div>
          <TopicPdfButton api={api} module={module} topic={topic} />
        </article>
      ))}
    </div>
  )
}

export function TopicPdfButton({
  api,
  compact = false,
  module,
  topic,
}: {
  api: AuthedRequest
  compact?: boolean
  module: Module
  topic: Pick<Module['downloadable_topics'][number], 'id' | 'title'>
}) {
  const [downloading, setDownloading] = useState(false)
  const [message, setMessage] = useState('')

  async function downloadTopic() {
    setDownloading(true)
    setMessage('')
    try {
      const blob = await api<Blob>(`/modules/topics/${topic.id}/download_pdf/`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${module.slug || 'module'}-${slugify(topic.title) || `topic-${topic.id}`}.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError) || 'The topic PDF is not available yet.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      <button
        className={`button button--secondary${compact ? ' button--compact' : ''}`}
        disabled={downloading}
        onClick={() => void downloadTopic()}
        type="button"
      >
        <Icon name="arrow-down" />
        <span>{downloading ? 'Downloading...' : 'Download Topic PDF'}</span>
      </button>
      {message ? <p className="admin-message">{message}</p> : null}
    </>
  )
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
