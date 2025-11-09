/**
 * AI Categorization Service
 *
 * Rule-based learning engine for automatic project categorization of calendar events.
 *
 * @module ai-categorization
 * @see docs/AI_ENGINE.md for complete architecture documentation
 */

import { PrismaClient, CategoryRule } from '@prisma/client'
import { AI_CONFIG } from '@repo/config'
import { CategoryRuleType } from '@repo/shared'

/**
 * Calendar event data structure for AI processing
 */
export interface CalendarEventInput {
  id: string
  title: string
  attendees?: Array<{ email: string; responseStatus?: string }>
  calendarId?: string
  googleEventId?: string | null
}

/**
 * Project suggestion output format
 */
export interface ProjectSuggestion {
  projectId: string
  projectName: string
  confidence: number
  matchingRules?: Array<{
    ruleType: CategoryRuleType
    condition: string
    confidenceScore: number
  }>
}

/**
 * Extracted pattern from event
 */
interface ExtractedPattern {
  ruleType: CategoryRuleType
  condition: string
}

// =============================================================================
// PHASE 4: SUGGESTION GENERATION
// =============================================================================

/**
 * Get AI-generated project suggestions for a calendar event.
 *
 * This is the main entry point for the AI suggestion engine. It:
 * 1. Fetches user's learned CategoryRule records
 * 2. Matches event against each rule type
 * 3. Groups matching rules by projectId
 * 4. Calculates combined confidence scores
 * 5. Filters by confidence threshold
 * 6. Returns top suggestions sorted by confidence
 *
 * @param prisma - Prisma client instance
 * @param userId - User ID to fetch rules for
 * @param event - Calendar event to analyze
 * @returns Array of project suggestions (max 3), sorted by confidence
 *
 * @example
 * ```typescript
 * const suggestions = await getSuggestionsForEvent(prisma, userId, {
 *   id: 'evt_123',
 *   title: "Engineering Standup",
 *   attendees: [{ email: "team@company.com" }],
 *   calendarId: "primary",
 * })
 *
 * // Returns:
 * // [
 * //   {
 * //     projectId: "proj_abc",
 * //     projectName: "Engineering",
 * //     confidence: 0.85,
 * //     matchingRules: [...]
 * //   }
 * // ]
 * ```
 *
 * @see docs/AI_ENGINE.md Phase 4: Suggestion Generation
 */
export async function getSuggestionsForEvent(
  prisma: PrismaClient,
  userId: string,
  event: CalendarEventInput
): Promise<ProjectSuggestion[]> {
  // TODO: Implement in Phase 4
  // 1. Fetch all active rules for user
  // 2. Apply matchers for each rule type
  // 3. Group by projectId and calculate combined confidence
  // 4. Filter by AI_CONFIG.minConfidenceThreshold
  // 5. Sort by confidence and return top 3

  return []
}

// =============================================================================
// PHASE 5: LEARNING & FEEDBACK
// =============================================================================

/**
 * Learn from user categorization by creating or updating CategoryRule records.
 *
 * Called when a user categorizes an event (manually or by accepting suggestion).
 * Extracts patterns from the event and creates/updates rules for future matching.
 *
 * @param prisma - Prisma client instance
 * @param userId - User ID
 * @param event - Calendar event that was categorized
 * @param projectId - Project ID that was assigned
 * @param wasAutoSuggestion - Whether user accepted an AI suggestion (affects initial accuracy)
 *
 * @example
 * ```typescript
 * await learnFromCategorization(prisma, userId, event, projectId, true)
 * // Creates/updates rules:
 * // - TITLE_KEYWORD: "standup" → projectId
 * // - ATTENDEE_EMAIL: "team@company.com" → projectId
 * // - CALENDAR_NAME: "primary" → projectId
 * ```
 *
 * @see docs/AI_ENGINE.md Phase 5: Learning & Feedback
 */
export async function learnFromCategorization(
  prisma: PrismaClient,
  userId: string,
  event: CalendarEventInput,
  projectId: string,
  wasAutoSuggestion: boolean
): Promise<void> {
  // TODO: Implement in Phase 5
  // 1. Extract patterns from event (title, attendees, calendar, recurring)
  // 2. For each pattern:
  //    - Check if rule already exists
  //    - If exists: update matchCount
  //    - If not: create new rule
  // 3. If wasAutoSuggestion, boost initial accuracy
}

/**
 * Update rule accuracy based on user feedback.
 *
 * Called when a suggestion was made and user either accepted or rejected it.
 * Updates the accuracy score using a weighted average formula.
 *
 * @param prisma - Prisma client instance
 * @param ruleId - CategoryRule ID to update
 * @param wasAccepted - Whether user accepted the suggestion
 *
 * @example
 * ```typescript
 * // Suggestion was accepted
 * await updateRuleAccuracy(prisma, ruleId, true)
 *
 * // Suggestion was rejected
 * await updateRuleAccuracy(prisma, ruleId, false)
 * ```
 *
 * @see docs/AI_ENGINE.md Phase 5: Learning & Feedback
 */
export async function updateRuleAccuracy(
  prisma: PrismaClient,
  ruleId: string,
  wasAccepted: boolean
): Promise<void> {
  // TODO: Implement in Phase 5
  // Formula: newAccuracy = (accuracy * matchCount + (wasAccepted ? 1 : 0)) / (matchCount + 1)
  // Also update: matchCount++, totalSuggestions++, lastMatchedAt
}

// =============================================================================
// PHASE 2: PATTERN EXTRACTION (Internal Helper Functions)
// =============================================================================

/**
 * Extract meaningful keywords from event title.
 *
 * Normalizes title (lowercase, trim) and extracts 1-3 significant words,
 * skipping common stop words like "meeting", "call", "sync".
 *
 * @param title - Event title
 * @returns Array of extracted keywords
 *
 * @internal
 */
function extractTitleKeywords(title: string): string[] {
  // TODO: Implement in Phase 2
  // 1. Normalize: lowercase, trim, remove punctuation
  // 2. Split into words
  // 3. Filter out stop words
  // 4. Return 1-3 most significant words

  return []
}

/**
 * Extract attendee patterns (emails and domains) from attendee list.
 *
 * @param attendees - Array of attendee email addresses
 * @returns Array of patterns (full emails + domains)
 *
 * @internal
 */
function extractAttendeePatterns(
  attendees: Array<{ email: string }> | undefined
): string[] {
  // TODO: Implement in Phase 2
  // 1. Extract all email addresses
  // 2. Extract unique domains from emails
  // 3. Return both (prioritize external domains)

  return []
}

/**
 * Extract all patterns from a calendar event.
 *
 * Combines all pattern extraction functions to get title keywords,
 * attendee patterns, calendar ID, and recurring event ID.
 *
 * @param event - Calendar event
 * @returns Array of extracted patterns
 *
 * @internal
 */
function extractPatternsFromEvent(event: CalendarEventInput): ExtractedPattern[] {
  // TODO: Implement in Phase 2
  // Call all extraction functions and combine results

  return []
}

// =============================================================================
// PHASE 3: CONFIDENCE CALCULATION (Internal Helper Functions)
// =============================================================================

/**
 * Calculate confidence score for a single rule.
 *
 * Applies accuracy boost based on rule's historical performance.
 *
 * Formula: baseConfidence * (1 + AI_CONFIG.learningAccuracyWeight * accuracy)
 *
 * @param rule - CategoryRule to calculate confidence for
 * @returns Adjusted confidence score (0.0-1.0)
 *
 * @internal
 */
function calculateRuleConfidence(rule: CategoryRule): number {
  // TODO: Implement in Phase 3
  // Formula: rule.confidenceScore * (1 + AI_CONFIG.learningAccuracyWeight * rule.accuracy)

  return 0
}

/**
 * Calculate combined confidence when multiple rules match the same project.
 *
 * Uses probability combination formula: 1 - (1-c1)*(1-c2)*...
 *
 * @param confidences - Array of individual confidence scores
 * @returns Combined confidence score (0.0-1.0)
 *
 * @internal
 */
function calculateCombinedConfidence(confidences: number[]): number {
  // TODO: Implement in Phase 3
  // Formula: 1 - product((1 - confidence) for each confidence)

  return 0
}

// =============================================================================
// PHASE 4: RULE MATCHING (Internal Helper Functions)
// =============================================================================

/**
 * Check if event title matches a TITLE_KEYWORD rule.
 *
 * Case-insensitive substring match.
 *
 * @param rule - CategoryRule with ruleType = TITLE_KEYWORD
 * @param event - Calendar event
 * @returns true if title contains keyword
 *
 * @internal
 */
function matchTitleKeyword(rule: CategoryRule, event: CalendarEventInput): boolean {
  // TODO: Implement in Phase 4
  // Normalize both and check if title contains keyword

  return false
}

/**
 * Check if event attendees match an ATTENDEE_EMAIL or ATTENDEE_DOMAIN rule.
 *
 * Matches either exact email or domain.
 *
 * @param rule - CategoryRule with ruleType = ATTENDEE_EMAIL or ATTENDEE_DOMAIN
 * @param event - Calendar event
 * @returns true if any attendee matches
 *
 * @internal
 */
function matchAttendeeEmail(rule: CategoryRule, event: CalendarEventInput): boolean {
  // TODO: Implement in Phase 4
  // Check for exact match or domain match

  return false
}

/**
 * Check if event calendar matches a CALENDAR_NAME rule.
 *
 * @param rule - CategoryRule with ruleType = CALENDAR_NAME
 * @param event - Calendar event
 * @returns true if calendar IDs match
 *
 * @internal
 */
function matchCalendarName(rule: CategoryRule, event: CalendarEventInput): boolean {
  // TODO: Implement in Phase 4
  // Exact match on calendarId

  return false
}

/**
 * Check if event is a recurring event that matches a RECURRING_EVENT_ID rule.
 *
 * @param rule - CategoryRule with ruleType = RECURRING_EVENT_ID
 * @param event - Calendar event
 * @returns true if googleEventId matches
 *
 * @internal
 */
function matchRecurringEvent(rule: CategoryRule, event: CalendarEventInput): boolean {
  // TODO: Implement in Phase 4
  // Exact match on googleEventId

  return false
}

/**
 * Check if a rule matches an event based on rule type.
 *
 * Delegates to specific matcher function based on ruleType.
 *
 * @param rule - CategoryRule to test
 * @param event - Calendar event
 * @returns true if rule matches event
 *
 * @internal
 */
function doesRuleMatch(rule: CategoryRule, event: CalendarEventInput): boolean {
  // TODO: Implement in Phase 4
  // Switch on rule.ruleType and call appropriate matcher

  return false
}

// =============================================================================
// EXPORTS
// =============================================================================

// Only export the main public functions
// Internal helper functions remain private to this module
export default {
  getSuggestionsForEvent,
  learnFromCategorization,
  updateRuleAccuracy,
}
