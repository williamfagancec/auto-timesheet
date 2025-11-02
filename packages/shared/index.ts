import { z } from 'zod'

// Common Zod schemas for validation
export const ProjectSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Project name is required'),
  isArchived: z.boolean().default(false),
})

export const TimesheetEntrySchema = z.object({
  id: z.string().optional(),
  eventId: z.string().optional(),
  projectId: z.string().optional(),
  date: z.date(),
  duration: z.number().min(0),
  isManual: z.boolean().default(false),
  isSkipped: z.boolean().default(false),
  notes: z.string().optional(),
})

export const CategoryRuleType = z.enum([
  'title_keyword',
  'attendee_email',
  'calendar_name',
  'recurring_event',
])

// Type exports
export type ProjectInput = z.infer<typeof ProjectSchema>
export type TimesheetEntryInput = z.infer<typeof TimesheetEntrySchema>
export type CategoryRuleType = z.infer<typeof CategoryRuleType>

// Utility functions
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

export function calculateWeekRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date)
  start.setDate(start.getDate() - start.getDay())
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  end.setHours(23, 59, 59, 999)

  return { start, end }
}
