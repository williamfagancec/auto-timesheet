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

  // Edge case handling
  coldStartMinCategorizations: 5,   // Minimum categorizations before showing suggestions
  conflictConfidencePenalty: 0.05,  // -5% when multiple projects have similar confidence
  conflictThreshold: 0.05,          // Projects within 5% confidence are "conflicting"
  ambiguousKeywordThreshold: 3,     // Keyword is ambiguous if it maps to 3+ different projects
  ambiguousKeywordPenalty: 0.15,    // -15% confidence for ambiguous keywords
  minRuleTypesForAmbiguous: 2,      // Require 2+ rule types when keyword is ambiguous
} as const

export const CACHE_CONFIG = {
  // Rule cache (AI categorization rules per user)
  ruleCacheTtlSeconds: 5 * 60,           // 5 minutes

  // Analytics metrics cache (dashboard performance metrics)
  analyticsMetricsTtlSeconds: 10 * 60,   // 10 minutes

  // Problematic patterns cache (underperforming rules analysis)
  problematicPatternsTtlSeconds: 15 * 60, // 15 minutes

  // Pattern extraction cache (event pattern computations)
  patternExtractionTtlSeconds: 10 * 60,  // 10 minutes

  // Cache key prefixes (for organized Redis namespacing)
  keyPrefixes: {
    rules: 'rules',
    analyticsMetrics: 'analytics:metrics',
    problematicPatterns: 'analytics:patterns',
    patternExtraction: 'patterns',
  },

  // Observability settings
  logCacheHits: process.env.NODE_ENV === 'development', // Log hits/misses in dev only
} as const

export const ANALYTICS_CONFIG = {
  // Minimum suggestions required for rule performance analysis
  minSuggestionsForAnalysis: 3,

  // Accuracy threshold for identifying problematic rules
  problematicAccuracyThreshold: 0.5, // <50% accuracy

  // Lookback period for coverage calculations
  coverageLookbackDays: 30,
} as const

export const DEFAULT_USER_PROJECT_VALUES = {
  isBillable: true,
  phase: null,
} as const
