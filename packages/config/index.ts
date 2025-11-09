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
  maxSuggestionsPerEvent: 3,
  learningAccuracyWeight: 0.3,
  minMatchesForRule: 3,

  // Phase 3: Rule type weights (confidence multipliers)
  ruleTypeWeights: {
    RECURRING_EVENT_ID: 1.0,    // Most reliable (same recurring meeting)
    ATTENDEE_EMAIL: 0.9,        // Very specific (exact person)
    ATTENDEE_DOMAIN: 0.7,       // Domain-level patterns (company/org)
    CALENDAR_NAME: 0.6,         // Calendar-based patterns
    TITLE_KEYWORD: 0.5,         // Least specific (keywords can be generic)
  },

  // Phase 3: Recency bonus (rewards recently used rules)
  recentMatchBonus: 0.1,        // +10% confidence boost
  recentMatchDays: 7,           // Matches within 7 days are "recent"

  // Phase 3: Stale rule penalty (penalizes unused rules)
  staleRuleDays: 30,            // Rules unused for 30+ days are "stale"
  staleRulePenalty: 0.1,        // -10% confidence penalty
} as const
