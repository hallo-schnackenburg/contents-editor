// A rule in words: "FREQ=YEARLY;BYEASTER=-1" is "Jährlich am Samstag vor Ostersonntag". Only what can be said well is said; for any
// other rule there is no text (the rule itself is shown then).

const DAYS: Record<string, string> = { MO: 'Montag', TU: 'Dienstag', WE: 'Mittwoch', TH: 'Donnerstag', FR: 'Freitag', SA: 'Samstag', SU: 'Sonntag' }
/** The weekday of an offset from a Sunday (Easter Sunday, the first Advent): 0 is a Sunday. */
const FROM_SUNDAY = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const ORDINALS: Record<string, string> = { '1': 'ersten', '2': 'zweiten', '3': 'dritten', '4': 'vierten', '5': 'fünften', '-1': 'letzten' }
const FREQ: Record<string, [string, string]> = { DAILY: ['Täglich', 'Tage'], WEEKLY: ['Wöchentlich', 'Wochen'], MONTHLY: ['Monatlich', 'Monate'], YEARLY: ['Jährlich', 'Jahre'] }
const KNOWN = new Set(['FREQ', 'INTERVAL', 'BYMONTH', 'BYMONTHDAY', 'BYDAY', 'COUNT', 'UNTIL', 'BYEASTER', 'BYADVENT', 'WKST'])

const list = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} und ${items.at(-1)}` : (items[0] ?? ''))
const numbers = (text: string | undefined): number[] | undefined => {
  const found = (text ?? '').split(',').map((x) => (/^-?\d{1,3}$/.test(x.trim()) ? Number(x) : NaN))
  return found.length > 0 && found.every((n) => Number.isInteger(n)) ? found : undefined
}

/** Where an anchor day lies, in words: "Samstag vor Ostersonntag", "Sonntag 9 Wochen nach Ostersonntag". */
function anchored(offset: number, anchor: string): string {
  if (offset === 0) return anchor
  const days = Math.abs(offset)
  const direction = offset < 0 ? 'vor' : 'nach'
  const weekday = FROM_SUNDAY[((offset % 7) + 7) % 7]
  if (days < 7) return `${weekday} ${direction} ${anchor}`
  if (days % 7 === 0) return `${weekday} ${days / 7} ${days === 7 ? 'Woche' : 'Wochen'} ${direction} ${anchor}`
  return `${weekday}, ${days} Tage ${direction} ${anchor}`
}

/** The date of an UNTIL as people write it: 20271231 is 31.12.2027. */
const untilText = (text: string): string | undefined => {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(text)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : undefined
}

export function ruleText(rrule: string): string | undefined {
  const parts = new Map<string, string>()
  for (const part of rrule.trim().replace(/^RRULE:/i, '').split(';')) {
    if (!part) continue
    const at = part.indexOf('=')
    if (at < 1) return undefined
    parts.set(part.slice(0, at).toUpperCase(), part.slice(at + 1))
  }
  const freq = FREQ[parts.get('FREQ')?.toUpperCase() ?? '']
  if (!freq || [...parts.keys()].some((key) => !KNOWN.has(key))) return undefined
  const interval = parts.has('INTERVAL') ? Number(parts.get('INTERVAL')) : 1
  if (!Number.isInteger(interval) || interval < 1) return undefined
  const head = interval === 1 ? freq[0] : `Alle ${interval} ${freq[1]}`

  const when: string[] = []
  const anchor = parts.has('BYEASTER') ? 'Ostersonntag' : parts.has('BYADVENT') ? 'dem 1. Advent' : undefined
  if (anchor) {
    const offsets = numbers(parts.get(parts.has('BYEASTER') ? 'BYEASTER' : 'BYADVENT'))
    if (!offsets) return undefined
    when.push(`am ${list(offsets.map((o) => anchored(o, anchor)))}`)
  } else {
    const months = parts.has('BYMONTH') ? numbers(parts.get('BYMONTH')) : []
    const monthdays = parts.has('BYMONTHDAY') ? numbers(parts.get('BYMONTHDAY')) : []
    if (!months || !monthdays || months.some((m) => m < 1 || m > 12) || monthdays.some((d) => d === 0 || Math.abs(d) > 31)) return undefined
    const days = (parts.get('BYDAY') ?? '').split(',').filter(Boolean)
    const parsed = days.map((d) => /^(-?[1-5])?(MO|TU|WE|TH|FR|SA|SU)$/.exec(d.toUpperCase()))
    if (parsed.some((m) => !m)) return undefined
    const monthText = list(months.map((m) => MONTHS[m - 1]))
    const dayText = (n: number) => (n === -1 ? 'letzten Tag' : `${n}.`)
    if (monthdays.length > 0) when.push(`am ${list(monthdays.map(dayText))}${months.length > 0 ? ` ${monthText}` : ''}`)
    else if (parsed.length === 0 && months.length > 0) when.push(`im ${monthText}`)
    if (parsed.length > 0) {
      const withNumber = parsed.filter((m) => m![1])
      const plain = parsed.filter((m) => !m![1])
      if (withNumber.length > 0) when.push(`am ${list(withNumber.map((m) => `${ORDINALS[m![1]!]} ${DAYS[m![2]]}`))}${monthdays.length === 0 && months.length > 0 ? ` im ${monthText}` : ''}`)
      if (plain.length > 0) when.push(list(plain.map((m) => `${DAYS[m![2]].toLowerCase()}s`)))
    }
  }

  const end: string[] = []
  if (parts.has('COUNT')) {
    const count = Number(parts.get('COUNT'))
    if (!Number.isInteger(count) || count < 1) return undefined
    end.push(`${count}-mal`)
  }
  if (parts.has('UNTIL')) {
    const until = untilText(parts.get('UNTIL')!)
    if (!until) return undefined
    end.push(`bis ${until}`)
  }
  return [[head, ...when].join(' '), ...end].join(', ')
}
