// Shared configuration values

export const APP_CONFIG = {
  name: 'Auto Timesheet',
  version: '0.1.0',
} as const

export const API_CONFIG = {
  defaultPort: 3001,
  rateLimitPerMinute: 100,
  sessionMaxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
} as const

export const CALENDAR_CONFIG = {
  syncIntervalMinutes: 15,
  cacheTimeMinutes: 15,
  defaultFetchWeeks: 1,
} as const

export const AI_CONFIG = {
  minConfidenceThreshold: 0.5,
  learningAccuracyWeight: 0.3,
  minMatchesForRule: 3,
} as const
