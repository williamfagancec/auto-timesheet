import { router, protectedProcedure } from '../trpc.js'
import { z } from 'zod'
import { prisma } from 'database'
import { TRPCError } from '@trpc/server'
import { getSuggestionsForEvent } from '../services/ai-categorization.js'
import {
  handleCategorizationFeedback,
  getDebugInfo,
} from '../services/learning.js'
import { logSuggestion, type SuggestionOutcome } from '../services/analytics.js'

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

/**
 * Input schema for suggestions.generate
 */
const generateInputSchema = z.object({
  eventIds: z
    .array(z.string().cuid())
    .min(1, 'At least one event ID is required')
    .max(100, 'Maximum 100 events per batch'),
})

/**
 * Input schema for suggestions.feedback
 */
const feedbackInputSchema = z.object({
  eventId: z.string().cuid(),
  selectedProjectId: z.string().cuid(),
  suggestedProjectId: z.string().cuid().nullable().optional(),
  suggestedConfidence: z.number().min(0).max(1).optional(),
})

// =============================================================================
// OUTPUT TYPES
// =============================================================================

/**
 * Suggestion output format
 * Note: Currently unused, but kept for future validation
 */
// @ts-expect-error - Kept for future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const suggestionSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  confidence: z.number(),
  reasoning: z.array(z.string()),
})

// =============================================================================
// ROUTER
// =============================================================================

export const suggestionsRouter = router({
  /**
   * Generate AI suggestions for multiple events (batch processing)
   *
   * Returns a map of eventId -> Suggestion for each event that has a high-confidence
   * suggestion (>50%). Events without suggestions are not included in the result.
   *
   * @example
   * Input: { eventIds: ['evt1', 'evt2', 'evt3'] }
   * Output: {
   *   'evt1': { projectId: 'proj_abc', projectName: 'Engineering', confidence: 0.85, ... },
   *   'evt2': { projectId: 'proj_def', projectName: 'Marketing', confidence: 0.72, ... }
   * }
   * // Note: evt3 has no suggestion (confidence <50%)
   */
  generate: protectedProcedure
    .input(generateInputSchema)
    .query(async ({ ctx, input }) => {
      try {
        // Fetch all events in batch
        const events = await prisma.calendarEvent.findMany({
          where: {
            id: { in: input.eventIds },
            userId: ctx.user.id,
            isDeleted: false,
          },
          select: {
            id: true,
            title: true,
            googleEventId: true,
            calendarId: true,
            attendees: true,
          },
        })

        // Verify all requested events exist and belong to user
        if (events.length !== input.eventIds.length) {
          const foundIds = new Set(events.map(e => e.id))
          const missingIds = input.eventIds.filter(id => !foundIds.has(id))
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Events not found or do not belong to user: ${missingIds.join(', ')}`,
          })
        }

        // Generate suggestions for each event in parallel
        const suggestionPromises = events.map(async (event) => {
          const suggestions = await getSuggestionsForEvent(prisma, ctx.user.id, {
            id: event.id,
            title: event.title,
            googleEventId: event.googleEventId,
            calendarId: event.calendarId,
            attendees: event.attendees as Array<{ email: string; responseStatus?: string }> | undefined,
          })

          // Return top suggestion if it exists (getSuggestionsForEvent returns up to 3, sorted by confidence)
          if (suggestions.length > 0) {
            const topSuggestion = suggestions[0]
            return {
              eventId: event.id,
              suggestion: {
                projectId: topSuggestion.projectId,
                projectName: topSuggestion.project.name,
                confidence: topSuggestion.confidence,
                reasoning: topSuggestion.reasoning,
              },
            }
          }

          return null
        })

        const results = await Promise.all(suggestionPromises)

        // Build map of eventId -> Suggestion (excluding nulls)
        const suggestionMap: Record<string, {
          projectId: string
          projectName: string
          confidence: number
          reasoning: string[]
        }> = {}

        for (const result of results) {
          if (result) {
            suggestionMap[result.eventId] = result.suggestion
          }
        }

        return suggestionMap
      } catch (error) {
        // Re-throw TRPCError as-is
        if (error instanceof TRPCError) {
          throw error
        }

        console.error('[Suggestions] Generate error:', error, {
          userId: ctx.user.id,
          eventIds: input.eventIds,
        })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to generate suggestions',
        })
      }
    }),

  /**
   * Submit feedback on a suggestion (or manual categorization)
   *
   * This endpoint enables the learning loop by calling the LearningService when
   * a user categorizes an event (either by accepting a suggestion or manually selecting).
   *
   * @example
   * // User accepted a suggestion
   * feedback({ eventId: 'evt1', selectedProjectId: 'proj_abc', suggestedProjectId: 'proj_abc' })
   *
   * // User rejected suggestion and picked different project
   * feedback({ eventId: 'evt1', selectedProjectId: 'proj_def', suggestedProjectId: 'proj_abc' })
   *
   * // User manually categorized (no suggestion)
   * feedback({ eventId: 'evt1', selectedProjectId: 'proj_abc' })
   */
  feedback: protectedProcedure
    .input(feedbackInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Verify event exists and belongs to user
        const event = await prisma.calendarEvent.findFirst({
          where: {
            id: input.eventId,
            userId: ctx.user.id,
            isDeleted: false,
          },
        })

        if (!event) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Event not found or does not belong to user',
          })
        }

        // Verify selected project exists and belongs to user
        const project = await prisma.project.findFirst({
          where: {
            id: input.selectedProjectId,
            userId: ctx.user.id,
          },
        })

        if (!project) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Project not found or does not belong to user',
          })
        }

        // If suggestedProjectId provided, verify it exists
        if (input.suggestedProjectId) {
          const suggestedProject = await prisma.project.findFirst({
            where: {
              id: input.suggestedProjectId,
              userId: ctx.user.id,
            },
          })

          if (!suggestedProject) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'Suggested project not found or does not belong to user',
            })
          }
        }

        // Get rules BEFORE feedback (for counting)
        const rulesBefore = await prisma.categoryRule.count({
          where: { userId: ctx.user.id },
        })

        // Call LearningService to handle feedback
        await handleCategorizationFeedback(
          prisma,
          input.eventId,
          input.selectedProjectId,
          input.suggestedProjectId ?? null,
          ctx.user.id
        )

        // Log suggestion outcome for analytics (only if there was a suggestion)
        if (input.suggestedProjectId) {
          try {
            // Determine outcome
            const outcome: SuggestionOutcome =
              input.suggestedProjectId === input.selectedProjectId
                ? 'ACCEPTED'
                : 'REJECTED'

            // Use confidence from input if available, otherwise skip logging
            const confidence = input.suggestedConfidence
            if (confidence !== undefined) {
              await logSuggestion(
                prisma,
                ctx.user.id,
                input.eventId,
                input.suggestedProjectId,
                confidence,
                outcome
              )
            }
          } catch (logError) {
            // Don't fail the request if logging fails
            console.error('[Suggestions] Analytics logging error:', logError, {
              userId: ctx.user.id,
              eventId: input.eventId,
            })
          }
        }

        // Get rules AFTER feedback (for counting)
        const rulesAfter = await prisma.categoryRule.count({
          where: { userId: ctx.user.id },
        })

        const rulesCreated = rulesAfter - rulesBefore
        const rulesUpdated = rulesCreated > 0 ? 0 : 1 // If no new rules, assume existing were updated

        return {
          rulesCreated,
          rulesUpdated,
        }
      } catch (error) {
        // Re-throw TRPCError as-is
        if (error instanceof TRPCError) {
          throw error
        }

        console.error('[Suggestions] Feedback error:', error, {
          userId: ctx.user.id,
          eventId: input.eventId,
        })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to submit feedback',
        })
      }
    }),

  /**
   * Get suggestion engine metrics for dashboard display
   *
   * Returns:
   * - accuracyRate: Overall accuracy across all rules (0.0-1.0)
   * - coverageRate: Percentage of events with suggestions (0.0-1.0)
   * - activeRulesCount: Total number of active rules
   * - rulesByType: Breakdown of rules by type
   * - totalSuggestions: Total suggestions made
   * - totalMatches: Total suggestions accepted
   *
   * @example
   * Output: {
   *   accuracyRate: 0.73,
   *   coverageRate: 0.82,
   *   activeRulesCount: 42,
   *   rulesByType: { RECURRING_EVENT_ID: 8, ATTENDEE_EMAIL: 15, ... },
   *   totalSuggestions: 156,
   *   totalMatches: 114
   * }
   */
  metrics: protectedProcedure.query(async ({ ctx }) => {
    try {
      // Get debug info from learning service (contains all stats)
      const debugInfo = await getDebugInfo(prisma, ctx.user.id)

      // Calculate coverage rate: % of recent events with suggestions
      // Look at events from the last 30 days
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const recentEvents = await prisma.calendarEvent.count({
        where: {
          userId: ctx.user.id,
          isDeleted: false,
          startTime: { gte: thirtyDaysAgo },
        },
      })

      // Count events with timesheet entries (categorized)
      const categorizedEvents = await prisma.timesheetEntry.count({
        where: {
          userId: ctx.user.id,
          event: {
            startTime: { gte: thirtyDaysAgo },
          },
        },
      })

      const coverageRate = recentEvents > 0 ? categorizedEvents / recentEvents : 0

      return {
        accuracyRate: debugInfo.overallAccuracy,
        coverageRate,
        activeRulesCount: debugInfo.totalRules,
        rulesByType: debugInfo.rulesByType,
        totalSuggestions: debugInfo.totalSuggestions,
        totalMatches: debugInfo.totalMatches,
      }
    } catch (error) {
      console.error('[Suggestions] Metrics error:', error, {
        userId: ctx.user.id,
      })

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch metrics',
      })
    }
  }),
})
