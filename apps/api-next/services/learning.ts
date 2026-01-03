/**
 * Learning Service
 *
 * Handles user feedback for the AI categorization engine.
 * Creates, strengthens, and penalizes CategoryRule records based on user actions.
 *
 * @module learning
 * @see docs/AI_ENGINE.md Phase 5: Learning & Feedback
 */

import { PrismaClient, PrismaClientKnownRequestError } from 'database'
import { CategoryRuleType } from 'shared'
import { extractPatternsFromEvent, type CalendarEventInput } from './ai-categorization'

/**
 * Extracted pattern from event
 *
 * Used internally to represent patterns that can be turned into rules.
 */
interface ExtractedPattern {
  ruleType: CategoryRuleType
  condition: string
}

/**
 * Rule type priority order (highest to lowest)
 *
 * Used to determine which rules to create when multiple patterns match.
 * Higher priority rules are more specific and reliable.
 */
const RULE_TYPE_PRIORITY: Record<CategoryRuleType, number> = {
  RECURRING_EVENT_ID: 5,
  ATTENDEE_EMAIL: 4,
  ATTENDEE_DOMAIN: 3,
  TITLE_KEYWORD: 2,
  CALENDAR_NAME: 1,
}

/**
 * Learning configuration constants
 */
const LEARNING_CONFIG = {
  maxConfidence: 0.95,          // Cap confidence at 95%
  minConfidence: 0.30,          // Floor confidence at 30%
  confidenceBoost: 0.10,        // +10% when rule is correct
  confidencePenalty: 0.10,      // -10% when rule is wrong
  initialConfidence: 0.60,      // Starting confidence for new rules
}

/**
 * Handle user categorization feedback.
 *
 * This is the main entry point for learning from user actions. It:
 * 1. Determines if the user accepted, rejected, or manually categorized
 * 2. Penalizes rules that led to wrong suggestion (if applicable)
 * 3. Strengthens rules for the correct project
 * 4. Updates rule statistics
 *
 * @param prisma - Prisma client instance
 * @param eventId - Calendar event ID that was categorized
 * @param selectedProjectId - Project ID the user selected
 * @param suggestedProjectId - Project ID that was suggested (null if no suggestion)
 * @param userId - User ID
 *
 * @example
 * ```typescript
 * // User accepted a suggestion
 * await handleCategorizationFeedback(
 *   prisma, 'evt_123', 'proj_abc', 'proj_abc', 'user_xyz'
 * )
 *
 * // User rejected suggestion and selected different project
 * await handleCategorizationFeedback(
 *   prisma, 'evt_123', 'proj_def', 'proj_abc', 'user_xyz'
 * )
 *
 * // User manually categorized (no suggestion)
 * await handleCategorizationFeedback(
 *   prisma, 'evt_123', 'proj_abc', null, 'user_xyz'
 * )
 * ```
 */
export async function handleCategorizationFeedback(
  prisma: PrismaClient,
  eventId: string,
  selectedProjectId: string,
  suggestedProjectId: string | null,
  userId: string
): Promise<{ created: number; updated: number }> {
  try {
    // Fetch the event with all its data
    const event = await prisma.calendarEvent.findUnique({
      where: { id: eventId },
    })

    if (!event) {
      console.error('[Learning] Event not found:', eventId)
      return { created: 0, updated: 0 }
    }

    // Convert to CalendarEventInput format
    const eventInput: CalendarEventInput = {
      id: event.id,
      title: event.title,
      attendees: event.attendees as Array<{ email: string; responseStatus?: string }> | undefined,
      calendarId: event.calendarId,
      googleEventId: event.googleEventId,
    }

    // Extract patterns from the event
    const patterns = extractPatternsFromEvent(eventInput)

    let totalUpdated = 0

    // Scenario 1: User rejected suggestion (suggested different project)
    if (suggestedProjectId && suggestedProjectId !== selectedProjectId) {
      // Penalize rules that led to wrong suggestion
      const penaltyResult = await penalizeIncorrectRules(prisma, userId, patterns, suggestedProjectId)
      totalUpdated += penaltyResult.updated
    }

    // Scenario 2 & 3: Always strengthen rules for the correct project
    // (whether suggestion was accepted or user manually categorized)
    const strengthenResult = await strengthenRules(prisma, userId, patterns, selectedProjectId, eventInput)

    return {
      created: strengthenResult.created,
      updated: totalUpdated + strengthenResult.updated,
    }

  } catch (error) {
    console.error('[Learning] Feedback handling error:', error, {
      eventId,
      selectedProjectId,
      suggestedProjectId,
      userId,
    })
    return { created: 0, updated: 0 }
  }
}

/**
 * Strengthen rules for the correct project.
 *
 * Creates new rules or boosts confidence for existing rules that match
 * the event patterns. Uses priority order to determine which patterns to learn.
 *
 * @param prisma - Prisma client instance
 * @param userId - User ID
 * @param patterns - Extracted patterns from event
 * @param projectId - Correct project ID
 * @param event - Calendar event (for lastMatchedAt timestamp)
 * @returns Object with counts of created and updated rules
 *
 * @example
 * ```typescript
 * const patterns = [
 *   { ruleType: 'TITLE_KEYWORD', condition: 'standup' },
 *   { ruleType: 'ATTENDEE_EMAIL', condition: 'team@acme.com' },
 * ]
 *
 * const result = await strengthenRules(prisma, userId, patterns, projectId, event)
 * // Returns: { created: 1, updated: 1 }
 * // Creates or updates rules:
 * // - ATTENDEE_EMAIL: "team@acme.com" → projectId (higher priority)
 * // - TITLE_KEYWORD: "standup" → projectId (lower priority)
 * ```
 */
export async function strengthenRules(
  prisma: PrismaClient,
  userId: string,
  patterns: ExtractedPattern[],
  projectId: string,
  // @ts-expect-error - Reserved for future use
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  event: CalendarEventInput
): Promise<{ created: number; updated: number }> {
  try {
    if (patterns.length === 0) {
      console.warn('[Learning] No patterns to strengthen')
      return { created: 0, updated: 0 }
    }

    // Sort patterns by priority (highest first)
    const sortedPatterns = [...patterns].sort((a, b) => {
      return RULE_TYPE_PRIORITY[b.ruleType] - RULE_TYPE_PRIORITY[a.ruleType]
    })

    const now = new Date()
    let created = 0
    let updated = 0

    // Process each pattern using atomic create-or-update to avoid race conditions
    for (const pattern of sortedPatterns) {
      try {
        // Attempt atomic create first (optimistic approach)
        await prisma.categoryRule.create({
          data: {
            userId,
            ruleType: pattern.ruleType,
            condition: pattern.condition,
            projectId,
            confidenceScore: LEARNING_CONFIG.initialConfidence,
            matchCount: 1,
            accuracy: 0,
            totalSuggestions: 0,
            lastMatchedAt: now,
          },
        })
        created++
      } catch (error) {
        // If unique constraint violation (P2002), rule already exists - update it
        if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
          await prisma.categoryRule.update({
            where: {
              userId_ruleType_condition_projectId: {
                userId,
                ruleType: pattern.ruleType,
                condition: pattern.condition,
                projectId,
              },
            },
            data: {
              // Boost confidence by 10%, capped at 95%
              confidenceScore: {
                increment: LEARNING_CONFIG.confidenceBoost,
              },
              matchCount: {
                increment: 1,
              },
              lastMatchedAt: now,
              updatedAt: now,
            },
          })
          updated++
        } else {
          // Rethrow any other errors (database errors, connection issues, etc.)
          throw error
        }
      }
    }

    // After upserting, we need to cap confidence at 95%
    // Prisma doesn't support conditional increments, so we do a separate update
    await prisma.$executeRaw`
      UPDATE "CategoryRule"
      SET "confidenceScore" = ${LEARNING_CONFIG.maxConfidence}
      WHERE "userId" = ${userId}
        AND "projectId" = ${projectId}
        AND "confidenceScore" > ${LEARNING_CONFIG.maxConfidence}
    `

    return { created, updated }

  } catch (error) {
    console.error('[Learning] Rule strengthening error:', error, {
      userId,
      projectId,
      patternCount: patterns.length,
    })
    return { created: 0, updated: 0 }
  }
}

/**
 * Penalize rules that led to an incorrect suggestion.
 *
 * Decreases confidence for rules that matched the event but pointed to
 * the wrong project. Confidence is decreased by 10%, floored at 30%.
 *
 * @param prisma - Prisma client instance
 * @param userId - User ID
 * @param patterns - Extracted patterns from event
 * @param wrongProjectId - Project ID that was incorrectly suggested
 * @returns Object with count of updated rules
 *
 * @example
 * ```typescript
 * const patterns = [
 *   { ruleType: 'TITLE_KEYWORD', condition: 'meeting' },
 *   { ruleType: 'ATTENDEE_EMAIL', condition: 'john@acme.com' },
 * ]
 *
 * const result = await penalizeIncorrectRules(prisma, userId, patterns, 'wrong_proj_123')
 * // Returns: { updated: 2 }
 * // Finds rules that match these patterns + wrongProjectId
 * // Decreases their confidence by 10%, minimum 30%
 * ```
 */
export async function penalizeIncorrectRules(
  prisma: PrismaClient,
  userId: string,
  patterns: ExtractedPattern[],
  wrongProjectId: string
): Promise<{ updated: number }> {
  try {
    if (patterns.length === 0) {
      console.warn('[Learning] No patterns to penalize')
      return { updated: 0 }
    }

    // Find all rules that match the patterns and wrong project
    const incorrectRules = await prisma.categoryRule.findMany({
      where: {
        userId,
        projectId: wrongProjectId,
        OR: patterns.map(pattern => ({
          ruleType: pattern.ruleType,
          condition: pattern.condition,
        })),
      },
    })

    if (incorrectRules.length === 0) {
      console.warn('[Learning] No incorrect rules found to penalize')
      return { updated: 0 }
    }

    // Update each rule: decrease confidence by 10%, floor at 30%
    for (const rule of incorrectRules) {
      const newConfidence = Math.max(
        rule.confidenceScore - LEARNING_CONFIG.confidencePenalty,
        LEARNING_CONFIG.minConfidence
      )

      await prisma.categoryRule.update({
        where: { id: rule.id },
        data: {
          confidenceScore: newConfidence,
          totalSuggestions: {
            increment: 1,
          },
          // Recalculate accuracy: this was a failed suggestion
          // accuracy = successful matches / total suggestions
          // We don't increment matchCount because this was a failure
          accuracy: rule.matchCount / (rule.totalSuggestions + 1),
          updatedAt: new Date(),
        },
      })
    }

    console.log('[Learning] Penalized incorrect rules:', {
      count: incorrectRules.length,
      wrongProjectId,
    })

    return { updated: incorrectRules.length }

  } catch (error) {
    console.error('[Learning] Rule penalization error:', error, {
      userId,
      wrongProjectId,
      patternCount: patterns.length,
    })
    return { updated: 0 }
  }
}

/**
 * Update rule accuracy when a suggestion is made.
 *
 * Called by the suggestion generation system to track whether a suggestion
 * was accepted or rejected. Updates accuracy, totalSuggestions, and matchCount.
 *
 * @param prisma - Prisma client instance
 * @param ruleId - CategoryRule ID to update
 * @param wasAccepted - Whether user accepted the suggestion
 *
 * @example
 * ```typescript
 * // Suggestion was accepted
 * await updateRuleAccuracy(prisma, 'rule_123', true)
 *
 * // Suggestion was rejected
 * await updateRuleAccuracy(prisma, 'rule_123', false)
 * ```
 */
export async function updateRuleAccuracy(
  prisma: PrismaClient,
  ruleId: string,
  wasAccepted: boolean
): Promise<void> {
  try {
    const rule = await prisma.categoryRule.findUnique({
      where: { id: ruleId },
    })

    if (!rule) {
      console.error('[Learning] Rule not found for accuracy update:', ruleId)
      return
    }

    // Calculate new accuracy using weighted average formula
    // newAccuracy = (accuracy * totalSuggestions + (wasAccepted ? 1 : 0)) / (totalSuggestions + 1)
    const totalMatches = wasAccepted ? rule.matchCount + 1 : rule.matchCount
    const newTotalSuggestions = rule.totalSuggestions + 1
    const newAccuracy = totalMatches / newTotalSuggestions

    await prisma.categoryRule.update({
      where: { id: ruleId },
      data: {
        accuracy: newAccuracy,
        matchCount: wasAccepted ? { increment: 1 } : rule.matchCount,
        totalSuggestions: { increment: 1 },
        lastMatchedAt: new Date(),
        updatedAt: new Date(),
      },
    })

  } catch (error) {
    console.error('[Learning] Accuracy update error:', error, { ruleId, wasAccepted })
  }
}

// =============================================================================
// RULE MANAGEMENT
// =============================================================================

/**
 * Prune ineffective rules to maintain quality.
 *
 * Deletes rules that:
 * 1. Have accuracy < 40% after 10+ suggestions (consistently wrong)
 * 2. Are associated with deleted projects
 *
 * This helps prevent the rule database from growing too large and keeps
 * suggestions accurate by removing consistently poor-performing rules.
 *
 * @param prisma - Prisma client instance
 * @param userId - User ID
 * @returns Object with count of deleted rules and breakdown by reason
 *
 * @example
 * ```typescript
 * const result = await pruneIneffectiveRules(prisma, 'user_xyz')
 * // Returns: { total: 12, lowAccuracy: 5, deletedProjects: 7 }
 * ```
 */
export async function pruneIneffectiveRules(
  prisma: PrismaClient,
  userId: string
): Promise<{ total: number; lowAccuracy: number; deletedProjects: number }> {
  try {
    // Find rules with low accuracy (< 40%) after at least 10 suggestions
    const lowAccuracyRules = await prisma.categoryRule.findMany({
      where: {
        userId,
        accuracy: { lt: 0.4 },
        totalSuggestions: { gte: 10 },
      },
      select: { id: true },
    })

    // Delete low accuracy rules
    const lowAccuracyResult = await prisma.categoryRule.deleteMany({
      where: {
        id: { in: lowAccuracyRules.map(r => r.id) },
      },
    })

    // Find and delete rules for projects that no longer exist
    // This uses a subquery to find rules where the project has been deleted
    const deletedProjectsResult = await prisma.$executeRaw`
      DELETE FROM "CategoryRule"
      WHERE "userId" = ${userId}
        AND "projectId" NOT IN (
          SELECT "id" FROM "Project" WHERE "userId" = ${userId}
        )
    `

    const total = lowAccuracyResult.count + Number(deletedProjectsResult)

    console.log('[Learning] Pruned ineffective rules:', {
      userId,
      total,
      lowAccuracy: lowAccuracyResult.count,
      deletedProjects: Number(deletedProjectsResult),
    })

    return {
      total,
      lowAccuracy: lowAccuracyResult.count,
      deletedProjects: Number(deletedProjectsResult),
    }
  } catch (error) {
    console.error('[Learning] Rule pruning error:', error, { userId })
    return { total: 0, lowAccuracy: 0, deletedProjects: 0 }
  }
}

/**
 * Handle project archival by filtering rules in suggestion generation.
 *
 * NOTE: This function serves as a placeholder and documentation.
 * Rules for archived projects are NOT deleted because projects might be unarchived.
 * Instead, the suggestion engine (getSuggestionsForEvent) should filter out
 * rules where project.isArchived = true.
 *
 * Future enhancement: Add an `isActive` field to CategoryRule schema to
 * explicitly mark rules as inactive when projects are archived.
 *
 * @param prisma - Prisma client instance
 * @param projectId - Project ID that was archived
 *
 * @example
 * ```typescript
 * // When a project is archived:
 * await handleProjectArchival(prisma, 'proj_abc')
 * // Rules remain in database but won't be used in suggestions
 * ```
 */
export async function handleProjectArchival(
  prisma: PrismaClient,
  projectId: string
): Promise<void> {
  try {
    // Verify the project exists and is archived
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, isArchived: true, name: true },
    })

    if (!project) {
      console.error('[Learning] Project not found for archival:', projectId)
      return
    }

    if (!project.isArchived) {
      console.warn('[Learning] Project is not archived:', projectId)
      return
    }

    // Count rules that will be excluded from suggestions
    const ruleCount = await prisma.categoryRule.count({
      where: { projectId },
    })

    console.log('[Learning] Project archived, rules will be excluded from suggestions:', {
      projectId,
      projectName: project.name,
      ruleCount,
      note: 'Rules not deleted - project might be unarchived',
    })

    // NOTE: We intentionally do NOT delete or modify rules here.
    // The suggestion engine should filter out archived projects.
    // See: ai-categorization.ts getSuggestionsForEvent()

  } catch (error) {
    console.error('[Learning] Project archival handling error:', error, { projectId })
  }
}

/**
 * Get debug information about user's rules and accuracy metrics.
 *
 * Returns comprehensive statistics for debugging and monitoring the AI
 * categorization system. Useful for understanding rule quality and
 * identifying patterns in user categorization behavior.
 *
 * @param prisma - Prisma client instance
 * @param userId - User ID
 * @returns Debug info with rules and aggregate statistics
 *
 * @example
 * ```typescript
 * const debug = await getDebugInfo(prisma, 'user_xyz')
 * // Returns:
 * // {
 * //   totalRules: 42,
 * //   rulesByType: { RECURRING_EVENT_ID: 8, ATTENDEE_EMAIL: 15, ... },
 * //   overallAccuracy: 0.73,
 * //   totalSuggestions: 156,
 * //   totalMatches: 114,
 * //   rules: [ { id, ruleType, condition, projectName, confidence, accuracy, ... } ]
 * // }
 * ```
 */
export async function getDebugInfo(
  prisma: PrismaClient,
  userId: string
): Promise<{
  totalRules: number
  rulesByType: Record<string, number>
  overallAccuracy: number
  totalSuggestions: number
  totalMatches: number
  rules: Array<{
    id: string
    ruleType: string
    condition: string
    projectId: string
    projectName: string
    projectArchived: boolean
    confidenceScore: number
    accuracy: number
    matchCount: number
    totalSuggestions: number
    lastMatchedAt: Date | null
    createdAt: Date
  }>
}> {
  try {
    // Fetch all rules with project information
    const rules = await prisma.categoryRule.findMany({
      where: { userId },
      include: {
        project: {
          select: { name: true, isArchived: true },
        },
      },
      orderBy: [
        { accuracy: 'desc' },
        { totalSuggestions: 'desc' },
      ],
    })

    // Calculate aggregate statistics
    const rulesByType: Record<string, number> = {}
    let totalSuggestions = 0
    let totalMatches = 0

    for (const rule of rules) {
      // Count by type
      rulesByType[rule.ruleType] = (rulesByType[rule.ruleType] || 0) + 1

      // Aggregate totals
      totalSuggestions += rule.totalSuggestions
      totalMatches += rule.matchCount
    }

    // Calculate overall accuracy
    const overallAccuracy = totalSuggestions > 0
      ? totalMatches / totalSuggestions
      : 0

    // Format rules for output
    const formattedRules = rules.map(rule => ({
      id: rule.id,
      ruleType: rule.ruleType,
      condition: rule.condition,
      projectId: rule.projectId,
      projectName: rule.project.name,
      projectArchived: rule.project.isArchived,
      confidenceScore: rule.confidenceScore,
      accuracy: rule.accuracy,
      matchCount: rule.matchCount,
      totalSuggestions: rule.totalSuggestions,
      lastMatchedAt: rule.lastMatchedAt,
      createdAt: rule.createdAt,
    }))

    const debugInfo = {
      totalRules: rules.length,
      rulesByType,
      overallAccuracy,
      totalSuggestions,
      totalMatches,
      rules: formattedRules,
    }

    console.log('[Learning] Debug info retrieved:', {
      userId,
      totalRules: debugInfo.totalRules,
      overallAccuracy: debugInfo.overallAccuracy.toFixed(2),
    })

    return debugInfo
  } catch (error) {
    console.error('[Learning] Debug info error:', error, { userId })
    return {
      totalRules: 0,
      rulesByType: {},
      overallAccuracy: 0,
      totalSuggestions: 0,
      totalMatches: 0,
      rules: [],
    }
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  handleCategorizationFeedback,
  strengthenRules,
  penalizeIncorrectRules,
  updateRuleAccuracy,
  pruneIneffectiveRules,
  handleProjectArchival,
  getDebugInfo,
}
