import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { AttendanceRecord } from '../../types'
import { toErrorMessage } from '../../utils/format'
import { studentNumberFromQr } from '../../utils/studentQr'
import { Icon } from '../Icon'

export type AttendanceScanResult = {
  already_marked: boolean
  record: AttendanceRecord
  student: { id: number; name: string; student_number: string }
}

type ScanFeedback = { message: string; tone: 'error' | 'success' | 'warning' }

export function AttendanceQrScanner({
  onClose,
  onScan,
  onUndo,
}: {
  onClose: () => void
  onScan: (studentNumber: string) => Promise<AttendanceScanResult>
  onUndo: (() => Promise<void>) | null
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const enqueueRef = useRef<(value: string, manual: boolean) => void>(() => undefined)
  const onScanRef = useRef(onScan)
  const [cameraError, setCameraError] = useState('')
  const [cameraRevision, setCameraRevision] = useState(0)
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  const [studentNumber, setStudentNumber] = useState('')
  const [queuedCount, setQueuedCount] = useState(0)
  const [undoing, setUndoing] = useState(false)

  useEffect(() => { onScanRef.current = onScan }, [onScan])

  useEffect(() => {
    let cancelled = false
    let controls: { stop: () => void } | null = null
    const video = videoRef.current
    const queue: string[] = []
    const recent = new Map<string, number>()
    let processing = false

    async function processQueue() {
      if (processing) return
      processing = true
      while (!cancelled && queue.length) {
        const number = queue.shift()!
        setQueuedCount(queue.length + 1)
        try {
          const result = await onScanRef.current(number)
          if (cancelled) break
          setFeedback({
            message: result.already_marked
              ? `${result.student.name} (${result.student.student_number}) is already ${result.record.status.toLowerCase()}.`
              : `${result.student.name} (${result.student.student_number}) marked Present.`,
            tone: result.already_marked ? 'warning' : 'success',
          })
        } catch (error) {
          if (!cancelled) setFeedback({ message: toErrorMessage(error), tone: 'error' })
        }
      }
      processing = false
      if (!cancelled) setQueuedCount(0)
    }

    enqueueRef.current = (value, manual) => {
      const number = manual ? value.trim() : studentNumberFromQr(value)
      if (!number) {
        setFeedback({
          message: manual ? 'Enter a student number.' : 'This is not an AralForge student QR code.',
          tone: 'error',
        })
        return
      }
      const now = Date.now()
      if (!manual && recent.has(number) && now - recent.get(number)! < 4000) return
      if (queue.includes(number)) return
      recent.set(number, now)
      queue.push(number)
      setQueuedCount(queue.length)
      void processQueue()
    }

    async function startCamera() {
      setCameraError('')
      if (!navigator.mediaDevices?.getUserMedia || !video) {
        setCameraError('Camera scanning is unavailable here. Enter the student number below.')
        return
      }
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser')
        if (cancelled || !video) return
        const reader = new BrowserQRCodeReader()
        const started = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' } } },
          video,
          (result) => {
            if (result && !cancelled) enqueueRef.current(result.getText(), false)
          },
        )
        if (cancelled) started.stop()
        else {
          controls = started
          setCameraError('')
        }
      } catch {
        if (!cancelled) setCameraError('Camera access failed. Check permission or enter the student number below.')
      }
    }

    void startCamera()
    return () => {
      cancelled = true
      enqueueRef.current = () => undefined
      controls?.stop()
      const stream = video?.srcObject
      if (stream && 'getTracks' in stream) stream.getTracks().forEach((track) => track.stop())
    }
  }, [cameraRevision])

  function submitNumber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    enqueueRef.current(studentNumber, true)
    setStudentNumber('')
  }

  async function undoScan() {
    if (!onUndo || undoing) return
    setUndoing(true)
    try {
      await onUndo()
      setFeedback({ message: 'Last QR attendance mark undone.', tone: 'warning' })
    } catch (error) {
      setFeedback({ message: toErrorMessage(error), tone: 'error' })
    } finally {
      setUndoing(false)
    }
  }

  return (
    <section aria-label="Scan student QR codes" className="attendance-qr-scanner">
      <div className="attendance-qr-scanner__heading">
        <div><h2>Scan student QR</h2><p>Show each QR code to the camera. Scanning continues after every result.</p></div>
        <button className="button button--secondary button--compact" onClick={onClose} type="button"><Icon name="close" /><span>Close scanner</span></button>
      </div>
      <div className={`attendance-qr-scanner__camera${cameraError ? ' attendance-qr-scanner__camera--unavailable' : ''}`}>
        <video aria-label="Camera preview for student QR codes" autoPlay muted playsInline ref={videoRef} />
        <span aria-hidden="true" className="attendance-qr-scanner__guide" />
      </div>
      {cameraError ? <div className="attendance-qr-scanner__camera-error" role="status"><span>{cameraError}</span><button className="button button--secondary button--compact" onClick={() => setCameraRevision((value) => value + 1)} type="button">Retry camera</button></div> : null}
      {feedback ? <p aria-live="polite" className={`attendance-qr-scanner__result attendance-qr-scanner__result--${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.message}</p> : <p className="attendance-qr-scanner__result" role="status">Ready to scan.</p>}
      {queuedCount ? <p className="attendance-qr-scanner__queue" role="status">Processing {queuedCount} scan{queuedCount === 1 ? '' : 's'}...</p> : null}
      <form className="attendance-qr-scanner__manual" onSubmit={submitNumber}>
        <label className="admin-field"><span>Enter student number</span><input autoComplete="off" onChange={(event) => setStudentNumber(event.target.value)} value={studentNumber} /></label>
        <button className="button button--primary" type="submit">Mark Present</button>
      </form>
      {onUndo ? <button className="button button--secondary button--compact" disabled={undoing || Boolean(queuedCount)} onClick={() => void undoScan()} type="button">{undoing ? 'Undoing...' : 'Undo last scan'}</button> : null}
    </section>
  )
}
