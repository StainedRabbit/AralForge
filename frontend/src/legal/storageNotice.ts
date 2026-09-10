export const OPEN_STORAGE_NOTICE_EVENT = 'aralforge:open-storage-notice'

export function openStorageNotice() {
  window.dispatchEvent(new Event(OPEN_STORAGE_NOTICE_EVENT))
}
