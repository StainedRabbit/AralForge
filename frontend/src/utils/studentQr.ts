import QRCode from 'qrcode'

export function studentQrPayload(name: string, studentNumber: string) {
  return `AralForge Student\nName: ${name}\nStudent Number: ${studentNumber}`
}

export function studentNumberFromQr(payload: string) {
  const match = /^AralForge Student\r?\nName: [^\r\n]*\r?\nStudent Number: ([^\r\n]+)\s*$/.exec(payload)
  const studentNumber = match?.[1]?.trim() ?? ''
  return studentNumber.length > 0 && studentNumber.length <= 30
    ? studentNumber
    : null
}

export function studentQrImage(payload: string) {
  return QRCode.toDataURL(payload, {
    color: { dark: '#0f172a', light: '#ffffff' },
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 480,
  })
}
