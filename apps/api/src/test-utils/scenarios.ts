/**
 * Test Scenarios
 *
 * Pre-built test scenarios for common edge cases in the AI categorization engine.
 * These functions create complex test data setups that would be tedious to write manually.
 *
 * @module test-utils/scenarios
 */

import { User, Project, CalendarEvent, CategoryRule } from '@prisma/client'
import {
  createTestUser,
  createTestProject,
  createTestEvent,
  createTestRule,
  createTestTimesheetEntry,
  createUserWithCategorizations,
  TestUser,
} from './fixtures'

// =============================================================================
// COLD START SCENARIOS
// =============================================================================

/**
 * Create a new user with NO categorizations (cold start scenario).
 *
 * This user should receive empty suggestions until they categorize 5+ events.
 *
 * @returns Test user with zero categorizations
 *
 * @example
 * ```typescript
 * const { user } = await createColdStartScenario(0)
 * const suggestions = await getSuggestionsForEvent(prisma, user.id, event)
 * expect(suggestions).toEqual([]) // No suggestions yet
 * ```
 */
export async function createColdStartScenario(
  categorizationCount: 0 | 1 | 2 | 3 | 4 | 5 | 10 = 0
): Promise<ReturnType<typeof createUserWithCategorizations>> {
  return await createUserWithCategorizations(categorizationCount)
}

// =============================================================================
// CONFLICTING RULES SCENARIOS
// =============================================================================

/**
 * Create a scenario where multiple projects have similar confidence scores.
 *
 * This tests the conflict resolution logic (5% threshold, recency tiebreaker).
 *
 * @returns User, projects, event, and rules that will create conflicting suggestions
 *
 * @example
 * ```typescript
 * const scenario = await createConflictingRulesScenario()
 * const suggestions = await getSuggestionsForEvent(prisma, scenario.user.id, scenario.event)
 * // Both projects will have similar confidence (within 5%)
 * // Conflict resolution should apply penalty and use recency as tiebreaker
 * ```
 */
export async function createConflictingRulesScenario(): Promise<{
  user: TestUser
  project1: Project
  project2: Project
  event: CalendarEvent
  rules: CategoryRule[]
}> {
  const user = await createTestUser()
  const project1 = await createTestProject(user.id, 'Project Alpha')
  const project2 = await createTestProject(user.id, 'Project Beta')

  const event = await createTestEvent(user.id, 'Engineering Standup', {
    attendees: [{ email: 'team@acme.com' }],
  })

  // Create rules that will produce similar confidence scores
  const recentDate = new Date()
  const oldDate = new Date()
  oldDate.setDate(oldDate.getDate() - 30)

  const rules = [
    // Project 1: Recent match, high confidence (will be ~0.85 after calculation)
    await createTestRule(user.id, project1.id, 'TITLE_KEYWORD', 'engineering', {
      confidenceScore: 0.8,
      accuracy: 0.9,
      lastMatchedAt: recentDate, // Recent match bonus
    }),
    await createTestRule(user.id, project1.id, 'ATTENDEE_EMAIL', 'team@acme.com', {
      confidenceScore: 0.7,
      accuracy: 0.8,
    }),

    // Project 2: Older match, slightly lower confidence (will be ~0.83 after calculation)
    await createTestRule(user.id, project2.id, 'TITLE_KEYWORD', 'engineering', {
      confidenceScore: 0.8,
      accuracy: 0.85,
      lastMatchedAt: oldDate, // Older match, no bonus
    }),
    await createTestRule(user.id, project2.id, 'ATTENDEE_DOMAIN', 'acme.com', {
      confidenceScore: 0.75,
      accuracy: 0.8,
    }),
  ]

  return { user, project1, project2, event, rules }
}

// =============================================================================
// AMBIGUOUS KEYWORD SCENARIOS
// =============================================================================

/**
 * Create a scenario where a keyword maps to 3+ different projects (ambiguous).
 *
 * This tests the ambiguous pattern detection and penalty logic.
 *
 * @returns User, projects, event, and rules demonstrating ambiguous keyword
 *
 * @example
 * ```typescript
 * const scenario = await createAmbiguousKeywordScenario()
 * // The keyword "meeting" maps to 3+ projects
 * // Suggestions based solely on "meeting" should be filtered or penalized
 * ```
 */
export async function createAmbiguousKeywordScenario(): Promise<{
  user: TestUser
  projects: Project[]
  event: CalendarEvent
  rules: CategoryRule[]
}> {
  const user = await createTestUser()

  // Create 4 projects that all use the keyword "meeting"
  const projects = [
    await createTestProject(user.id, 'Engineering'),
    await createTestProject(user.id, 'Marketing'),
    await createTestProject(user.id, 'Sales'),
    await createTestProject(user.id, 'Support'),
  ]

  // Create an event with the ambiguous keyword "meeting"
  const event = await createTestEvent(user.id, 'Team Meeting')

  // Create rules for each project matching "meeting"
  const rules: CategoryRule[] = []
  for (const project of projects) {
    const rule = await createTestRule(user.id, project.id, 'TITLE_KEYWORD', 'meeting', {
      confidenceScore: 0.6,
      accuracy: 0.5,
    })
    rules.push(rule)
  }

  return { user, projects, event, rules }
}

/**
 * Create a scenario where ambiguous keyword is combined with strong signal.
 *
 * This tests that ambiguous keywords are allowed when other rule types match.
 *
 * @returns User, project, event, and rules with ambiguous + strong signals
 *
 * @example
 * ```typescript
 * const scenario = await createAmbiguousWithStrongSignalScenario()
 * // "meeting" is ambiguous, but ATTENDEE_EMAIL is a strong signal
 * // Suggestion should NOT be filtered despite ambiguous keyword
 * ```
 */
export async function createAmbiguousWithStrongSignalScenario(): Promise<{
  user: TestUser
  mainProject: Project
  otherProjects: Project[]
  event: CalendarEvent
  rules: CategoryRule[]
}> {
  const user = await createTestUser()

  // Main project has ambiguous keyword + strong signal (attendee email)
  const mainProject = await createTestProject(user.id, 'Engineering')

  // Other projects only have ambiguous keyword (to make it ambiguous)
  const otherProjects = [
    await createTestProject(user.id, 'Marketing'),
    await createTestProject(user.id, 'Sales'),
  ]

  // Event with ambiguous keyword + specific attendee
  const event = await createTestEvent(user.id, 'Engineering Team Meeting', {
    attendees: [{ email: 'engineer@acme.com' }],
  })

  const rules: CategoryRule[] = []

  // Main project: ambiguous keyword + strong signal (attendee email)
  rules.push(
    await createTestRule(user.id, mainProject.id, 'TITLE_KEYWORD', 'meeting', {
      confidenceScore: 0.6,
    })
  )
  rules.push(
    await createTestRule(user.id, mainProject.id, 'ATTENDEE_EMAIL', 'engineer@acme.com', {
      confidenceScore: 0.9,
      accuracy: 0.95,
    })
  )

  // Other projects: only ambiguous keyword
  for (const project of otherProjects) {
    rules.push(
      await createTestRule(user.id, project.id, 'TITLE_KEYWORD', 'meeting', {
        confidenceScore: 0.6,
      })
    )
  }

  return { user, mainProject, otherProjects, event, rules }
}

// =============================================================================
// ARCHIVED PROJECT SCENARIOS
// =============================================================================

/**
 * Create a scenario where an event matches an archived project's rules.
 *
 * This tests that archived projects are not suggested, and logs are created.
 *
 * @returns User, archived project, active project, event, and rules
 *
 * @example
 * ```typescript
 * const scenario = await createArchivedProjectScenario()
 * const suggestions = await getSuggestionsForEvent(prisma, scenario.user.id, scenario.event)
 * // Should NOT include archived project
 * // Should log that event matched archived project rules
 * ```
 */
export async function createArchivedProjectScenario(): Promise<{
  user: TestUser
  archivedProject: Project
  activeProject: Project
  event: CalendarEvent
  archivedRules: CategoryRule[]
  activeRules: CategoryRule[]
}> {
  const user = await createTestUser()

  const archivedProject = await createTestProject(user.id, 'Old Marketing Campaign', true)
  const activeProject = await createTestProject(user.id, 'Current Marketing', false)

  // Event that would match both archived and active projects
  const event = await createTestEvent(user.id, 'Marketing Strategy Meeting', {
    attendees: [{ email: 'marketing@acme.com' }],
  })

  // Rules for archived project (should not be suggested)
  const archivedRules = [
    await createTestRule(user.id, archivedProject.id, 'TITLE_KEYWORD', 'marketing', {
      confidenceScore: 0.9,
      accuracy: 0.95,
    }),
    await createTestRule(user.id, archivedProject.id, 'ATTENDEE_EMAIL', 'marketing@acme.com', {
      confidenceScore: 0.85,
      accuracy: 0.9,
    }),
  ]

  // Rules for active project (should be suggested)
  const activeRules = [
    await createTestRule(user.id, activeProject.id, 'TITLE_KEYWORD', 'marketing', {
      confidenceScore: 0.8,
      accuracy: 0.85,
    }),
  ]

  return { user, archivedProject, activeProject, event, archivedRules, activeRules }
}

// =============================================================================
// COMPLEX INTEGRATION SCENARIOS
// =============================================================================

/**
 * Create a comprehensive scenario combining multiple edge cases.
 *
 * This tests the full AI categorization flow with:
 * - Multiple active projects
 * - Archived projects
 * - Ambiguous keywords
 * - Conflicting rules
 * - Various confidence levels
 *
 * @returns Complex test setup with all edge case elements
 *
 * @example
 * ```typescript
 * const scenario = await createComprehensiveScenario()
 * // Test the full suggestion pipeline with all edge cases present
 * ```
 */
export async function createComprehensiveScenario(): Promise<{
  user: TestUser
  activeProjects: Project[]
  archivedProjects: Project[]
  events: CalendarEvent[]
  rules: CategoryRule[]
}> {
  const user = await createTestUser()

  // Create 5 active projects
  const activeProjects = [
    await createTestProject(user.id, 'Engineering'),
    await createTestProject(user.id, 'Marketing'),
    await createTestProject(user.id, 'Sales'),
    await createTestProject(user.id, 'Support'),
    await createTestProject(user.id, 'Operations'),
  ]

  // Create 2 archived projects
  const archivedProjects = [
    await createTestProject(user.id, 'Old Engineering Team', true),
    await createTestProject(user.id, 'Deprecated Product', true),
  ]

  // Create various events
  const events = [
    await createTestEvent(user.id, 'Engineering Standup'),
    await createTestEvent(user.id, 'Marketing Strategy Meeting'),
    await createTestEvent(user.id, 'Team Meeting'), // Ambiguous
    await createTestEvent(user.id, 'Sales Review', {
      attendees: [{ email: 'sales@acme.com' }],
    }),
  ]

  // Create rules with various patterns
  const rules: CategoryRule[] = []

  // Engineering rules (strong signals)
  rules.push(
    await createTestRule(user.id, activeProjects[0].id, 'TITLE_KEYWORD', 'engineering', {
      confidenceScore: 0.9,
      accuracy: 0.95,
    })
  )

  // Marketing rules (moderate confidence)
  rules.push(
    await createTestRule(user.id, activeProjects[1].id, 'TITLE_KEYWORD', 'marketing', {
      confidenceScore: 0.75,
      accuracy: 0.8,
    })
  )

  // Ambiguous "meeting" keyword across multiple projects
  for (let i = 0; i < 4; i++) {
    rules.push(
      await createTestRule(user.id, activeProjects[i].id, 'TITLE_KEYWORD', 'meeting', {
        confidenceScore: 0.6,
        accuracy: 0.5,
      })
    )
  }

  // Sales rules (strong attendee signal)
  rules.push(
    await createTestRule(user.id, activeProjects[2].id, 'ATTENDEE_EMAIL', 'sales@acme.com', {
      confidenceScore: 0.95,
      accuracy: 0.98,
    })
  )

  // Archived project rules (should not be suggested)
  rules.push(
    await createTestRule(user.id, archivedProjects[0].id, 'TITLE_KEYWORD', 'engineering', {
      confidenceScore: 0.95,
      accuracy: 1.0,
    })
  )

  return { user, activeProjects, archivedProjects, events, rules }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  createColdStartScenario,
  createConflictingRulesScenario,
  createAmbiguousKeywordScenario,
  createAmbiguousWithStrongSignalScenario,
  createArchivedProjectScenario,
  createComprehensiveScenario,
}
