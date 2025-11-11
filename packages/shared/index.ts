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

// AI Categorization Enums
export const CategoryRuleType = z.enum([
  'TITLE_KEYWORD',      // Match based on keywords in event title
  'ATTENDEE_EMAIL',     // Match based on specific attendee email address
  'ATTENDEE_DOMAIN',    // Match based on attendee email domain (e.g., @company.com)
  'CALENDAR_NAME',      // Match based on source Google Calendar ID
  'RECURRING_EVENT_ID', // Match based on Google recurring event ID
])

export const SuggestionOutcome = z.enum([
  'ACCEPTED',  // User accepted the AI suggestion
  'REJECTED',  // User chose a different project (rejected suggestion)
  'IGNORED',   // User skipped/ignored the event entirely
])

// Type exports
export type ProjectInput = z.infer<typeof ProjectSchema>
export type TimesheetEntryInput = z.infer<typeof TimesheetEntrySchema>
export type CategoryRuleType = z.infer<typeof CategoryRuleType>
export type SuggestionOutcome = z.infer<typeof SuggestionOutcome>

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

// Redis client export
export { RedisClient, redisClient } from './redis-client.js'
