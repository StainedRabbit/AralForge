import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { RichLessonText } from './RichLessonText'
import { countReplacementCharacters, replacementCharacterWarning } from '../utils/textFile'

type MarkdownAction =
  | 'bold'
  | 'code'
  | 'heading'
  | 'image'
  | 'italic'
  | 'link'
  | 'ordered-list'
  | 'redo'
  | 'table'
  | 'unordered-list'
  | 'undo'

type ToolbarButton = {
  action: MarkdownAction
  label: string
  title: string
}

const toolbarButtons: ToolbarButton[] = [
  { action: 'undo', label: 'Undo', title: 'Undo' },
  { action: 'redo', label: 'Redo', title: 'Redo' },
  { action: 'bold', label: 'B', title: 'Bold' },
  { action: 'italic', label: 'I', title: 'Italic' },
  { action: 'heading', label: 'H', title: 'Heading' },
  { action: 'unordered-list', label: '- List', title: 'Bullet list' },
  { action: 'ordered-list', label: '1. List', title: 'Numbered list' },
  { action: 'link', label: 'Link', title: 'Link' },
  { action: 'image', label: 'Image', title: 'Image markdown' },
  { action: 'code', label: 'Code', title: 'Code block' },
  { action: 'table', label: 'Table', title: 'Table template' },
]

export function MarkdownEditor({
  autoFocus = false,
  isLarge = false,
  label,
  onChange,
  onEnterFocus,
  rows,
  value,
}: {
  autoFocus?: boolean
  isLarge?: boolean
  label: string
  onChange: (value: string) => void
  onEnterFocus?: () => void
  rows: number
  value: string
}) {
  const textareaId = useId()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const resizeStartRef = useRef({
    anchorTop: 0,
    startHeight: 0,
    startY: 0,
  })
  const historyRef = useRef({
    future: [] as string[],
    lastValue: value,
    past: [] as string[],
  })
  const [editorHeight, setEditorHeight] = useState<number | null>(null)
  const [preview, setPreview] = useState(false)
  const [historyState, setHistoryState] = useState({
    canRedo: false,
    canUndo: false,
  })
  const replacementCount = countReplacementCharacters(value)

  useEffect(() => {
    const history = historyRef.current
    if (value === history.lastValue) {
      return
    }

    history.lastValue = value
    history.past = []
    history.future = []
    setHistoryState({ canRedo: false, canUndo: false })
  }, [value])

  function syncHistoryState() {
    const history = historyRef.current
    setHistoryState({
      canRedo: history.future.length > 0,
      canUndo: history.past.length > 0,
    })
  }

  function focusTextarea(selectionStart?: number, selectionEnd = selectionStart) {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    window.requestAnimationFrame(() => {
      textarea.focus({ preventScroll: true })
      if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
        textarea.setSelectionRange(selectionStart, selectionEnd)
      }
    })
  }

  useEffect(() => {
    if (autoFocus && !preview) {
      focusTextarea()
    }
  }, [autoFocus, preview])

  function commitValue(nextValue: string, selectionStart?: number, selectionEnd = selectionStart) {
    const history = historyRef.current
    const currentValue = history.lastValue
    if (nextValue === currentValue) {
      focusTextarea(selectionStart, selectionEnd)
      return
    }

    history.past = [...history.past.slice(-99), currentValue]
    history.future = []
    history.lastValue = nextValue
    onChange(nextValue)
    syncHistoryState()
    focusTextarea(selectionStart, selectionEnd)
  }

  function undo() {
    const history = historyRef.current
    const previousValue = history.past.pop()
    if (typeof previousValue !== 'string') {
      return
    }

    history.future.push(history.lastValue)
    history.lastValue = previousValue
    onChange(previousValue)
    syncHistoryState()
    focusTextarea()
  }

  function redo() {
    const history = historyRef.current
    const nextValue = history.future.pop()
    if (typeof nextValue !== 'string') {
      return
    }

    history.past.push(history.lastValue)
    history.lastValue = nextValue
    onChange(nextValue)
    syncHistoryState()
    focusTextarea()
  }

  function applyAction(action: MarkdownAction) {
    if (action === 'undo') {
      undo()
      return
    }

    if (action === 'redo') {
      redo()
      return
    }

    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    const selectionStart = textarea.selectionStart
    const selectionEnd = textarea.selectionEnd
    const selection = value.slice(selectionStart, selectionEnd)
    const scrollLeft = textarea.scrollLeft
    const scrollTop = textarea.scrollTop
    const next = createMarkdownUpdate(value, selectionStart, selectionEnd, selection, action)

    commitValue(next.value, next.selectionStart, next.selectionEnd)
    window.requestAnimationFrame(() => {
      textarea.scrollLeft = scrollLeft
      textarea.scrollTop = scrollTop
    })
  }

  function handleChange(nextValue: string) {
    const textarea = textareaRef.current
    commitValue(nextValue, textarea?.selectionStart, textarea?.selectionEnd)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const isUndoKey = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z'
    const isRedoKey =
      (event.ctrlKey || event.metaKey) &&
      (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))

    if (isRedoKey) {
      event.preventDefault()
      redo()
      return
    }

    if (isUndoKey) {
      event.preventDefault()
      undo()
    }
  }

  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (preview || event.button !== 0) {
      return
    }

    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    event.preventDefault()
    const resizeTextarea = textarea
    const editor = resizeTextarea.closest('.markdown-editor')
    resizeStartRef.current = {
      anchorTop: editor?.getBoundingClientRect().top ?? resizeTextarea.getBoundingClientRect().top,
      startHeight: resizeTextarea.offsetHeight,
      startY: event.clientY,
    }
    document.body.classList.add('markdown-editor-resizing')

    function handlePointerMove(pointerEvent: globalThis.PointerEvent) {
      pointerEvent.preventDefault()
      const resizeStart = resizeStartRef.current
      const minHeight = Math.max(120, rows * 20 + 24)
      const maxHeight = Math.max(minHeight, Math.min(820, window.innerHeight - 120))
      const nextHeight = Math.min(
        maxHeight,
        Math.max(minHeight, resizeStart.startHeight + pointerEvent.clientY - resizeStart.startY),
      )

      setEditorHeight(nextHeight)
      window.requestAnimationFrame(() => {
        const nextTop = editor?.getBoundingClientRect().top ?? resizeTextarea.getBoundingClientRect().top
        window.scrollBy(0, nextTop - resizeStart.anchorTop)
      })
    }

    function stopResize() {
      document.body.classList.remove('markdown-editor-resizing')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  return (
    <div className={isLarge ? 'admin-field admin-field--wide markdown-editor markdown-editor--large' : 'admin-field admin-field--wide markdown-editor'}>
      <label htmlFor={textareaId}>{label}</label>
      <div className="markdown-editor__shell">
        <div className="markdown-editor__toolbar" aria-label={`${label} formatting tools`}>
          {toolbarButtons.map((button) => (
            <button
              className="markdown-editor__tool"
              disabled={
                preview ||
                (button.action === 'undo' && !historyState.canUndo) ||
                (button.action === 'redo' && !historyState.canRedo)
              }
              key={button.action}
              onClick={() => applyAction(button.action)}
              onMouseDown={(event) => event.preventDefault()}
              title={button.title}
              type="button"
            >
              {button.label}
            </button>
          ))}
          <button
            className={preview ? 'markdown-editor__preview-toggle active' : 'markdown-editor__preview-toggle'}
            onClick={() => setPreview((current) => !current)}
            type="button"
          >
            {preview ? 'Edit' : 'Preview'}
          </button>
          {onEnterFocus ? (
            <button
              className="markdown-editor__focus-toggle"
              onClick={onEnterFocus}
              type="button"
            >
              Focus
            </button>
          ) : null}
        </div>
        {preview ? (
          <div className="markdown-editor__preview">
            {value.trim() ? (
              <RichLessonText value={value} />
            ) : (
              <p className="markdown-editor__empty">Nothing to preview yet.</p>
            )}
          </div>
        ) : (
          <textarea
            id={textareaId}
            onChange={(event) => handleChange(event.target.value)}
            onKeyDown={handleKeyDown}
            ref={textareaRef}
            rows={rows}
            style={editorHeight ? { height: `${editorHeight}px` } : undefined}
            value={value}
          />
        )}
        {!preview ? (
          <button
            aria-label={`Resize ${label} editor`}
            className="markdown-editor__resize"
            onPointerDown={startResize}
            title="Drag to resize editor"
            type="button"
          />
        ) : null}
      </div>
      {replacementCount ? (
        <small className="admin-message text-import-warning" role="alert">{replacementCharacterWarning(replacementCount)}</small>
      ) : null}
    </div>
  )
}

function createMarkdownUpdate(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  selection: string,
  action: MarkdownAction,
) {
  if (action === 'bold') {
    return replaceSelection(value, selectionStart, selectionEnd, `**${selection || 'bold text'}**`, selection ? 2 : 2, selection ? 2 + selection.length : 11)
  }

  if (action === 'italic') {
    return replaceSelection(value, selectionStart, selectionEnd, `*${selection || 'italic text'}*`, selection ? 1 : 1, selection ? 1 + selection.length : 12)
  }

  if (action === 'heading') {
    return replaceLines(value, selectionStart, selectionEnd, selection, (lines) =>
      lines.map((line) => line.startsWith('## ') ? line : `## ${line || 'Heading'}`).join('\n'),
    )
  }

  if (action === 'unordered-list') {
    return replaceLines(value, selectionStart, selectionEnd, selection, (lines) =>
      lines.map((line) => line.startsWith('- ') ? line : `- ${line || 'List item'}`).join('\n'),
    )
  }

  if (action === 'ordered-list') {
    return replaceLines(value, selectionStart, selectionEnd, selection, (lines) =>
      lines.map((line, index) => /^\d+\.\s/.test(line) ? line : `${index + 1}. ${line || 'List item'}`).join('\n'),
    )
  }

  if (action === 'link') {
    const text = selection || 'Link text'
    return replaceSelection(value, selectionStart, selectionEnd, `[${text}](https://example.com)`, 1, 1 + text.length)
  }

  if (action === 'image') {
    return replaceSelection(value, selectionStart, selectionEnd, `![${selection || 'Alt text'}](https://example.com/image.png)`, 2, 2 + (selection || 'Alt text').length)
  }

  if (action === 'code') {
    const text = selection || 'code here'
    return replaceSelection(value, selectionStart, selectionEnd, blockInsert(value, selectionStart, `\`\`\`java\n${text}\n\`\`\``))
  }

  const table = [
    '| Column 1 | Column 2 |',
    '|---|---|',
    '| Value 1 | Value 2 |',
  ].join('\n')
  return replaceSelection(value, selectionStart, selectionEnd, blockInsert(value, selectionStart, table))
}

function replaceSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  replacement: string,
  innerStartOffset = replacement.length,
  innerEndOffset = replacement.length,
) {
  const nextValue = `${value.slice(0, selectionStart)}${replacement}${value.slice(selectionEnd)}`
  return {
    selectionEnd: selectionStart + innerEndOffset,
    selectionStart: selectionStart + innerStartOffset,
    value: nextValue,
  }
}

function replaceLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  selection: string,
  transform: (lines: string[]) => string,
) {
  const start = value.lastIndexOf('\n', selectionStart - 1) + 1
  const nextBreak = value.indexOf('\n', selectionEnd)
  const end = nextBreak === -1 ? value.length : nextBreak
  const selectedLines = value.slice(start, end) || selection
  const replacement = transform(selectedLines.split('\n'))
  const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`

  return {
    selectionEnd: start + replacement.length,
    selectionStart: start,
    value: nextValue,
  }
}

function blockInsert(value: string, selectionStart: number, block: string) {
  const before = value.slice(0, selectionStart)
  const after = value.slice(selectionStart)
  const prefix = before && !before.endsWith('\n\n') ? before.endsWith('\n') ? '\n' : '\n\n' : ''
  const suffix = after && !after.startsWith('\n\n') ? after.startsWith('\n') ? '\n' : '\n\n' : ''
  return `${prefix}${block}${suffix}`
}
