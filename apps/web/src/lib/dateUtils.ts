import { startOfWeek, endOfWeek, startOfDay, endOfDay, subDays, format } from 'date-fns'

export type DateRangePreset = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'custom'

export interface DateRange {
  startDate: Date
  endDate: Date
}

/**
 * Get start of week (Monday 00:00:00)
 */
export function getStartOfWeek(date: Date = new Date()): Date {
  return startOfWeek(date, { weekStartsOn: 1 }) // 1 = Monday
}

/**
 * Get end of week (Sunday 23:59:59)
 */
export function getEndOfWeek(date: Date = new Date()): Date {
  return endOfWeek(date, { weekStartsOn: 1 })
}

/**
 * Get date range for a preset
 */
export function getDateRangeForPreset(preset: DateRangePreset): DateRange | null {
  const now = new Date()

  switch (preset) {
    case 'today':
      return {
        startDate: startOfDay(now),
        endDate: endOfDay(now),
      }

    case 'yesterday': {
      const yesterday = subDays(now, 1)
      return {
        startDate: startOfDay(yesterday),
        endDate: endOfDay(yesterday),
      }
    }

    case 'this-week':
      return {
        startDate: getStartOfWeek(now),
        endDate: getEndOfWeek(now),
      }

    case 'last-week': {
      const lastWeek = subDays(now, 7)
      return {
        startDate: getStartOfWeek(lastWeek),
        endDate: getEndOfWeek(lastWeek),
      }
    }

    case 'custom':
      return null

    default:
      return null
  }
}

/**
 * Format date range for display
 */
export function formatDateRange(startDate: Date, endDate: Date): string {
  const start = format(startDate, 'MMM d')
  const end = format(endDate, 'MMM d, yyyy')

  if (format(startDate, 'yyyy-MM-dd') === format(endDate, 'yyyy-MM-dd')) {
    return format(startDate, 'MMMM d, yyyy')
  }

  return `${start} - ${end}`
}

/**
 * Calculate duration in minutes between two dates
 */
export function calculateDurationMinutes(startTime: Date, endTime: Date): number {
  return Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60))
}

/**
 * Format duration as hours and minutes
 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  if (hours === 0) {
    return `${mins}m`
  }

  if (mins === 0) {
    return `${hours}h`
  }

  return `${hours}h ${mins}m`
}

/**
 * Format time for display (e.g., "9:00 AM")
 */
export function formatTime(date: Date): string {
  return format(date, 'h:mm a')
}

/**
 * Group items by date
 */
export function groupByDate<T extends { startTime: Date }>(
  items: T[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>()

  for (const item of items) {
    const dateKey = format(item.startTime, 'yyyy-MM-dd')
    const existing = grouped.get(dateKey) || []
    existing.push(item)
    grouped.set(dateKey, existing)
  }

  return grouped
}
