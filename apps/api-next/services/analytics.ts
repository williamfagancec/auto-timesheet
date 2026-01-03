/**
 * Analytics Service
 *
 * Tracks and analyzes suggestion engine performance metrics.
 * Provides insights into rule effectiveness and identifies areas for improvement.
 *
 * @module analytics
 * @see docs/AI_ENGINE.md - Analytics & Optimization
 */

import { PrismaClient, CategoryRule, Project } from 'database'
import { CategoryRuleType, redisClient, type SuggestionOutcome } from 'shared'

export type { SuggestionOutcome } from 'shared'
import { CACHE_CONFIG, ANALYTICS_CONFIG as ANALYTICS_CONSTANTS } from 'config'

// SuggestionOutcome is imported from the shared package

/**
 * Time range options for metrics calculation
 */
export type MetricsTimeRange = '7d' | '30d'

/**
 * Time range configuration
 */
interface TimeRangeConfig {
  start: Date
  end: Date
  label: string
}

/**
 * Suggestion performance metrics
 *
 * Provides a comprehensive view of how well the AI is performing.
 */
export interface SuggestionMetrics {
  /** Percentage of suggestions accepted by the user (0.0-1.0) */
  acceptanceRate: number

  /** Average confidence score across all suggestions (0.0-1.0) */
  averageConfidence: number

  /** Ratio of categorized events to total events (0.0-1.0) */
  coverageRate: number

  /** Number of new rules created in the current week */
  newRulesThisWeek: number

  /** Total number of suggestions tracked in the time range */
  totalSuggestions: number

  /** Time range used for these metrics */
  timeRange: string
}

/**
 * Problematic rule pattern
 *
 * Identifies rules that are performing poorly and need attention.
 */
export interface ProblematicPattern {
  /** Rule ID */
  ruleId: string

  /** Type of rule (TITLE_KEYWORD, ATTENDEE_EMAIL, etc.) */
  ruleType: CategoryRuleType

  /** The pattern/condition being matched */
  condition: string

  /** Associated project name */
  projectName: string

  /** Accuracy rate (0.0-1.0) */
  accuracy: number

  /** Total number of suggestions made with this rule */
  totalSuggestions: number

  /** Number of times this rule was accepted */
  acceptedCount: number

  /** Actionable recommendation for improvement */
  recommendation: string
}

/**
 * Alias for imported config (for backward compatibility with existing code)
 */
const ANALYTICS_CONFIG = ANALYTICS_CONSTANTS

/**
 * Log a suggestion event to the database
 *
 * Records user interactions with AI suggestions for analytics and learning.
 * Should be called when users accept, reject, or ignore a suggestion.
 *
 * @param prisma - Prisma client instance
 * @param userId - ID of the user who received the suggestion
 * @param eventId - ID of the calendar event that was categorized
 * @param suggestedProjectId - ID of the project that was suggested by AI
 * @param confidence - Confidence score of the suggestion (0.0-1.0)
 * @param outcome - User's response to the suggestion (ACCEPTED, REJECTED, IGNORED)
 *
 * @example
 * ```typescript
 * // User accepted a suggestion
 * await logSuggestion(prisma, userId, eventId, projectId, 0.85, 'ACCEPTED')
 *
 * // User rejected a suggestion and picked a different project
 * await logSuggestion(prisma, userId, eventId, suggestedProjectId, 0.65, 'REJECTED')
 * ```
 */
export async function logSuggestion(
  prisma: PrismaClient,
  userId: string,
  eventId: string,
  suggestedProjectId: string,
  confidence: number,
  outcome: SuggestionOutcome
): Promise<void> {
  try {
    await prisma.suggestionLog.create({
      data: {
        userId,
        eventId,
        suggestedProjectId,
        confidence,
        outcome,
      },
    })
  } catch (error) {
    console.error('[Analytics] Failed to log suggestion:', error, {
      userId,
      eventId,
      suggestedProjectId,
      outcome,
    })
    // Don't throw - logging failures shouldn't break the user flow
  }
}

/**
 * Calculate suggestion performance metrics for a given time range
 *
 * Computes key performance indicators (KPIs) to track AI effectiveness:
 * - Acceptance rate: How often users accept suggestions
 * - Average confidence: Quality of suggestions being made
 * - Coverage rate: Percentage of events that get categorized
 * - New rules: Learning velocity (how fast the AI is improving)
 *
 * @param prisma - Prisma client instance
 * @param userId - ID of the user to calculate metrics for
 * @param timeRange - Time range for analysis ('7d' or '30d')
 * @returns Comprehensive metrics object
 *
 * @example
 * ```typescript
 * const metrics = await getSuggestionMetrics(prisma, userId, '30d')
 * console.log(`Acceptance rate: ${(metrics.acceptanceRate * 100).toFixed(1)}%`)
 * console.log(`New rules this week: ${metrics.newRulesThisWeek}`)
 * ```
 */
export async function getSuggestionMetrics(
  prisma: PrismaClient,
  userId: string,
  timeRange: MetricsTimeRange = '30d'
): Promise<SuggestionMetrics> {
  // Try cache first
  const cacheKey = `${CACHE_CONFIG.keyPrefixes.analyticsMetrics}:${userId}:${timeRange}`

  if (redisClient.isConnected()) {
    const cached = await redisClient.get<SuggestionMetrics>(cacheKey)
    if (cached) {
      if (CACHE_CONFIG.logCacheHits) {
        console.log(`[Analytics] Cache HIT for metrics: ${userId}:${timeRange}`)
      }
      return cached
    }
  }

  if (CACHE_CONFIG.logCacheHits) {
    console.log(`[Analytics] Cache MISS for metrics: ${userId}:${timeRange}`)
  }

  try {
    const range = getTimeRangeConfig(timeRange)

    // Get suggestion log statistics
    const suggestions = await prisma.suggestionLog.findMany({
      where: {
        userId,
        createdAt: {
          gte: range.start,
          lte: range.end,
        },
      },
      select: {
        confidence: true,
        outcome: true,
      },
    })

    const totalSuggestions = suggestions.length
    const acceptedCount = suggestions.filter(s => s.outcome === 'ACCEPTED').length
    const acceptanceRate = totalSuggestions > 0 ? acceptedCount / totalSuggestions : 0

    // Calculate average confidence
    const totalConfidence = suggestions.reduce((sum, s) => sum + s.confidence, 0)
    const averageConfidence = totalSuggestions > 0 ? totalConfidence / totalSuggestions : 0

    // Calculate coverage rate (% of recent events that have been categorized)
    const coverageStart = new Date()
    coverageStart.setDate(coverageStart.getDate() - ANALYTICS_CONFIG.coverageLookbackDays)

    const [totalEvents, categorizedEvents] = await Promise.all([
      prisma.calendarEvent.count({
        where: {
          userId,
          isDeleted: false,
          startTime: { gte: coverageStart },
        },
      }),
      prisma.timesheetEntry.count({
        where: {
          userId,
          event: {
            startTime: { gte: coverageStart },
          },
        },
      }),
    ])

    const coverageRate = totalEvents > 0 ? categorizedEvents / totalEvents : 0

    // Count new rules created this week
    const oneWeekAgo = new Date()
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)

    const newRulesThisWeek = await prisma.categoryRule.count({
      where: {
        userId,
        createdAt: { gte: oneWeekAgo },
      },
    })

    const metrics: SuggestionMetrics = {
      acceptanceRate,
      averageConfidence,
      coverageRate,
      newRulesThisWeek,
      totalSuggestions,
      timeRange: range.label,
    }

    // Cache the result
    await redisClient.set(
      cacheKey,
      metrics,
      CACHE_CONFIG.analyticsMetricsTtlSeconds
    )

    return metrics
  } catch (error) {
    console.error('[Analytics] Failed to calculate metrics:', error, { userId, timeRange })

    // Return zero values on error (graceful degradation)
    return {
      acceptanceRate: 0,
      averageConfidence: 0,
      coverageRate: 0,
      newRulesThisWeek: 0,
      totalSuggestions: 0,
      timeRange: timeRange === '7d' ? 'Last 7 days' : 'Last 30 days',
    }
  }
}

/**
 * Identify problematic rules and patterns
 *
 * Analyzes CategoryRules to find patterns that are:
 * - Generating suggestions frequently (3+ times)
 * - Being rejected often (< 50% accuracy)
 *
 * Returns actionable recommendations for each problematic pattern.
 *
 * @param prisma - Prisma client instance
 * @param userId - ID of the user to analyze rules for
 * @returns Array of problematic patterns with recommendations
 *
 * @example
 * ```typescript
 * const problems = await getProblematicPatterns(prisma, userId)
 * problems.forEach(p => {
 *   console.log(`${p.ruleType} "${p.condition}": ${(p.accuracy * 100).toFixed(1)}% accuracy`)
 *   console.log(`→ ${p.recommendation}`)
 * })
 * ```
 */
export async function getProblematicPatterns(
  prisma: PrismaClient,
  userId: string
): Promise<ProblematicPattern[]> {
  // Try cache first
  const cacheKey = `${CACHE_CONFIG.keyPrefixes.problematicPatterns}:${userId}`

  if (redisClient.isConnected()) {
    const cached = await redisClient.get<ProblematicPattern[]>(cacheKey)
    if (cached) {
      if (CACHE_CONFIG.logCacheHits) {
        console.log(`[Analytics] Cache HIT for problematic patterns: ${userId}`)
      }
      return cached
    }
  }

  if (CACHE_CONFIG.logCacheHits) {
    console.log(`[Analytics] Cache MISS for problematic patterns: ${userId}`)
  }

  try {
    // Fetch all rules with sufficient data and low accuracy
    const rules = await prisma.categoryRule.findMany({
      where: {
        userId,
        totalSuggestions: {
          gte: ANALYTICS_CONFIG.minSuggestionsForAnalysis,
        },
        accuracy: {
          lt: ANALYTICS_CONFIG.problematicAccuracyThreshold,
        },
      },
      include: {
        project: true,
      },
      orderBy: [
        { accuracy: 'asc' },
        { totalSuggestions: 'desc' },
      ],
    })

      const patterns = rules.map(rule => ({
      ruleId: rule.id,
      ruleType: rule.ruleType as CategoryRuleType,
      condition: rule.condition,
      projectName: rule.project.name,
      accuracy: rule.accuracy,
      totalSuggestions: rule.totalSuggestions,
      acceptedCount: rule.matchCount,
      recommendation: generateRecommendation(rule),
    }))

    await redisClient.set(
      cacheKey,
      patterns,
      CACHE_CONFIG.problematicPatternsTtlSeconds
    )

    return patterns
    
  } catch (error) {
    console.error('[Analytics] Failed to get problematic patterns:', error, { userId })
    return [] // Return empty array on error
  }
}

/**
 * Get time range configuration for a given time range option
 *
 * @internal
 * @param timeRange - Time range option ('7d' or '30d')
 * @returns Time range configuration with start/end dates
 */
function getTimeRangeConfig(timeRange: MetricsTimeRange): TimeRangeConfig {
  const end = new Date()
  const start = new Date()

  if (timeRange === '7d') {
    start.setDate(start.getDate() - 7)
    return { start, end, label: 'Last 7 days' }
  } else {
    start.setDate(start.getDate() - 30)
    return { start, end, label: 'Last 30 days' }
  }
}

/**
 * Generate actionable recommendation for a problematic rule
 *
 * Provides context-aware suggestions based on rule type and performance.
 *
 * @internal
 * @param rule - CategoryRule with project relation
 * @returns Human-readable recommendation
 */
function generateRecommendation(
  rule: CategoryRule & { project: Project }
): string {
  const accuracy = (rule.accuracy * 100).toFixed(0)
  const rejectionRate = 100 - parseFloat(accuracy)

  switch (rule.ruleType) {
    case 'TITLE_KEYWORD':
      if (rule.condition.length < 4) {
        return `Keyword "${rule.condition}" may be too generic. Consider using a longer, more specific keyword.`
      }
      return `Keyword "${rule.condition}" has ${rejectionRate}% rejection rate. This keyword may be too ambiguous or appear in multiple project contexts.`

    case 'ATTENDEE_EMAIL':
      return `Email "${rule.condition}" is often associated with different projects. This person may work across multiple projects.`

    case 'ATTENDEE_DOMAIN':
      return `Domain "${rule.condition}" has ${rejectionRate}% rejection rate. Consider creating more specific rules using individual email addresses instead.`

    case 'CALENDAR_NAME':
      return `Calendar "${rule.condition}" contains events for multiple projects. Consider using more specific patterns like attendees or keywords.`

    case 'RECURRING_EVENT_ID':
      return `This recurring meeting is often categorized differently. The project assignment may have changed over time.`

    default:
      return `This rule has ${rejectionRate}% rejection rate. Consider deleting it or creating a more specific rule.`
  }
}

/**
 * Default export for convenience
 */
export default {
  logSuggestion,
  getSuggestionMetrics,
  getProblematicPatterns,
}
