import { router, protectedProcedure } from '../lib/trpc'
import { z } from 'zod'
import { prisma } from 'database'
import { TRPCError } from '@trpc/server'
import {
  getSuggestionMetrics,
  getProblematicPatterns,
  type MetricsTimeRange,
} from '../../services/analytics.js'

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

/**
 * Input schema for analytics.metrics
 */
const metricsInputSchema = z.object({
  timeRange: z.enum(['7d', '30d']).optional().default('30d'),
})

// =============================================================================
// ROUTER
// =============================================================================

export const analyticsRouter = router({
  /**
   * Get suggestion performance metrics
   *
   * Returns comprehensive metrics about AI suggestion performance:
   * - Acceptance rate: How often users accept AI suggestions
   * - Average confidence: Quality of suggestions being made
   * - Coverage rate: Percentage of events that get categorized
   * - New rules created: Learning velocity
   * - Total suggestions tracked
   *
   * @example
   * Input: { timeRange: '30d' }
   * Output: {
   *   acceptanceRate: 0.68,
   *   averageConfidence: 0.74,
   *   coverageRate: 0.82,
   *   newRulesThisWeek: 3,
   *   totalSuggestions: 145,
   *   timeRange: 'Last 30 days'
   * }
   */
  metrics: protectedProcedure
    .input(metricsInputSchema)
    .query(async ({ ctx, input }) => {
      try {
        const metrics = await getSuggestionMetrics(
          prisma,
          ctx.user.id,
          input.timeRange as MetricsTimeRange
        )

        return metrics
      } catch (error) {
        console.error('[Analytics] Metrics error:', error, {
          userId: ctx.user.id,
          timeRange: input.timeRange,
        })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch analytics metrics',
        })
      }
    }),

  /**
   * Get problematic patterns that need attention
   *
   * Identifies rules and keywords that are:
   * - Generating suggestions frequently (3+ times)
   * - Being rejected often (< 50% accuracy)
   *
   * Returns actionable recommendations for each problematic pattern.
   *
   * @example
   * Output: [
   *   {
   *     ruleId: 'rule_abc',
   *     ruleType: 'TITLE_KEYWORD',
   *     condition: 'meeting',
   *     projectName: 'Engineering',
   *     accuracy: 0.33,
   *     totalSuggestions: 12,
   *     acceptedCount: 4,
   *     recommendation: 'Keyword "meeting" may be too generic. Consider using a longer, more specific keyword.'
   *   }
   * ]
   */
  problematicPatterns: protectedProcedure.query(async ({ ctx }) => {
    try {
      const patterns = await getProblematicPatterns(prisma, ctx.user.id)

      return patterns
    } catch (error) {
      console.error('[Analytics] Problematic patterns error:', error, {
        userId: ctx.user.id,
      })

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch problematic patterns',
      })
    }
  }),
})
