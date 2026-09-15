import type { AuthedRequest } from '../app/types'
import type { TopicPdfGenerationResponse, TopicPdfStatus } from '../types'

const DEFAULT_POLL_INTERVAL_MS = 1500
const DEFAULT_TIMEOUT_MS = 120_000

type PdfWaitOptions = {
  onStatus?: (message: string) => void
  pollIntervalMs?: number
  signal?: AbortSignal
  timeoutMs?: number
}

export async function requestTopicPdfDownload(
  api: AuthedRequest,
  topicId: number,
  options: PdfWaitOptions = {},
) {
  const response = await api<Blob | TopicPdfGenerationResponse>(
    `/modules/topics/${topicId}/download_pdf/`,
    { signal: options.signal },
  )
  if (response instanceof Blob) return response

  options.onStatus?.('Generating PDF...')
  await waitForTopicPdf(api, topicId, options)

  const ready = await api<Blob | TopicPdfGenerationResponse>(
    `/modules/topics/${topicId}/download_pdf/`,
    { signal: options.signal },
  )
  if (!(ready instanceof Blob)) {
    throw new Error('The topic PDF is still being prepared. Please try again shortly.')
  }
  return ready
}

export async function waitForTopicPdf(
  api: AuthedRequest,
  topicId: number,
  {
    onStatus,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: PdfWaitOptions = {},
) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    await delay(pollIntervalMs, signal)
    const pdfStatus = await api<TopicPdfStatus>(
      `/modules/topics/${topicId}/pdf_status/`,
      { signal },
    )
    const generation = pdfStatus.generation

    if (generation?.status === 'FAILED') {
      throw new Error(generation.error || 'The topic PDF could not be generated. Please try again.')
    }
    if (generation?.status === 'SUCCEEDED' && pdfStatus.has_pdf) {
      return pdfStatus
    }

    onStatus?.(generation?.status === 'RUNNING' ? 'Generating PDF...' : 'PDF generation is queued...')
  }

  throw new Error('The topic PDF is still generating. Please try again shortly.')
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
      return
    }

    const onAbort = () => {
      window.clearTimeout(timeout)
      reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    }
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
