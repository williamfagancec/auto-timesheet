/**
 * AI Categorization Service
 *
 * Rule-based learning engine for automatic project categorization of calendar events.
 *
 * @module ai-categorization
 * @see docs/AI_ENGINE.md for complete architecture documentation
 */

import { PrismaClient } from '@prisma/client'
// import { CategoryRule } from '@prisma/client' // TODO: Will be used in Phase 3+
// import { AI_CONFIG } from 'config' // TODO: Will be used in Phase 3
import { CategoryRuleType } from 'shared'

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
  _prisma: PrismaClient,
  _userId: string,
  _event: CalendarEventInput
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
  _prisma: PrismaClient,
  _userId: string,
  _event: CalendarEventInput,
  _projectId: string,
  _wasAutoSuggestion: boolean
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
  _prisma: PrismaClient,
  _ruleId: string,
  _wasAccepted: boolean
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
 * @returns Array of extracted keywords (max 3)
 *
 * @example
 * ```typescript
 * extractTitleKeywords("Engineering Standup Meeting")
 * // Returns: ["engineering", "standup"]
 *
 * extractTitleKeywords("Weekly Review: Q4 Planning")
 * // Returns: ["q4", "planning"]
 * ```
 *
 * @internal
 */
function extractTitleKeywords(title: string): string[] {
  try {
    if (!title || typeof title !== 'string') {
      console.warn('[AI] Invalid title for keyword extraction:', title)
      return []
    }

    // Combined stop words (user-provided + architect-suggested)
    const STOP_WORDS = new Set([
      // Common words
      'a', 'an', 'the', 'and', 'or', 'but', 'in', 'at', 'to', 'for', 'of',
      'with', 'by', 'from', 'as', 'is', 'was', 'are', 'been', 'be',
      // Meeting-specific words
      'meeting', 'call', 'sync', 'chat', 'discussion', 'review', 'session',
      'weekly', 'daily', 'monthly', 'recurring',
      // Other
      'cec',
    ])

    // 1. Normalize: lowercase, trim
    const normalized = title.toLowerCase().trim()

    // 2. Remove punctuation (keep letters, numbers, spaces, and Unicode word characters)
    // Use Unicode-aware regex to preserve accented characters (é, ü, etc.)
    const cleaned = normalized.replace(/[^\p{L}\p{N}\s]/gu, ' ')

    // 3. Split into words
    const words = cleaned.split(/\s+/).filter(word => word.length > 0)

    // 4. Filter: remove stop words, keep words >= 3 chars
    const keywords = words.filter(
      word => !STOP_WORDS.has(word) && word.length >= 3
    )

    // 5. Deduplicate and return max 3 keywords
    return [...new Set(keywords)].slice(0, 3)
  } catch (error) {
    console.error('[AI] Keyword extraction error:', error)
    return []
  }
}

/**
 * Extract attendee patterns (emails and domains) from attendee list.
 *
 * Creates both ATTENDEE_EMAIL and ATTENDEE_DOMAIN patterns for each unique
 * attendee. Email patterns are specific, domain patterns are broader.
 *
 * @param attendees - Array of attendee objects with email addresses
 * @returns Array of ExtractedPattern objects (emails + domains)
 *
 * @example
 * ```typescript
 * extractAttendeePatterns([
 *   { email: "john@acme.com" },
 *   { email: "jane@acme.com" }
 * ])
 * // Returns:
 * // [
 * //   { ruleType: 'ATTENDEE_EMAIL', condition: 'john@acme.com' },
 * //   { ruleType: 'ATTENDEE_DOMAIN', condition: 'acme.com' },
 * //   { ruleType: 'ATTENDEE_EMAIL', condition: 'jane@acme.com' },
 * // ]
 * // Note: domain 'acme.com' appears only once (deduplicated)
 * ```
 *
 * @internal
 */
function extractAttendeePatterns(
  attendees: Array<{ email: string }> | undefined
): ExtractedPattern[] {
  try {
    if (!attendees || !Array.isArray(attendees) || attendees.length === 0) {
      return []
    }

    const patterns: ExtractedPattern[] = []
    const seenEmails = new Set<string>()
    const seenDomains = new Set<string>()

    for (const attendee of attendees) {
      if (!attendee.email || typeof attendee.email !== 'string') {
        continue
      }

      // Normalize email to lowercase
      const email = attendee.email.toLowerCase().trim()

      // Skip invalid emails (check for @ symbol and text before/after)
      const emailParts = email.split('@')
      if (emailParts.length !== 2 || !emailParts[0] || !emailParts[1]) {
        console.warn('[AI] Invalid email format, skipping:', attendee.email)
        continue
      }

      const domain = emailParts[1]

      // Add ATTENDEE_EMAIL pattern (if not already seen)
      if (!seenEmails.has(email)) {
        patterns.push({
          ruleType: 'ATTENDEE_EMAIL',
          condition: email,
        })
        seenEmails.add(email)
      }

      // Extract and add ATTENDEE_DOMAIN pattern
      if (domain && !seenDomains.has(domain)) {
        patterns.push({
          ruleType: 'ATTENDEE_DOMAIN',
          condition: domain,
        })
        seenDomains.add(domain)
      }
    }

    return patterns
  } catch (error) {
    console.error('[AI] Attendee pattern extraction error:', error)
    return []
  }
}

/**
 * Extract all patterns from a calendar event.
 *
 * Combines all pattern extraction functions to get title keywords,
 * attendee patterns, calendar ID, and recurring event ID.
 *
 * @param event - Calendar event
 * @returns Array of extracted patterns (all types combined)
 *
 * @example
 * ```typescript
 * extractPatternsFromEvent({
 *   id: 'evt_123',
 *   title: "Engineering Standup",
 *   attendees: [{ email: "team@acme.com" }],
 *   calendarId: "primary",
 *   googleEventId: "recurring_abc123"
 * })
 * // Returns:
 * // [
 * //   { ruleType: 'TITLE_KEYWORD', condition: 'engineering' },
 * //   { ruleType: 'TITLE_KEYWORD', condition: 'standup' },
 * //   { ruleType: 'ATTENDEE_EMAIL', condition: 'team@acme.com' },
 * //   { ruleType: 'ATTENDEE_DOMAIN', condition: 'acme.com' },
 * //   { ruleType: 'CALENDAR_NAME', condition: 'primary' },
 * //   { ruleType: 'RECURRING_EVENT_ID', condition: 'recurring_abc123' }
 * // ]
 * ```
 *
 * @internal
 */
function extractPatternsFromEvent(event: CalendarEventInput): ExtractedPattern[] {
  try {
    const patterns: ExtractedPattern[] = []

    // 1. Extract title keyword patterns
    const keywords = extractTitleKeywords(event.title)
    for (const keyword of keywords) {
      patterns.push({
        ruleType: 'TITLE_KEYWORD',
        condition: keyword,
      })
    }

    // 2. Extract attendee patterns (emails + domains)
    const attendeePatterns = extractAttendeePatterns(event.attendees)
    patterns.push(...attendeePatterns)

    // 3. Add calendar pattern if calendarId exists
    if (event.calendarId) {
      patterns.push({
        ruleType: 'CALENDAR_NAME',
        condition: event.calendarId,
      })
    }

    // 4. Add recurring event pattern if googleEventId exists
    // Note: For recurring events, googleEventId is the recurring event ID
    if (event.googleEventId) {
      patterns.push({
        ruleType: 'RECURRING_EVENT_ID',
        condition: event.googleEventId,
      })
    }

    return patterns
  } catch (error) {
    console.error('[AI] Pattern extraction failed:', error, { eventId: event.id })
    return []
  }
}

// =============================================================================
// PHASE 3: CONFIDENCE CALCULATION (Internal Helper Functions)
// =============================================================================

// TODO: Uncomment and implement in Phase 3

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
// function calculateRuleConfidence(_rule: CategoryRule): number {
//   // TODO: Implement in Phase 3
//   // Formula: rule.confidenceScore * (1 + AI_CONFIG.learningAccuracyWeight * rule.accuracy)
//
//   return 0
// }

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
// function calculateCombinedConfidence(_confidences: number[]): number {
//   // TODO: Implement in Phase 3
//   // Formula: 1 - product((1 - confidence) for each confidence)
//
//   return 0
// }

// =============================================================================
// PHASE 4: RULE MATCHING (Internal Helper Functions)
// =============================================================================

// TODO: Uncomment and implement in Phase 4

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
// function matchTitleKeyword(_rule: CategoryRule, _event: CalendarEventInput): boolean {
//   // TODO: Implement in Phase 4
//   // Normalize both and check if title contains keyword
//
//   return false
// }

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
// function matchAttendeeEmail(_rule: CategoryRule, _event: CalendarEventInput): boolean {
//   // TODO: Implement in Phase 4
//   // Check for exact match or domain match
//
//   return false
// }

/**
 * Check if event calendar matches a CALENDAR_NAME rule.
 *
 * @param rule - CategoryRule with ruleType = CALENDAR_NAME
 * @param event - Calendar event
 * @returns true if calendar IDs match
 *
 * @internal
 */
// function matchCalendarName(_rule: CategoryRule, _event: CalendarEventInput): boolean {
//   // TODO: Implement in Phase 4
//   // Exact match on calendarId
//
//   return false
// }

/**
 * Check if event is a recurring event that matches a RECURRING_EVENT_ID rule.
 *
 * @param rule - CategoryRule with ruleType = RECURRING_EVENT_ID
 * @param event - Calendar event
 * @returns true if googleEventId matches
 *
 * @internal
 */
// function matchRecurringEvent(_rule: CategoryRule, _event: CalendarEventInput): boolean {
//   // TODO: Implement in Phase 4
//   // Exact match on googleEventId
//
//   return false
// }

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
// function doesRuleMatch(_rule: CategoryRule, _event: CalendarEventInput): boolean {
//   // TODO: Implement in Phase 4
//   // Switch on rule.ruleType and call appropriate matcher
//
//   return false
// }

// =============================================================================
// EXPORTS
// =============================================================================

// Main public API (default export)
export default {
  getSuggestionsForEvent,
  learnFromCategorization,
  updateRuleAccuracy,
}

// Named exports for testing internal Phase 2 functions
// These are exported for testing purposes only (@internal)
export {
  extractTitleKeywords,
  extractAttendeePatterns,
  extractPatternsFromEvent,
}
