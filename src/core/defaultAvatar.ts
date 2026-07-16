import type { Member } from './schema'

export type DefaultAvatarAgeBand = 'child' | 'young' | 'adult' | 'senior'

interface CalendarDate {
  year: number
  month: number
  day: number
}

/**
 * 默认头像只做宽泛的年龄段区分。逝者按去世时年龄计算，
 * 缺少或无法解析出生日期时使用最中性的成年剪影。
 */
export function getDefaultAvatarAgeBand(
  member: Pick<Member, 'birthDate' | 'deathDate'>,
  today = new Date(),
): DefaultAvatarAgeBand {
  const birth = parseCalendarDate(member.birthDate)
  if (!birth) return 'adult'

  const end = parseCalendarDate(member.deathDate) ?? {
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    day: today.getDate(),
  }
  const age = ageAt(birth, end)
  if (age === null) return 'adult'
  if (age < 18) return 'child'
  if (age < 40) return 'young'
  if (age < 65) return 'adult'
  return 'senior'
}

function ageAt(birth: CalendarDate, end: CalendarDate): number | null {
  let age = end.year - birth.year
  if (end.month < birth.month || (end.month === birth.month && end.day < birth.day)) {
    age -= 1
  }
  return age >= 0 ? age : null
}

function parseCalendarDate(value?: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  if (!match) return null

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null

  return { year, month, day }
}
