import type { AttendanceRecord, User } from '../../types'
import { fullName } from '../../utils/student'

export function studentDisplayName(user: User) {
  return [user.last_name, user.first_name].filter(Boolean).join(', ') || fullName(user)
}

export function summarizeAttendance(records: AttendanceRecord[]) {
  const present = records.filter((record) => record.status === 'PRESENT').length
  const late = records.filter((record) => record.status === 'LATE').length
  const absent = records.filter((record) => record.status === 'ABSENT').length
  const excused = records.filter((record) => record.status === 'EXCUSED').length
  return { absent, attended: present + late + excused, excused, late, present }
}
