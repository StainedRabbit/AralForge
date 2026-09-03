import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

type LessonBlock =
  | { type: 'code'; value: string }
  | { alt: string; src: string; type: 'image' }
  | { type: 'text'; value: string }

type OrderedListItem = {
  number: number
  value: string
}

type TextPiece =
  | { level: 1 | 2 | 3 | 4; type: 'heading'; value: string }
  | { type: 'ordered-list'; items: OrderedListItem[] }
  | { type: 'paragraph'; value: string }
  | { headers: string[]; rows: string[][]; type: 'table' }
  | { items: string[]; type: 'list' }

export function RichLessonText({
  value,
  variant = 'default',
}: {
  value: string
  variant?: 'default' | 'presentation'
}) {
  const className = variant === 'presentation' ? 'presentation-content' : 'rich-text'

  return (
    <div className={className}>
      {splitLessonBlocks(value).map((block, index) => {
        if (block.type === 'code') {
          return <pre key={`${block.type}-${index}`}><code>{block.value}</code></pre>
        }

        if (block.type === 'image') {
          return (
            <ZoomableLessonImage
              alt={block.alt}
              caption={block.alt}
              key={`${block.type}-${index}`}
              src={block.src}
            />
          )
        }

        return renderTextPieces(block.value, index)
      })}
    </div>
  )
}

export function ZoomableLessonImage({
  alt,
  caption,
  className = 'lesson-image',
  src,
}: {
  alt: string
  caption?: string
  className?: string
  src: string
}) {
  const [zoomed, setZoomed] = useState(false)
  const [zoomMode, setZoomMode] = useState<'detail' | 'fit'>('fit')
  const [isPanning, setIsPanning] = useState(false)
  const zoomRef = useRef<HTMLDivElement | null>(null)
  const panStartRef = useRef({
    left: 0,
    top: 0,
    x: 0,
    y: 0,
  })

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      zoomMode !== 'detail' ||
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('.lesson-image-zoom__toolbar button'))
    ) {
      return
    }

    const zoom = zoomRef.current
    if (!zoom) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    panStartRef.current = {
      left: zoom.scrollLeft,
      top: zoom.scrollTop,
      x: event.clientX,
      y: event.clientY,
    }
    setIsPanning(true)
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isPanning || zoomMode !== 'detail') {
      return
    }

    const zoom = zoomRef.current
    if (!zoom) {
      return
    }

    const panStart = panStartRef.current
    zoom.scrollLeft = panStart.left - (event.clientX - panStart.x)
    zoom.scrollTop = panStart.top - (event.clientY - panStart.y)
  }

  function stopPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsPanning(false)
  }

  function closeFromBackdrop() {
    if (zoomMode === 'fit') {
      setZoomed(false)
    }
  }

  useEffect(() => {
    if (!zoomed) {
      return undefined
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setZoomed(false)
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [zoomed])

  useEffect(() => {
    if (!zoomed || zoomMode !== 'detail') {
      return
    }

    const zoom = zoomRef.current
    if (!zoom) {
      return
    }

    window.requestAnimationFrame(() => {
      zoom.scrollLeft = (zoom.scrollWidth - zoom.clientWidth) / 2
      zoom.scrollTop = (zoom.scrollHeight - zoom.clientHeight) / 2
    })
  }, [zoomed, zoomMode])

  return (
    <>
      <figure className={className}>
        <button
          className="lesson-image__zoom-trigger"
          onClick={() => setZoomed(true)}
          title="Zoom image"
          type="button"
        >
          <img alt={alt} src={src} />
        </button>
        {caption ? <figcaption>{caption}</figcaption> : null}
      </figure>
      {zoomed ? (
        <div
          className={[
            'lesson-image-zoom',
            `lesson-image-zoom--${zoomMode}`,
            isPanning ? 'is-panning' : '',
          ].filter(Boolean).join(' ')}
          onPointerCancel={stopPan}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={stopPan}
          ref={zoomRef}
          role="dialog"
          aria-modal="true"
        >
          <button
            aria-label="Close image zoom"
            className="lesson-image-zoom__backdrop"
            onClick={closeFromBackdrop}
            type="button"
          />
          <figure className="lesson-image-zoom__surface">
            <div className="lesson-image-zoom__toolbar">
              {zoomMode === 'detail' ? (
                <span className="lesson-image-zoom__hint">Drag to pan</span>
              ) : null}
              <button
                className={zoomMode === 'fit' ? 'active' : ''}
                onClick={() => setZoomMode('fit')}
                type="button"
              >
                Fit
              </button>
              <button
                className={zoomMode === 'detail' ? 'active' : ''}
                onClick={() => setZoomMode('detail')}
                type="button"
              >
                Detail
              </button>
              <button
                aria-label="Close image zoom"
                className="lesson-image-zoom__close"
                onClick={() => setZoomed(false)}
                type="button"
              >
                x
              </button>
            </div>
            <img alt={alt} draggable={false} src={src} />
            {caption ? <figcaption>{caption}</figcaption> : null}
          </figure>
        </div>
      ) : null}
    </>
  )
}

function splitLessonBlocks(value: string): LessonBlock[] {
  const blocks: LessonBlock[] = []
  const pattern = /```[^\S\r\n]*(?:[A-Za-z0-9_-]+)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n?```|!\[([^\]]*)\]\(([^)]+)\)/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) {
      blocks.push({ type: 'text', value: value.slice(cursor, match.index) })
    }

    if (match[1] !== undefined) {
      blocks.push({ type: 'code', value: normalizeCodeBlock(match[1]) })
    } else {
      blocks.push({ alt: match[2] ?? '', src: match[3], type: 'image' })
    }

    cursor = pattern.lastIndex
  }

  if (cursor < value.length) {
    blocks.push({ type: 'text', value: value.slice(cursor) })
  }

  return blocks
}

function normalizeCodeBlock(value: string) {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/^[ \t]+/, '')
    .replace(/\n[ \t\n]*$/, '')
}

function renderTextPieces(value: string, blockIndex: number) {
  return parseTextPieces(value).map((piece, index) => {
    if (piece.type === 'heading') {
      const HeadingTag = `h${piece.level}` as const
      return (
        <HeadingTag key={`${blockIndex}-heading-${index}`}>
          {renderInlineMarkdown(piece.value, `${blockIndex}-${index}`)}
        </HeadingTag>
      )
    }

    if (piece.type === 'list') {
      return (
        <ul key={`${blockIndex}-list-${index}`}>
          {piece.items.map((item, itemIndex) => (
            <li key={`${blockIndex}-${index}-${itemIndex}`}>
              {renderInlineMarkdown(item, `${blockIndex}-${index}-${itemIndex}`)}
            </li>
          ))}
        </ul>
      )
    }

    if (piece.type === 'ordered-list') {
      return (
        <ol key={`${blockIndex}-ordered-list-${index}`} start={piece.items[0]?.number}>
          {piece.items.map((item, itemIndex) => (
            <li key={`${blockIndex}-${index}-${itemIndex}`} value={item.number}>
              {renderInlineMarkdown(item.value, `${blockIndex}-${index}-${itemIndex}`)}
            </li>
          ))}
        </ol>
      )
    }

    if (piece.type === 'table') {
      return (
        <div className="lesson-table-wrap" key={`${blockIndex}-table-${index}`}>
          <table className="lesson-table">
            <thead>
              <tr>
                {piece.headers.map((header, headerIndex) => (
                  <th key={`${blockIndex}-${index}-head-${headerIndex}`}>
                    {renderInlineMarkdown(header, `${blockIndex}-${index}-head-${headerIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {piece.rows.map((row, rowIndex) => (
                <tr key={`${blockIndex}-${index}-row-${rowIndex}`}>
                  {piece.headers.map((_, cellIndex) => (
                    <td key={`${blockIndex}-${index}-${rowIndex}-${cellIndex}`}>
                      {renderInlineMarkdown(row[cellIndex] ?? '', `${blockIndex}-${index}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    return (
      <p key={`${blockIndex}-paragraph-${index}`}>
        {renderInlineMarkdown(piece.value, `${blockIndex}-${index}`)}
      </p>
    )
  })
}

function parseTextPieces(value: string): TextPiece[] {
  const pieces: TextPiece[] = []
  let currentList: string[] = []
  let currentOrderedList: OrderedListItem[] = []
  const lines = value.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()

    if (!trimmed) {
      flushLists()
      continue
    }

    if (isTableStart(lines, index)) {
      flushLists()
      const tableLines = [lines[index]]
      index += 2
      while (index < lines.length && parseTableRow(lines[index]).length > 1) {
        tableLines.push(lines[index])
        index += 1
      }
      index -= 1
      pieces.push({
        headers: parseTableRow(tableLines[0]),
        rows: tableLines.slice(1).map(parseTableRow),
        type: 'table',
      })
      continue
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)/)
    if (heading) {
      flushLists()
      pieces.push({
        level: heading[1].length as 1 | 2 | 3 | 4,
        type: 'heading',
        value: heading[2],
      })
      continue
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)/)
    if (bullet) {
      currentList.push(bullet[1])
      continue
    }

    const ordered = trimmed.match(/^(\d+)\.\s+(.+)/)
    if (ordered) {
      currentOrderedList.push({
        number: Number.parseInt(ordered[1], 10),
        value: ordered[2],
      })
      continue
    }

    flushLists()
    pieces.push({ type: 'paragraph', value: trimmed })
  }

  flushLists()
  return pieces

  function flushLists() {
    if (currentList.length) {
      pieces.push({ items: currentList, type: 'list' })
      currentList = []
    }
    if (currentOrderedList.length) {
      pieces.push({ items: currentOrderedList, type: 'ordered-list' })
      currentOrderedList = []
    }
  }
}

function isTableStart(lines: string[], index: number) {
  const header = parseTableRow(lines[index])
  const separator = parseTableRow(lines[index + 1] ?? '')
  return (
    header.length > 1 &&
    separator.length === header.length &&
    separator.every((cell) => /^:?-{3,}:?$/.test(cell))
  )
}

function parseTableRow(line: string) {
  const trimmed = line.trim()
  const cells: string[] = []
  let cell = ''
  let hasSeparator = false

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]

    if (character === '\\' && trimmed[index + 1] === '|') {
      cell += '\\|'
      index += 1
      continue
    }

    if (character === '|') {
      cells.push(cell)
      cell = ''
      hasSeparator = true
      continue
    }

    cell += character
  }

  if (!hasSeparator) {
    return []
  }

  cells.push(cell)

  if (trimmed.startsWith('|')) {
    cells.shift()
  }
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) {
    cells.pop()
  }

  return cells.map((value) => value.trim())
}

function renderInlineMarkdown(value: string, keyPrefix: string): ReactNode[] {
  const pieces: ReactNode[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) {
      pieces.push(unescapeMarkdown(value.slice(cursor, match.index)))
    }

    const token = match[0]
    const key = `${keyPrefix}-inline-${match.index}`

    if (token.startsWith('`')) {
      pieces.push(<code key={key}>{unescapeMarkdown(token.slice(1, -1))}</code>)
    } else if (token.startsWith('**')) {
      pieces.push(<strong key={key}>{unescapeMarkdown(token.slice(2, -2))}</strong>)
    } else if (token.startsWith('*')) {
      pieces.push(<em key={key}>{unescapeMarkdown(token.slice(1, -1))}</em>)
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (link) {
        pieces.push(
          <a href={safeHref(link[2])} key={key} rel="noreferrer" target="_blank">
            {unescapeMarkdown(link[1])}
          </a>,
        )
      }
    }

    cursor = pattern.lastIndex
  }

  if (cursor < value.length) {
    pieces.push(unescapeMarkdown(value.slice(cursor)))
  }

  return pieces
}

function unescapeMarkdown(value: string) {
  return value.replaceAll('\\|', '|')
}

function safeHref(href: string) {
  if (/^(https?:|mailto:|\/|#)/i.test(href)) {
    return href
  }

  return '#'
}
