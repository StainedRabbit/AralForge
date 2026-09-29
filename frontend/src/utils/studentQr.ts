import QRCode from 'qrcode'

export function studentQrPayload(studentNumber: string) {
  return studentNumber
}

export function studentNumberFromQr(payload: string) {
  const legacyMatch = /^AralForge Student\r?\nName: [^\r\n]*\r?\nStudent Number: ([^\r\n]+)\s*$/.exec(payload)
  const studentNumber = (legacyMatch?.[1] ?? payload).trim()
  return /^[\p{L}\p{M}\p{N}_@.+-]{1,30}$/u.test(studentNumber) ? studentNumber : null
}

export function studentQrImage(payload: string) {
  return QRCode.toDataURL(payload, {
    color: { dark: '#0f172a', light: '#ffffff' },
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 480,
  })
}
