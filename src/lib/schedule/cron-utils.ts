
import { CronExpressionParser } from 'cron-parser'

export function calculateNextRunAt(
  cronExpression: string,
  timezone: string = 'UTC'
): Date {
  try {
    const crons = cronExpression.split(';').map(c => c.trim()).filter(c => c)
    const nextDates: Date[] = []

    for (const cron of crons) {
      try {
        const interval = CronExpressionParser.parse(cron, {
          currentDate: new Date(),
          tz: timezone
        })
        const next = interval.next()
        nextDates.push(next.toDate())
      } catch {
      }
    }

    if (nextDates.length === 0) {
      return new Date(Date.now() + 60 * 60 * 1000)
    }

    return nextDates.sort((a, b) => a.getTime() - b.getTime())[0]
  } catch (error) {
    console.error('[CRON] Failed to parse cron expression:', cronExpression, error)
    return new Date(Date.now() + 60 * 60 * 1000)
  }
}

export function isValidCronExpression(cronExpression: string): boolean {
  try {
    const crons = cronExpression.split(';').map(c => c.trim()).filter(c => c)
    if (crons.length === 0) return false

    for (const cron of crons) {
      CronExpressionParser.parse(cron)
    }
    return true
  } catch {
    return false
  }
}

export function describeCronExpression(cronExpression: string): string {
  if (cronExpression.includes(';')) {
    const crons = cronExpression.split(';')
    const times = crons.map(c => {
      const [minute, hour] = c.trim().split(' ')
      return `${hour}:${minute.padStart(2, '0')}`
    })
    const firstCron = crons[0].trim().split(' ')
    const [, , dayOfMonth, month, dayOfWeek] = firstCron

    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return `Every day at ${times.join(', ')}`
    }
    if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const dayValues = dayOfWeek.split(',')
      const dayNames = dayValues.map(d => days[parseInt(d)] || d).join(', ')
      return `Every ${dayNames} at ${times.join(', ')}`
    }
    if (dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
      return `Day ${dayOfMonth} at ${times.join(', ')}`
    }
    return `${times.join(', ')}`
  }

  const parts = cronExpression.split(' ')
  if (parts.length !== 5) return cronExpression

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    if (minute === '0') {
      return `Every day at ${hour}:00`
    }
    return `Every day at ${hour}:${minute.padStart(2, '0')}`
  }

  if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const dayValues = dayOfWeek.split(',')
    if (dayValues.length === 1) {
      const dayName = days[parseInt(dayOfWeek)] || dayOfWeek
      return `Every ${dayName} at ${hour}:${minute.padStart(2, '0')}`
    } else {
      const dayNames = dayValues.map(d => days[parseInt(d)] || d).join(', ')
      return `Every ${dayNames} at ${hour}:${minute.padStart(2, '0')}`
    }
  }

  if (dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    return `Every month on day ${dayOfMonth} at ${hour}:${minute.padStart(2, '0')}`
  }

  if (minute !== '*' && hour === '*') {
    return `Every hour at :${minute.padStart(2, '0')}`
  }

  if (minute.startsWith('*/')) {
    const interval = minute.replace('*/', '')
    return `Every ${interval} minutes`
  }

  return cronExpression
}

export function presetToCron(
  preset: 'daily' | 'weekly' | 'monthly' | 'hourly',
  options: {
    hour?: number
    minute?: number
    dayOfWeek?: number  // 0-6 (Sun-Sat)
    dayOfMonth?: number // 1-31
  } = {}
): string {
  const { hour = 9, minute = 0, dayOfWeek = 1, dayOfMonth = 1 } = options

  switch (preset) {
    case 'hourly':
      return `${minute} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly':
      return `${minute} ${hour} * * ${dayOfWeek}`
    case 'monthly':
      return `${minute} ${hour} ${dayOfMonth} * *`
    default:
      return `0 9 * * *`
  }
}

export function getNextRunTimes(
  cronExpression: string,
  count: number = 5,
  timezone: string = 'UTC'
): Date[] {
  try {
    const crons = cronExpression.split(';').map(c => c.trim()).filter(c => c)
    const allTimes: Date[] = []

    for (const cron of crons) {
      try {
        const interval = CronExpressionParser.parse(cron, {
          currentDate: new Date(),
          tz: timezone
        })

        for (let i = 0; i < count * 2; i++) {
          const next = interval.next()
          allTimes.push(next.toDate())
        }
      } catch {
      }
    }

    const uniqueTimes = [...new Set(allTimes.map(d => d.getTime()))]
      .sort((a, b) => a - b)
      .slice(0, count)
      .map(t => new Date(t))

    return uniqueTimes
  } catch {
    return []
  }
}
