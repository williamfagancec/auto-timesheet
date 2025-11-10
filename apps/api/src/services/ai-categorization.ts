/**
 * AI Categorization Service
 *
 * Rule-based learning engine for automatic project categorization of calendar events.
 *
 * @module ai-categorization
 * @see docs/AI_ENGINE.md for complete architecture documentation
 */

import { PrismaClient, CategoryRule, Project } from '@prisma/client'
import { AI_CONFIG } from 'config'
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
 * Rule with calculated confidence score
 *
 * Used internally in Phase 3/4 to pass rules with their confidence scores
 * between pattern matching and project aggregation functions.
 *
 * Note: Requires CategoryRule with project relation included.
 */
export interface ScoredRule {
  rule: CategoryRule & { project: Project }
  confidence: number
}

/**
 * Project suggestion output format
 *
 * Represents a project that matched one or more rules for a calendar event,
 * with combined confidence score and list of matching rules.
 *
 * @see aggregateByProject - generates these from ScoredRule[]
 */
export interface ProjectSuggestion {
  projectId: string
  project: Project              // Full project object from Prisma
  confidence: number            // Combined confidence (0.0 - 1.0)
  matchingRules: CategoryRule[] // All rules that matched this project
  reasoning: string[]           // Human-readable explanations for why this project was suggested
}

/**
 * Extracted pattern from event
 *
 * @internal
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
  try {
    // Step 1: Fetch all active rules for user (with project relation)
    // Filter out rules for archived projects
    const rules = await prisma.categoryRule.findMany({
      where: {
        userId,
        project: { isArchived: false },
      },
      include: { project: true },
    })

    // Step 2: Filter rules that match the event
    const matchingRules = rules.filter(rule => doesRuleMatch(rule, event))

    // Step 3: Calculate confidence for each matching rule
    const scoredRules: ScoredRule[] = matchingRules.map(rule => ({
      rule,
      confidence: calculateRuleConfidence(rule),
    }))

    // Step 4: Aggregate by project (combines confidences, filters by threshold, sorts)
    const suggestions = aggregateByProject(scoredRules)

    // Step 5: Return suggestions (already sorted and limited by aggregateByProject)
    return suggestions
  } catch (error) {
    console.error('[AI] Suggestion generation error:', error, { userId, eventId: event.id })
    return [] // Graceful degradation
  }
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
export function extractPatternsFromEvent(event: CalendarEventInput): ExtractedPattern[] {
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

/**
 * Check if a rule has been matched recently (within configured days).
 *
 * Used to apply a recency bonus to rules that have been successfully matched
 * recently, as they're more likely to be relevant for current events.
 *
 * @param lastMatchedAt - Timestamp when rule was last matched, or null if never
 * @returns true if lastMatchedAt is within AI_CONFIG.recentMatchDays (default: 7 days)
 *
 * @example
 * ```typescript
 * const rule = { lastMatchedAt: new Date('2025-11-08') }
 * // Today is 2025-11-09
 * isRecentMatch(rule.lastMatchedAt) // true (1 day ago)
 *
 * const oldRule = { lastMatchedAt: new Date('2025-10-01') }
 * isRecentMatch(oldRule.lastMatchedAt) // false (39 days ago)
 * ```
 *
 * @internal
 */
function isRecentMatch(lastMatchedAt: Date | null): boolean {
  if (!lastMatchedAt) {
    return false
  }

  const now = new Date()
  const daysDiff = (now.getTime() - lastMatchedAt.getTime()) / (1000 * 60 * 60 * 24)

  return daysDiff <= AI_CONFIG.recentMatchDays
}

/**
 * Check if a rule has not been used for a long time (stale rule).
 *
 * Used to apply a penalty to rules that haven't been matched recently,
 * as they might be outdated or less relevant.
 *
 * @param lastMatchedAt - Timestamp when rule was last matched, or null if never
 * @returns true if lastMatchedAt is older than AI_CONFIG.staleRuleDays (default: 30 days)
 * @returns false if lastMatchedAt is null (brand new rule, no penalty)
 *
 * @example
 * ```typescript
 * const staleRule = { lastMatchedAt: new Date('2025-10-01') }
 * // Today is 2025-11-09
 * isStaleRule(staleRule.lastMatchedAt) // true (39 days ago)
 *
 * const newRule = { lastMatchedAt: null }
 * isStaleRule(newRule.lastMatchedAt) // false (never matched, don't penalize)
 * ```
 *
 * @internal
 */
function isStaleRule(lastMatchedAt: Date | null): boolean {
  if (!lastMatchedAt) {
    // Brand new rule that's never been matched - don't penalize
    return false
  }

  const now = new Date()
  const daysDiff = (now.getTime() - lastMatchedAt.getTime()) / (1000 * 60 * 60 * 24)

  return daysDiff > AI_CONFIG.staleRuleDays
}

/**
 * Calculate confidence score for a single rule.
 *
 * Applies a 6-step formula to calculate final confidence based on:
 * 1. Rule type weight (RECURRING_EVENT_ID=1.0 most reliable, TITLE_KEYWORD=0.5 least)
 * 2. Rule's stored confidence score (0.0-1.0)
 * 3. Historical accuracy adjustment (based on successful matches)
 * 4. Recent match bonus (+10% if matched within 7 days)
 * 5. Stale rule penalty (-10% if unused for 30+ days)
 * 6. Cap at 1.0 (100%)
 *
 * @param rule - CategoryRule to calculate confidence for
 * @returns Adjusted confidence score (0.0-1.0)
 *
 * @example
 * ```typescript
 * const rule: CategoryRule = {
 *   ruleType: 'RECURRING_EVENT_ID',
 *   confidenceScore: 0.9,
 *   accuracy: 1.0,
 *   lastMatchedAt: new Date('2025-11-08'), // Yesterday
 * }
 *
 * calculateRuleConfidence(rule)
 * // Step 1: Base = 1.0 (RECURRING_EVENT_ID weight)
 * // Step 2: Scaled = 1.0 * 0.9 = 0.9
 * // Step 3: Accuracy = 0.9 * (1 + 0.3 * 1.0) = 1.17
 * // Step 4: Recent bonus = 1.17 * 1.1 = 1.287
 * // Step 5: No stale penalty
 * // Step 6: Capped = 1.0
 * // Returns: 1.0 (100% confidence)
 * ```
 *
 * @internal
 */
function calculateRuleConfidence(rule: CategoryRule): number {
  // Step 1: Start with base confidence from rule type weight
  const ruleTypeWeight = AI_CONFIG.ruleTypeWeights[rule.ruleType as keyof typeof AI_CONFIG.ruleTypeWeights]
  let confidence = ruleTypeWeight

  // Step 2: Scale by rule's stored confidence score (0.0-1.0)
  confidence *= rule.confidenceScore

  // Step 3: Adjust based on historical accuracy
  // Formula: confidence * (1 + learningAccuracyWeight * accuracy)
  // Example: If accuracy=1.0 and weight=0.3, multiply by 1.3 (30% boost)
  confidence *= (1 + AI_CONFIG.learningAccuracyWeight * rule.accuracy)

  // Step 4: Apply recent match bonus (+10% if matched within 7 days)
  if (isRecentMatch(rule.lastMatchedAt)) {
    confidence *= (1 + AI_CONFIG.recentMatchBonus)
  }

  // Step 5: Apply stale rule penalty (-10% if unused for 30+ days)
  if (isStaleRule(rule.lastMatchedAt)) {
    confidence *= (1 - AI_CONFIG.staleRulePenalty)
  }

  // Step 6: Cap at 1.0 (100%)
  return Math.min(confidence, 1.0)
}

/**
 * Calculate combined confidence when multiple rules match the same project.
 *
 * Uses noisy-OR probability combination formula: 1 - product((1 - c) for each c)
 *
 * This formula assumes rules are independent evidence and combines them in a
 * probabilistic way. Multiple weak rules can combine to create strong confidence.
 *
 * @param confidences - Array of individual confidence scores (0.0-1.0)
 * @returns Combined confidence score (0.0-1.0)
 *
 * @example
 * ```typescript
 * // Two rules with 80% and 60% confidence
 * calculateCombinedConfidence([0.8, 0.6])
 * // = 1 - ((1 - 0.8) * (1 - 0.6))
 * // = 1 - (0.2 * 0.4)
 * // = 1 - 0.08
 * // = 0.92 (92% confidence)
 *
 * // Single rule (should return same value)
 * calculateCombinedConfidence([0.7]) // Returns: 0.7
 *
 * // Empty array
 * calculateCombinedConfidence([]) // Returns: 0.0
 * ```
 *
 * @internal
 */
function calculateCombinedConfidence(confidences: number[]): number {
  // Edge case: empty array
  if (confidences.length === 0) {
    return 0.0
  }

  // Edge case: single confidence (no combination needed)
  if (confidences.length === 1) {
    return confidences[0]
  }

  // Noisy-OR formula: 1 - product(1 - c for each confidence)
  // Calculate the product of (1 - confidence) for all confidences
  const product = confidences.reduce((acc, confidence) => {
    return acc * (1 - confidence)
  }, 1)

  // Return 1 - product
  return 1 - product
}

/**
 * Generate human-readable reasoning for why a project was suggested.
 *
 * Converts CategoryRule records into user-friendly explanation strings
 * that describe which patterns matched the event.
 *
 * @param matchingRules - Rules that matched this project
 * @returns Array of reasoning strings for display
 *
 * @example
 * ```typescript
 * generateReasoning([
 *   { ruleType: 'TITLE_KEYWORD', condition: 'standup' },
 *   { ruleType: 'ATTENDEE_EMAIL', condition: 'team@acme.com' }
 * ])
 * // Returns: ["Title keyword: \"standup\"", "Attendee: team@acme.com"]
 * ```
 *
 * @internal
 */
function generateReasoning(matchingRules: CategoryRule[]): string[] {
  return matchingRules.map(rule => {
    switch (rule.ruleType) {
      case 'TITLE_KEYWORD':
        return `Title keyword: "${rule.condition}"`
      case 'ATTENDEE_EMAIL':
        return `Attendee: ${rule.condition}`
      case 'ATTENDEE_DOMAIN':
        return `Attendee domain: @${rule.condition}`
      case 'CALENDAR_NAME':
        return `Calendar: ${rule.condition}`
      case 'RECURRING_EVENT_ID':
        return 'Recurring event pattern'
      default:
        return `Pattern: ${rule.condition}`
    }
  })
}

/**
 * Aggregate scored rules by project and combine their confidences.
 *
 * Takes an array of rules with calculated confidence scores and groups them
 * by project. For each project, combines the individual rule confidences
 * using the noisy-OR formula to produce a final project-level confidence.
 *
 * Results are filtered by minimum confidence threshold and limited to the
 * maximum number of suggestions, then sorted by confidence (highest first).
 *
 * @param scoredRules - Array of rules with their calculated confidence scores
 * @returns Array of project suggestions, sorted by confidence (highest first)
 *
 * @example
 * ```typescript
 * const scoredRules: ScoredRule[] = [
 *   { rule: { projectId: 'proj1', ... }, confidence: 0.8 },
 *   { rule: { projectId: 'proj1', ... }, confidence: 0.6 },
 *   { rule: { projectId: 'proj2', ... }, confidence: 0.4 },
 * ]
 *
 * const suggestions = aggregateByProject(scoredRules)
 * // Returns:
 * // [
 * //   {
 * //     projectId: 'proj1',
 * //     project: { ... },
 * //     confidence: 0.92,  // Combined: 1 - (1-0.8)*(1-0.6) = 0.92
 * //     matchingRules: [rule1, rule2]
 * //   }
 * // ]
 * // Note: proj2 filtered out (0.4 < 0.5 threshold)
 * ```
 *
 * @see calculateCombinedConfidence - used to combine multiple rule confidences
 */
export function aggregateByProject(scoredRules: ScoredRule[]): ProjectSuggestion[] {
  // Edge case: empty input
  if (scoredRules.length === 0) {
    return []
  }

  // Step 1: Group scored rules by projectId
  const rulesByProject = new Map<string, ScoredRule[]>()

  for (const scoredRule of scoredRules) {
    const projectId = scoredRule.rule.projectId
    if (!rulesByProject.has(projectId)) {
      rulesByProject.set(projectId, [])
    }
    rulesByProject.get(projectId)!.push(scoredRule)
  }

  // Step 2: For each project, combine confidences and create ProjectSuggestion
  const suggestions: ProjectSuggestion[] = []

  for (const [projectId, projectScoredRules] of rulesByProject.entries()) {
    // Extract just the confidence values
    const confidences = projectScoredRules.map(sr => sr.confidence)

    // Combine using noisy-OR formula
    const combinedConfidence = calculateCombinedConfidence(confidences)

    // Get the project object from the first rule (all rules share same project)
    const project = projectScoredRules[0].rule.project

    // Extract just the rules (without confidence scores)
    const matchingRules = projectScoredRules.map(sr => sr.rule)

    suggestions.push({
      projectId,
      project,
      confidence: combinedConfidence,
      matchingRules,
      reasoning: generateReasoning(matchingRules),
    })
  }

  // Step 3: Filter by minimum confidence threshold
  const filteredSuggestions = suggestions.filter(
    s => s.confidence >= AI_CONFIG.minConfidenceThreshold
  )

  // Step 4: Sort by confidence (highest first)
  filteredSuggestions.sort((a, b) => b.confidence - a.confidence)

  // Step 5: Limit to maximum number of suggestions
  return filteredSuggestions.slice(0, AI_CONFIG.maxSuggestionsPerEvent)
}

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
function matchTitleKeyword(rule: CategoryRule, event: CalendarEventInput): boolean {
  try {
    if (!event.title || !rule.condition) return false

    const normalizedTitle = event.title.toLowerCase().trim()
    const normalizedKeyword = rule.condition.toLowerCase().trim()

    return normalizedTitle.includes(normalizedKeyword)
  } catch (error) {
    console.error('[AI] Title matching error:', error)
    return false
  }
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
  try {
    if (!event.attendees || event.attendees.length === 0 || !rule.condition) return false

    const normalizedCondition = rule.condition.toLowerCase().trim()

    return event.attendees.some(attendee => {
      const email = attendee?.email
      if (typeof email !== 'string') {
        return false
      }

      const normalizedEmail = email.toLowerCase().trim()
      if (!normalizedEmail) {
        return false
      }

      if (rule.ruleType === 'ATTENDEE_EMAIL') {
        // Exact email match
        return normalizedEmail === normalizedCondition
      } 

      if (rule.ruleType === 'ATTENDEE_DOMAIN') {
        const atIndex = normalizedEmail.indexOf('@')
        if (atIndex === -1 || atIndex === normalizedEmail.length - 1) {
          return false
        }
        const domain = normalizedEmail.slice(atIndex + 1)
        return domain === normalizedCondition
      }

      return false
    })

  } catch (error) {
    console.error('[AI] Attendee matching error:', error)
    return false
  }
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
  try {
    if (!event.calendarId || !rule.condition) return false

    return event.calendarId === rule.condition
  } catch (error) {
    console.error('[AI] Calendar matching error:', error)
    return false
  }
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
  try {
    if (!event.googleEventId || !rule.condition) return false

    return event.googleEventId === rule.condition
  } catch (error) {
    console.error('[AI] Recurring event matching error:', error)
    return false
  }
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
  try {
    switch (rule.ruleType) {
      case 'TITLE_KEYWORD':
        return matchTitleKeyword(rule, event)
      case 'ATTENDEE_EMAIL':
      case 'ATTENDEE_DOMAIN':
        return matchAttendeeEmail(rule, event)
      case 'CALENDAR_NAME':
        return matchCalendarName(rule, event)
      case 'RECURRING_EVENT_ID':
        return matchRecurringEvent(rule, event)
      default:
        console.error('[AI] Unknown rule type:', rule.ruleType)
        return false
    }
  } catch (error) {
    console.error('[AI] Rule matching error:', error, { ruleId: rule.id, ruleType: rule.ruleType })
    return false
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

// Main public API (default export)
export default {
  getSuggestionsForEvent,
  learnFromCategorization,
  updateRuleAccuracy,
}

// Named exports for testing internal Phase 2 & Phase 3 functions
// These are exported for testing purposes only (@internal)
export {
  // Phase 2: Pattern extraction
  extractTitleKeywords,
  extractAttendeePatterns,
  extractPatternsFromEvent,
  // Phase 3: Confidence calculation
  calculateRuleConfidence,
  calculateCombinedConfidence,
}
